/**
 * market-engine.js
 *
 * Compara probabilidades do modelo com o mercado e identifica oportunidades EV+.
 *
 * MUDANÇAS em relação à versão anterior:
 *   - Guards de NaN/Infinity em todos os cálculos
 *   - `pickBest1x2Opportunity` agora retorna também `confidence` (LOW/MEDIUM/HIGH)
 *   - `calculateEV` exportada e testável isoladamente
 *   - `scoreOpportunity` extraída (facilita testes unitários)
 *   - Sem alterações no algoritmo de score (funcionava bem)
 */

/* ─────────────────────────────────────────
   EXTRAÇÃO DE ODDS
───────────────────────────────────────── */

/**
 * Varre todos os bookmakers de um evento e retorna a melhor odd por seleção.
 * Compatível com o formato da The Odds API v4.
 */
export function extractBest1x2(oddsEvent) {
  if (!oddsEvent?.bookmakers?.length) return null;

  let bestHome = 0, bestDraw = 0, bestAway = 0;
  const homeName = oddsEvent.home_team;
  const awayName = oddsEvent.away_team;

  for (const bm of oddsEvent.bookmakers) {
    for (const mkt of bm.markets ?? []) {
      if (mkt.key !== "h2h") continue;
      for (const o of mkt.outcomes ?? []) {
        const price = Number(o.price);
        if (!Number.isFinite(price) || price <= 1) continue;
        if (o.name === homeName) bestHome = Math.max(bestHome, price);
        else if (o.name === awayName) bestAway = Math.max(bestAway, price);
        else if (o.name === "Draw") bestDraw = Math.max(bestDraw, price);
      }
    }
  }

  if (!bestHome || !bestDraw || !bestAway) return null;
  return { bestHome, bestDraw, bestAway };
}

/* ─────────────────────────────────────────
   PROBABILIDADE IMPLÍCITA / OVERROUND
───────────────────────────────────────── */

export function impliedProbability(odd) {
  if (!Number.isFinite(odd) || odd <= 0) return 0;
  return 1 / odd;
}

/**
 * Remove a margem da casa e retorna probabilidades normalizadas.
 * Também retorna o overround bruto para filtros.
 */
export function normalizeProbs(pHome, pDraw, pAway) {
  const total = pHome + pDraw + pAway;
  if (total === 0) return { home: 1/3, draw: 1/3, away: 1/3, overround: 1 };
  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total,
    overround: total,
  };
}

/* ─────────────────────────────────────────
   EV / EDGE
───────────────────────────────────────── */

/**
 * EV = p_modelo × odd_mercado − 1
 * Positivo → aposta com retorno esperado favorável no longo prazo.
 */
export function calculateEV(probModel, odd) {
  if (!Number.isFinite(probModel) || !Number.isFinite(odd)) return -Infinity;
  return probModel * odd - 1;
}

/**
 * Edge = p_modelo − p_mercado_normalizada
 * Representa vantagem informacional sobre o mercado.
 */
export function calculateEdge(probModel, probMarket) {
  if (!Number.isFinite(probModel) || !Number.isFinite(probMarket)) return -Infinity;
  return probModel - probMarket;
}

/* ─────────────────────────────────────────
   SCORE DE CONFIANÇA
───────────────────────────────────────── */

/**
 * Retorna nível de confiança qualitativo baseado em faixas empíricas.
 * Calibrado para o modelo Poisson com dados de futebol europeu.
 *
 * HIGH  → EV > 8%  E edge > 6%
 * MEDIUM→ EV > 4%  E edge > 3%
 * LOW   → qualquer oportunidade que passou nos filtros mínimos
 */
export function confidenceLevel(ev, edge) {
  if (ev >= 0.08 && edge >= 0.06) return "HIGH";
  if (ev >= 0.04 && edge >= 0.03) return "MEDIUM";
  return "LOW";
}

/**
 * Score numérico para ordenação (não deve ser exibido como probabilidade).
 * Penaliza odds muito altas (maior variância) e probabilidades muito baixas.
 */
