/**
 * server.js — Egg Stats API
 *
 * MUDANÇAS em relação à versão anterior:
 *   - /api/opportunities: N+1 queries → batch INSERT com ON CONFLICT DO NOTHING
 *   - /api/opportunities: busca todas as ligas do LEAGUE_MAP (não só as com matches agendados)
 *   - /api/backtest: inclui odds reais do odds_snapshots para ROI real (não só acurácia)
 *   - /api/performance: adicionado ROI por liga + breakdown por confiança
 *   - /api/sync-results: agora sincroniza todas as ligas, não só os matches do endpoint global
 *   - football-data-service: uso da versão multi-liga
 *   - Rotas de debug mantidas (úteis em dev, não custam nada)
 *   - isSameTeam movido para utils/normalize.js (mas inline aqui para não quebrar nada)
 */

import "dotenv/config";
import express from "express";
import { query } from "./src/config/db.js";

import {
  fetchUpcomingMatches,
  fetchRecentFinishedMatches,
  SUPPORTED_COMPETITIONS,
} from "./src/services/football-data-service.js";

import { fetchOddsBySport } from "./src/services/odds-api-service.js";
import { LEAGUE_MAP }       from "./src/config/league-mapping.js";

import {
  extractBest1x2,
  impliedProbability,
  normalizeProbs,
  pickBest1x2Opportunity,
} from "./src/engines/market-engine.js";

import {
  trainPoissonModel,
  calculateMatchProbabilities,
  calculateLambdas,
} from "./src/engines/pro-poisson-engine.js";

import { evaluatePredictions } from "./src/engines/evaluation.js";

const app  = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

/* ─────────────────────────────────────────
   HEALTH
───────────────────────────────────────── */

app.get("/api/health", (req, res) => {
  res.json({
    ok:                   true,
    port:                 PORT,
    useMockOdds:          process.env.USE_MOCK_ODDS === "true",
    hasDatabaseUrl:       Boolean(process.env.DATABASE_URL),
    hasFootballDataKey:   Boolean(process.env.FOOTBALL_DATA_KEY),
    hasOddsApiKey:        Boolean(process.env.ODDS_API_KEY),
    supportedLeagues:     SUPPORTED_COMPETITIONS,
  });
});

