import "dotenv/config";
import express from "express";
import { query } from "./src/config/db.js";

import {
  fetchUpcomingMatches,
  fetchRecentFinishedMatches
} from "./src/services/football-data-service.js";

import { fetchOddsBySport } from "./src/services/odds-api-service.js";
import { LEAGUE_MAP } from "./src/config/league-mapping.js";

import {
  extractBest1x2,
  impliedProbability,
  normalizeProbs,
  pickBest1x2Opportunity,
} from "./src/engines/market-engine.js";

import {
  trainPoissonModel,
  calculateMatchProbabilities,
} from "./src/engines/pro-poisson-engine.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

/* ================= HEALTH ================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    port: PORT,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasFootballDataKey: Boolean(process.env.FOOTBALL_DATA_KEY),
    hasOddsApiKey: Boolean(process.env.ODDS_API_KEY),
  });
});

/* ================= DB CHECK ================= */

app.get("/api/db-check", async (req, res) => {
  try {
    const result = await query("SELECT NOW() AS now");
    res.json({ ok: true, databaseTime: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================= DEBUG SPORTS ================= */

app.get("/api/odds/sports", async (req, res) => {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${process.env.ODDS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= LIVE TEST ================= */

app.get("/api/live/test", async (req, res) => {
  try {
    const matches = await fetchRecentFinishedMatches();

    res.json({
      ok: true,
      matchesCount: matches.length,
      sampleMatch: matches[0] || null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ================= OPPORTUNITIES ================= */

app.get("/api/opportunities", async (req, res) => {
  try {

    const matches = await fetchUpcomingMatches();
    const opportunities = [];

    const competitions = {};

    for (const match of matches) {
      const code = match?.competition?.code;
      if (!code || !LEAGUE_MAP[code]) continue;

      if (!competitions[code]) competitions[code] = [];
      competitions[code].push(match);
    }

    for (const code of Object.keys(competitions)) {

      const dbMatches = await query(
        `SELECT home_team, away_team, home_goals, away_goals, match_date
         FROM matches
         WHERE competition_code = $1
           AND home_goals IS NOT NULL
           AND away_goals IS NOT NULL`,
        [code]
      );

      if (dbMatches.rows.length < 50) continue;

      const model = trainPoissonModel(dbMatches.rows);

      const sportKey = LEAGUE_MAP[code];
      const oddsEvents = await fetchOddsBySport(sportKey);

      for (const match of competitions[code]) {

        const home = match.homeTeam?.name;
        const away = match.awayTeam?.name;
        if (!home || !away) continue;

        const oddsEvent = oddsEvents.find(o =>
          isSameTeam(o.home_team, home) &&
          isSameTeam(o.away_team, away)
        );

        if (!oddsEvent) continue;

        const best = extractBest1x2(oddsEvent);
        if (!best) continue;

        const impliedHome = impliedProbability(best.bestHome);
        const impliedDraw = impliedProbability(best.bestDraw);
        const impliedAway = impliedProbability(best.bestAway);

        const normalized = normalizeProbs(
          impliedHome,
          impliedDraw,
          impliedAway
        );

        const teamHome = model.teams[home];
        const teamAway = model.teams[away];
        if (!teamHome || !teamAway) continue;

        const lambdaHome = Math.exp(
          teamHome.attack - teamAway.defense + model.homeAdv
        );

        const lambdaAway = Math.exp(
          teamAway.attack - teamHome.defense
        );

        const modelProb = calculateMatchProbabilities(
          lambdaHome,
          lambdaAway,
          model.rho
        );

        const pick = pickBest1x2Opportunity({
          matchLabel: `${home} vs ${away}`,
          league: code,
          modelProb,
          bestOdds: best,
          marketProb: normalized,
          config: {
            minEdge: 0.02,
            minEV: 0.01,
            minOdd: 1.30,
            maxOdd: 7.0,
            maxOverround: 1.10
          }
        });

        if (pick) {

          opportunities.push(pick);

          const exists = await query(
            `SELECT id FROM bet_log
             WHERE external_match_id = $1
               AND pick = $2`,
            [match.id, pick.pick]
          );

          if (exists.rows.length === 0) {
            await query(
              `INSERT INTO bet_log
              (external_match_id, league_code, match_label, pick,
               odd_taken, model_prob, market_prob,
               edge, ev, stake)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                match.id,
                code,
                pick.match,
                pick.pick,
                pick.odd,
                pick.details.pModel,
                pick.details.pMkt,
                pick.edge,
                pick.ev,
                1
              ]
            );
          }

        }

      }

    }

    opportunities.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    res.json({
      ok: true,
      count: opportunities.length,
      top: opportunities.slice(0, 10)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/debug/bets", async (req, res) => {
  const result = await query("SELECT COUNT(*) FROM bet_log");
  res.json(result.rows[0]);
});

app.get("/api/debug/finished-matches", async (req, res) => {
  const result = await query(`
    SELECT external_match_id, home_goals, away_goals
    FROM matches
    WHERE home_goals IS NOT NULL
    LIMIT 5
  `);

  res.json(result.rows);
});

app.get("/api/debug/unsettled-bets", async (req, res) => {
  const result = await query(`
    SELECT id, external_match_id
    FROM bet_log
    WHERE result IS NULL
    LIMIT 5
  `);

  res.json(result.rows);
});

app.get("/api/debug/check-id", async (req, res) => {
  const id = req.query.id;

  const result = await query(
    `SELECT home_goals, away_goals
     FROM matches
     WHERE external_match_id = $1`,
    [id]
  );

  res.json(result.rows);
});

app.get("/api/db-structure", async (req, res) => {
  try {
    const result = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'matches'
      ORDER BY ordinal_position
    `);

    res.json({
      columns: result.rows.map(r => r.column_name)
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ================= DEBUG: odds Serie A ================= */

app.get("/api/test/seriea-odds", async (req, res) => {
  try {
    const sportKey = "soccer_italy_serie_a";

    const url =
      `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
      `?apiKey=${process.env.ODDS_API_KEY}` +
      `&regions=eu` +
      `&markets=h2h` +
      `&oddsFormat=decimal`;

    const response = await fetch(url);
    const data = await response.json();

    res.json({
      count: Array.isArray(data) ? data.length : 0,
      sample: Array.isArray(data) ? data[0] : data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= DEBUG upcoming ================= */

app.get("/api/debug/upcoming", async (req, res) => {
  try {
    const matches = await fetchUpcomingMatches();
    res.json({
      count: matches.length,
      sample: matches[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= NORMALIZER ================= */

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\b(acf|ac|fc|cf|1909|club|football|calcio)\b/g, "")
    .replace(/[^a-z]/g, "") // remove tudo que não for letra
    .trim();
}


app.get("/api/backtest", async (req, res) => {
  try {
    const league = req.query.league;
    if (!league) return res.status(400).json({ error: "league required" });

    const result = await query(
      `SELECT home_team, away_team, home_goals, away_goals, match_date
       FROM matches
       WHERE competition_code = $1
       ORDER BY match_date ASC`,
      [league]
    );

    const matches = result.rows;
    if (matches.length < 150)
      return res.json({ error: "Not enough data" });

    let bankroll = 0;
    let bets = 0;
    let wins = 0;

    for (let i = 100; i < matches.length; i++) {

      const trainSet = matches.slice(0, i);
      const testMatch = matches[i];

      const model = trainPoissonModel(trainSet);

      const home = testMatch.home_team;
      const away = testMatch.away_team;

      if (!model.teams[home] || !model.teams[away]) continue;

      const lambdaHome = Math.exp(
        model.teams[home].attack -
        model.teams[away].defense +
        model.homeAdv
      );

      const lambdaAway = Math.exp(
        model.teams[away].attack -
        model.teams[home].defense
      );

      const probs = calculateMatchProbabilities(
        lambdaHome,
        lambdaAway,
        model.rho
      );

      // Estratégia simples: apostar no lado com maior prob
      let predicted = "home";
      let maxProb = probs.home;

      if (probs.draw > maxProb) {
        predicted = "draw";
        maxProb = probs.draw;
      }

      if (probs.away > maxProb) {
        predicted = "away";
        maxProb = probs.away;
      }

      bets++;

      const gH = testMatch.home_goals;
      const gA = testMatch.away_goals;

      let resultSide =
        gH > gA ? "home" :
        gH < gA ? "away" :
        "draw";

      if (predicted === resultSide) {
        wins++;
        bankroll += 1;  // stake fixa 1
      } else {
        bankroll -= 1;
      }
    }

    res.json({
      league,
      bets,
      wins,
      hitRate: wins / bets,
      netUnits: bankroll,
      roi: bankroll / bets
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



/* ================= ODDS SNAPSHOT ================= */

function isSameTeam(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return na.includes(nb) || nb.includes(na);
}

app.post("/api/odds/snapshot", async (req, res) => {
  try {

    const matches = await fetchUpcomingMatches();

    // Agrupar partidas por liga
    const competitions = {};

    for (const match of matches) {
      const code = match.competition.code;
      if (!LEAGUE_MAP[code]) continue;

      if (!competitions[code]) competitions[code] = [];
      competitions[code].push(match);
    }

    let inserted = 0;

    for (const code of Object.keys(competitions)) {

      const sportKey = LEAGUE_MAP[code];

      // 🔥 CHAMA API UMA VEZ POR LIGA
      const oddsEvents = await fetchOddsBySport(sportKey);

      for (const match of competitions[code]) {

        const oddsEvent = oddsEvents.find(o =>
          isSameTeam(o.home_team, match.homeTeam.name) &&
          isSameTeam(o.away_team, match.awayTeam.name)
        );

        if (!oddsEvent) continue;

        const best = extractBest1x2(oddsEvent);
        if (!best) continue;

        const impliedHome = 1 / best.bestHome;
        const impliedDraw = 1 / best.bestDraw;
        const impliedAway = 1 / best.bestAway;

        const overround = impliedHome + impliedDraw + impliedAway;

        await query(
          `INSERT INTO odds_snapshots
           (external_match_id, league_id, odd_home, odd_draw, odd_away,
            market_overround, captured_at, market, bookmaker)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8)`,
          [
            match.id,
            match.competition.id,
            best.bestHome,
            best.bestDraw,
            best.bestAway,
            overround,
            "h2h",
            "composite"
          ]
        );

        inserted++;
      }
    }

    res.json({ ok: true, inserted });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/settle-bets", async (req, res) => {
  try {

    const unsettled = await query(
      `SELECT * FROM bet_log
       WHERE result IS NULL`
    );

    let settled = 0;

    for (const bet of unsettled.rows) {

      const resultMatch = await query(
        `SELECT home_goals, away_goals
         FROM matches
         WHERE external_match_id = $1`,
        [bet.external_match_id]
      );

      if (!resultMatch.rows.length) continue;

      const m = resultMatch.rows[0];

      let outcome;

      if (m.home_goals > m.away_goals) outcome = "HOME";
      else if (m.home_goals < m.away_goals) outcome = "AWAY";
      else outcome = "DRAW";

      const win = outcome === bet.pick;

      const profit = win
        ? (bet.odd_taken - 1) * bet.stake
        : -bet.stake;

      await query(
        `UPDATE bet_log
         SET result = $1,
             profit = $2
         WHERE id = $3`,
        [win ? "WIN" : "LOSS", profit, bet.id]
      );

      settled++;
    }

    res.json({ ok: true, settled });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/performance", async (req, res) => {
  try {

    const stats = await query(`
      SELECT
        COUNT(*) as bets,
        SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
        SUM(profit) as net_units
      FROM bet_log
      WHERE result IS NOT NULL
    `);

    const bets = Number(stats.rows[0].bets || 0);
    const wins = Number(stats.rows[0].wins || 0);
    const net = Number(stats.rows[0].net_units || 0);

    res.json({
      bets,
      wins,
      hitRate: bets ? wins / bets : 0,
      netUnits: net,
      roi: bets ? net / bets : 0
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/sync-results", async (req, res) => {
  try {

    const matches = await fetchRecentFinishedMatches();

    let updated = 0;

    for (const match of matches) {

      const homeGoals = match.score?.fullTime?.home;
      const awayGoals = match.score?.fullTime?.away;

      if (homeGoals == null || awayGoals == null) continue;

      await query(
        `UPDATE matches
         SET home_goals = $1,
             away_goals = $2,
             status = 'FINISHED'
         WHERE external_match_id::text = $3::text`,
        [homeGoals, awayGoals, match.id]
      );

      updated++;
    }

    res.json({ ok: true, updated });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/debug/check-match/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const url = `https://api.football-data.org/v4/matches/${id}`;

    const response = await fetch(url, {
      headers: {
        "X-Auth-Token": process.env.FOOTBALL_DATA_KEY
      }
    });

    const data = await response.json();

    res.json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`Egg Stats running on http://localhost:${PORT}`);
});