export function scoreOpportunity(edge, ev, odd, pModel) {
  const oddsPenalty   = Math.min(0.12, Math.max(0, (odd - 3) * 0.03));
  const lowProbPenalty = pModel < 0.12 ? 0.06 : 0;
  return 0.70 * edge + 0.30 * ev - oddsPenalty - lowProbPenalty;
}

/* ─────────────────────────────────────────
   IDENTIFICAÇÃO DE OPORTUNIDADES
───────────────────────────────────────── */

const DEFAULT_CONFIG = {
  minEdge:      0.02,   // edge mínimo (2%)
  minEV:        0.01,   // EV mínimo (1%)
  minOdd:       1.30,
  maxOdd:       8.00,
  maxOverround: 1.10,   // mercados com margem > 10% ignorados
};

/**
 * Analisa os três lados de um mercado 1X2 e retorna a melhor oportunidade,
 * ou null se nenhuma atender aos critérios mínimos.
 *
 * @param {object} params
 * @param {string} params.matchLabel
 * @param {string} params.league
 * @param {{ home, draw, away }} params.modelProb   - probabilidades do modelo
 * @param {{ bestHome, bestDraw, bestAway }} params.bestOdds
 * @param {{ home, draw, away, overround }} params.marketProb - normalizada
 * @param {object} [params.config]                  - overrides de DEFAULT_CONFIG
 *
 * @returns {object|null}
 */
export function pickBest1x2Opportunity({
  matchLabel,
  league,
  modelProb,
  bestOdds,
  marketProb,
  config = {},
}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Guards básicos
  if (!modelProb || !bestOdds || !marketProb) return null;

  for (const k of ["home", "draw", "away"]) {
    const mp = modelProb[k];
    const mk = marketProb[k];
    if (!Number.isFinite(mp) || mp <= 0 || mp >= 1) return null;
    if (!Number.isFinite(mk) || mk <= 0 || mk >= 1) return null;
  }

  // Descarta mercados com overround excessivo (sinal de baixa liquidez)
  if (Number.isFinite(marketProb.overround) && marketProb.overround > cfg.maxOverround) {
    return null;
  }

  // Avalia cada lado
  const candidates = [
    { side: "HOME", odd: bestOdds.bestHome, pModel: modelProb.home, pMkt: marketProb.home },
    { side: "DRAW", odd: bestOdds.bestDraw, pModel: modelProb.draw, pMkt: marketProb.draw },
    { side: "AWAY", odd: bestOdds.bestAway, pModel: modelProb.away, pMkt: marketProb.away },
  ].filter(c =>
    Number.isFinite(c.odd) && c.odd >= cfg.minOdd && c.odd <= cfg.maxOdd
  );

  if (candidates.length === 0) return null;

  for (const c of candidates) {
    c.edge  = calculateEdge(c.pModel, c.pMkt);
    c.ev    = calculateEV(c.pModel, c.odd);
    c.score = scoreOpportunity(c.edge, c.ev, c.odd, c.pModel);
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Filtros mínimos
  if (best.edge < cfg.minEdge) return null;
  if (best.ev   < cfg.minEV)   return null;

  return {
    league,
    match:       matchLabel,
    pick:        best.side,
    odd:         Number(best.odd.toFixed(3)),
    edge:        Number(best.edge.toFixed(4)),
    ev:          Number(best.ev.toFixed(4)),
    score:       Number(best.score.toFixed(4)),
    confidence:  confidenceLevel(best.ev, best.edge),   // ← NOVO
    modelProb: {
      home: Number(modelProb.home.toFixed(4)),
      draw: Number(modelProb.draw.toFixed(4)),
      away: Number(modelProb.away.toFixed(4)),
    },
    marketProb: {
      home:      Number(marketProb.home.toFixed(4)),
      draw:      Number(marketProb.draw.toFixed(4)),
      away:      Number(marketProb.away.toFixed(4)),
      overround: Number((marketProb.overround ?? 1).toFixed(4)),
    },
    details: {
      pModel:    Number(best.pModel.toFixed(4)),
      pMkt:      Number(best.pMkt.toFixed(4)),
    },
  };
}