app.get("/api/db-check", async (req, res) => {
  try {
    const result = await query("SELECT NOW() AS now");
    res.json({ ok: true, databaseTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ─────────────────────────────────────────
   OPPORTUNITIES
   Identifica apostas EV+ e persiste no bet_log.
───────────────────────────────────────── */

app.get("/api/opportunities", async (req, res) => {
  try {
    const matches = await fetchUpcomingMatches();

    // Agrupa por liga
    const byLeague = {};
    for (const m of matches) {
      const code = m.competition?.code ?? m._competitionCode;
      if (!code || !LEAGUE_MAP[code]) continue;
      if (!byLeague[code]) byLeague[code] = [];
      byLeague[code].push(m);
    }

    const opportunities = [];

    for (const code of Object.keys(byLeague)) {
      // Busca histórico do Supabase para treinar o modelo
      const { rows: dbMatches } = await query(
        `SELECT home_team, away_team, home_goals, away_goals, match_date
         FROM matches
         WHERE competition_code = $1
           AND home_goals IS NOT NULL
           AND away_goals IS NOT NULL
         ORDER BY match_date ASC`,
        [code]
      );

      if (dbMatches.length < 50) {
        console.log(`[opportunities] ${code}: apenas ${dbMatches.length} jogos — pulando`);
        continue;
      }

      const model       = trainPoissonModel(dbMatches);
      const sportKey    = LEAGUE_MAP[code];
      const oddsEvents  = await fetchOddsBySport(sportKey);

      // Coleta picks da rodada
      const batchValues = []; // para batch insert

      for (const match of byLeague[code]) {
        const home = match.homeTeam?.name;
        const away = match.awayTeam?.name;
        if (!home || !away) continue;

        const oddsEvent = oddsEvents.find(o =>
          isSameTeam(o.home_team, home) && isSameTeam(o.away_team, away)
        );
        if (!oddsEvent) continue;

        const best = extractBest1x2(oddsEvent);
        if (!best) continue;

        const marketProb = normalizeProbs(
          impliedProbability(best.bestHome),
          impliedProbability(best.bestDraw),
          impliedProbability(best.bestAway),
        );

        const lambdas = calculateLambdas(home, away, model);
        if (!lambdas) continue; // time não está no modelo

        const modelProb = calculateMatchProbabilities(
          lambdas.lambdaHome,
          lambdas.lambdaAway,
          model.rho,
        );

        const pick = pickBest1x2Opportunity({
          matchLabel: `${home} vs ${away}`,
          league:     code,
          modelProb,
          bestOdds:   best,
          marketProb,
        });

        if (!pick) continue;

        opportunities.push(pick);

        batchValues.push({
          externalId:  match.id,
          code,
          label:       pick.match,
          side:        pick.pick,
          odd:         pick.odd,
          pModel:      pick.details.pModel,
          pMkt:        pick.details.pMkt,
          edge:        pick.edge,
          ev:          pick.ev,
          confidence:  pick.confidence,
        });
      }

      // Batch insert — uma query por liga, não por partida
      if (batchValues.length > 0) {
        await _batchInsertBets(batchValues);
      }
    }

    opportunities.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    res.json({
      ok:    true,
      count: opportunities.length,
      top:   opportunities.slice(0, 20),
    });

  } catch (err) {
    console.error("[opportunities] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Batch insert no bet_log usando ON CONFLICT DO NOTHING.
 * Substitui o loop de "SELECT existe? → INSERT" anterior.
 */
async function _batchInsertBets(bets) {
  if (!bets.length) return;

  const values = [];
  const params = [];
  let   i      = 1;

  for (const b of bets) {
    values.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},1)`);
    params.push(
      b.externalId, b.code, b.label, b.side,
      b.odd, b.pModel, b.pMkt, b.edge, b.ev, b.confidence
    );
  }

  await query(
    `INSERT INTO bet_log
       (external_match_id, league_code, match_label, pick,
        odd_taken, model_prob, market_prob, edge, ev, confidence, stake)
     VALUES ${values.join(",")}
     ON CONFLICT (external_match_id, pick) DO NOTHING`,
    params
  );

  console.log(`[bet_log] ${bets.length} picks inseridos (duplicatas ignoradas)`);
}

/* ─────────────────────────────────────────
   SYNC RESULTS
   Atualiza placar das partidas finalizadas.
───────────────────────────────────────── */

app.post("/api/sync-results", async (req, res) => {
  try {
    const matches = await fetchRecentFinishedMatches();
    let updated = 0;

    for (const m of matches) {
      const gH = m.score?.fullTime?.home;
      const gA = m.score?.fullTime?.away;
      if (gH == null || gA == null) continue;

      const { rowCount } = await query(
        `UPDATE matches
         SET home_goals = $1, away_goals = $2, status = 'FINISHED'
         WHERE external_match_id::text = $3::text
           AND home_goals IS NULL`,  // não re-atualiza o que já tem
        [gH, gA, String(m.id)]
      );
      updated += rowCount;
    }

    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   SETTLE BETS
   Marca resultado e lucro de apostas pendentes.
───────────────────────────────────────── */

app.post("/api/settle-bets", async (req, res) => {
  try {
    const { rows: unsettled } = await query(
      `SELECT bl.id, bl.external_match_id, bl.pick, bl.odd_taken, bl.stake
       FROM bet_log bl
       WHERE bl.result IS NULL`
    );

    let settled = 0;

    for (const bet of unsettled) {
      const { rows } = await query(
        `SELECT home_goals, away_goals FROM matches
         WHERE external_match_id = $1`,
        [bet.external_match_id]
      );
      if (!rows.length) continue;

      const { home_goals: gH, away_goals: gA } = rows[0];
      if (gH == null || gA == null) continue;

      const outcome = gH > gA ? "HOME" : gH < gA ? "AWAY" : "DRAW";
      const win     = outcome === bet.pick;
      const profit  = win ? (bet.odd_taken - 1) * bet.stake : -bet.stake;

      await query(
        `UPDATE bet_log SET result = $1, profit = $2 WHERE id = $3`,
        [win ? "WIN" : "LOSS", profit, bet.id]
      );
      settled++;
    }

    res.json({ ok: true, settled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   PERFORMANCE
   ROI global + breakdown por liga e confiança.
───────────────────────────────────────── */

app.get("/api/performance", async (req, res) => {
  try {
    // Sumário global
    const { rows: [g] } = await query(`
      SELECT
        COUNT(*)                                           AS total_bets,
        SUM(CASE WHEN result = 'WIN'  THEN 1 ELSE 0 END) AS wins,
        SUM(stake)                                         AS total_staked,
        SUM(profit)                                        AS net_units
      FROM bet_log
      WHERE result IS NOT NULL
    `);

    const totalBets   = Number(g.total_bets   ?? 0);
    const wins        = Number(g.wins          ?? 0);
    const totalStaked = Number(g.total_staked  ?? 0);
    const netUnits    = Number(g.net_units     ?? 0);

    // Por liga
    const { rows: byLeague } = await query(`
      SELECT
        league_code,
        COUNT(*)                                           AS bets,
        SUM(CASE WHEN result = 'WIN'  THEN 1 ELSE 0 END) AS wins,
        SUM(profit)                                        AS net_units
      FROM bet_log
      WHERE result IS NOT NULL
      GROUP BY league_code
      ORDER BY net_units DESC
    `);

    // Por nível de confiança
    const { rows: byConfidence } = await query(`
      SELECT
        COALESCE(confidence, 'UNKNOWN')                    AS confidence,
        COUNT(*)                                           AS bets,
        SUM(CASE WHEN result = 'WIN'  THEN 1 ELSE 0 END) AS wins,
        SUM(profit)                                        AS net_units
      FROM bet_log
      WHERE result IS NOT NULL
      GROUP BY confidence
      ORDER BY confidence
    `);

    res.json({
      ok: true,
      summary: {
        totalBets,
        wins,
        hitRate:    totalBets ? wins / totalBets : 0,
        totalStaked,
        netUnits,
        roi:        totalStaked ? netUnits / totalStaked : 0,
      },
      byLeague:     byLeague.map(r => ({
        league:   r.league_code,
        bets:     Number(r.bets),
        wins:     Number(r.wins),
        hitRate:  Number(r.bets) ? Number(r.wins) / Number(r.bets) : 0,
        netUnits: Number(r.net_units),
      })),
      byConfidence: byConfidence.map(r => ({
        confidence: r.confidence,
        bets:       Number(r.bets),
        wins:       Number(r.wins),
        hitRate:    Number(r.bets) ? Number(r.wins) / Number(r.bets) : 0,
        netUnits:   Number(r.net_units),
      })),
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   BACKTEST
   ROI real usando odds históricas do odds_snapshots.
───────────────────────────────────────── */

app.get("/api/backtest", async (req, res) => {
  try {
    const { league, min_ev = 0.01, min_edge = 0.02 } = req.query;
    if (!league) return res.status(400).json({ error: "league é obrigatório" });

    const { rows: matches } = await query(
      `SELECT home_team, away_team, home_goals, away_goals, match_date,
              external_match_id
       FROM matches
       WHERE competition_code = $1
         AND home_goals IS NOT NULL
       ORDER BY match_date ASC`,
      [league]
    );

    if (matches.length < 150) {
      return res.json({ error: `Dados insuficientes: ${matches.length} jogos (mínimo 150)` });
    }

    // Carrega odds históricas do Supabase (de uma vez, não por jogo)
    const { rows: snapshotRows } = await query(
      `SELECT external_match_id, odd_home, odd_draw, odd_away
      FROM odds_snapshots
      WHERE league_id IN (
        SELECT DISTINCT league_id FROM matches WHERE competition_code = $1
      )`,
      [league]
    );

    const oddsMap = new Map();
    for (const s of snapshotRows) {
      oddsMap.set(String(s.external_match_id), s);
    }

    const hasOdds = oddsMap.size > 0;
    if (!hasOdds) {
      console.warn(`[backtest] ${league}: sem odds históricas — usando stake fixa`);
    }

    let bankroll = 0, bets = 0, wins = 0;
    const predictions = []; // para métricas de calibração

    const TRAIN_START = 100;

    for (let i = TRAIN_START; i < matches.length; i++) {
      const trainSet = matches.slice(0, i);
      const test     = matches[i];

      const model = trainPoissonModel(trainSet);
      const lambdas = calculateLambdas(test.home_team, test.away_team, model);
      if (!lambdas) continue;

      const probs = calculateMatchProbabilities(lambdas.lambdaHome, lambdas.lambdaAway, model.rho);

      const actual = test.home_goals > test.away_goals ? "HOME"
                   : test.home_goals < test.away_goals ? "AWAY" : "DRAW";

      predictions.push({ prob: { home: probs.home, draw: probs.draw, away: probs.away }, result: actual });

      // Usa odds reais se disponíveis
      const snap = oddsMap.get(String(test.external_match_id));

      if (snap) {
        const mktProb = normalizeProbs(
          impliedProbability(snap.odd_home),
          impliedProbability(snap.odd_draw),
          impliedProbability(snap.odd_away),
        );

        const pick = pickBest1x2Opportunity({
          matchLabel: `${test.home_team} vs ${test.away_team}`,
          league,
          modelProb:  probs,
          bestOdds:   { bestHome: snap.odd_home, bestDraw: snap.odd_draw, bestAway: snap.odd_away },
          marketProb: mktProb,
          config:     { minEV: Number(min_ev), minEdge: Number(min_edge) },
        });

        if (!pick) continue;

        bets++;
        const odd  = pick.odd;
        const side = pick.pick;

        if (side === actual) {
          wins++;
          bankroll += (odd - 1) * 1; // stake 1u
        } else {
          bankroll -= 1;
        }

      } else {
        // Fallback: aposta no lado com maior prob
        const predicted = probs.home >= probs.draw && probs.home >= probs.away ? "HOME"
                        : probs.draw >= probs.away ? "DRAW" : "AWAY";
        bets++;
        if (predicted === actual) { wins++; bankroll += 1; }
        else                      { bankroll -= 1; }
      }
    }

    const metrics = evaluatePredictions(predictions);

    res.json({
      league,
      hasOddsData:    hasOdds,
      gamesTested:    predictions.length,
      bets,
      wins,
      hitRate:        bets ? Number((wins / bets).toFixed(4)) : 0,
      netUnits:       Number(bankroll.toFixed(2)),
      roi:            bets ? Number((bankroll / bets).toFixed(4)) : 0,
      // Métricas de calibração do modelo
      calibration: {
        brierScore: metrics.brierScore?.toFixed(5),
        logLoss:    metrics.logLoss?.toFixed(5),
        accuracy:   metrics.accuracy?.toFixed(4),
      },
    });

  } catch (err) {
    console.error("[backtest] erro:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   ODDS SNAPSHOT
   Salva odds atuais para uso futuro no backtest.
───────────────────────────────────────── */

app.post("/api/odds/snapshot", async (req, res) => {
  try {
    const matches = await fetchUpcomingMatches();
    const byLeague = {};

    for (const m of matches) {
      const code = m.competition?.code ?? m._competitionCode;
      if (!code || !LEAGUE_MAP[code]) continue;
      if (!byLeague[code]) byLeague[code] = [];
      byLeague[code].push(m);
    }

    let inserted = 0;

    for (const code of Object.keys(byLeague)) {
      const oddsEvents = await fetchOddsBySport(LEAGUE_MAP[code]);

      const batchParams = [];
      const batchRows   = [];
      let   pi          = 1;

      for (const match of byLeague[code]) {
        const home = match.homeTeam?.name;
        const away = match.awayTeam?.name;
        if (!home || !away) continue;

        const oddsEvent = oddsEvents.find(o =>
          isSameTeam(o.home_team, home) && isSameTeam(o.away_team, away)
        );
        if (!oddsEvent) continue;

        const best = extractBest1x2(oddsEvent);
        if (!best) continue;

        const overround =
          impliedProbability(best.bestHome) +
          impliedProbability(best.bestDraw) +
          impliedProbability(best.bestAway);

        batchRows.push(
          `($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},NOW(),'h2h','composite')`
        );
        batchParams.push(
          match.id, match.competition?.id,
          best.bestHome, best.bestDraw, best.bestAway, overround
        );
      }

      if (batchRows.length > 0) {
        await query(
          `INSERT INTO odds_snapshots
             (external_match_id, league_id, odd_home, odd_draw, odd_away,
              market_overround, captured_at, market, bookmaker)
           VALUES ${batchRows.join(",")}
           ON CONFLICT DO NOTHING`,
          batchParams
        );
        inserted += batchRows.length;
      }
    }

    res.json({ ok: true, inserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────
   DEBUG ROUTES (úteis em dev)
───────────────────────────────────────── */

app.get("/api/debug/upcoming",       async (req, res) => {
  try {
    const m = await fetchUpcomingMatches();
    res.json({ count: m.length, sample: m[0] ?? null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/debug/bets",           async (req, res) => {
  const r = await query("SELECT COUNT(*), SUM(profit) FROM bet_log");
  res.json(r.rows[0]);
});

app.get("/api/debug/unsettled-bets", async (req, res) => {
  const r = await query("SELECT id, external_match_id, pick FROM bet_log WHERE result IS NULL LIMIT 10");
  res.json(r.rows);
});

app.get("/api/debug/check-id",       async (req, res) => {
  const r = await query(
    "SELECT home_goals, away_goals FROM matches WHERE external_match_id = $1",
    [req.query.id]
  );
  res.json(r.rows);
});

app.get("/api/db-structure",         async (req, res) => {
  try {
    const r = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'matches' ORDER BY ordinal_position`
    );
    res.json({ columns: r.rows.map(r => r.column_name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/odds/sports",          async (req, res) => {
  try {
    const url  = `https://api.the-odds-api.com/v4/sports/?apiKey=${process.env.ODDS_API_KEY}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─────────────────────────────────────────
   UTILS
───────────────────────────────────────── */

function normalizeName(str = "") {
  return str.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

function isSameTeam(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.includes(nb) || nb.includes(na);
}


app.post("/api/ingest/:league", async (req, res) => {
  try {
    const { league } = req.params;
    const seasons = [2022, 2023, 2024];

    const { fetchHistoricalMatches } = await import(
      "./src/services/football-data-service.js"
    );

    const matches = await fetchHistoricalMatches(league, seasons);

    if (!matches.length) {
      return res.json({ ok: false, message: "Nenhuma partida retornada" });
    }

    let inserted = 0;

    for (const m of matches) {
      const gH = m.score?.fullTime?.home;
      const gA = m.score?.fullTime?.away;
      const date = m.utcDate;
      const home = m.homeTeam?.name;
      const away = m.awayTeam?.name;
      const compId   = m.competition?.id;
      const compCode = m.competition?.code ?? league;

      if (!home || !away || !date) continue;

      await query(
        `INSERT INTO matches
           (external_match_id, league_id, season, home_team, away_team,
            match_date, home_goals, away_goals, status, competition_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (external_match_id) DO UPDATE
           SET home_goals = EXCLUDED.home_goals,
               away_goals = EXCLUDED.away_goals,
               status     = EXCLUDED.status`,
        [
          String(m.id), compId, m.season?.startDate?.slice(0,4) ?? "2024",
          home, away, date, gH ?? null, gA ?? null,
          gH != null ? "FINISHED" : "SCHEDULED", compCode
        ]
      );
      inserted++;
    }

    res.json({ ok: true, league, inserted, total: matches.length });

  } catch (err) {
    console.error("[ingest]", err);
    res.status(500).json({ error: err.message });
  }
});

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use(express.static(__dirname));


/* ─────────────────────────────────────────
   START
───────────────────────────────────────── */

app.listen(PORT, () => {
  console.log(`🥚 Egg Stats rodando em http://localhost:${PORT}`);
  console.log(`   Mock odds: ${process.env.USE_MOCK_ODDS === "true" ? "✅ ATIVO" : "❌ desativado (API real)"}`);
});
