export function extractBest1x2(oddsEvent) {
  let bestHome = 0;
  let bestAway = 0;
  let bestDraw = 0;

  const homeName = oddsEvent.home_team;
  const awayName = oddsEvent.away_team;

  for (const bookmaker of oddsEvent.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      if (market.key !== "h2h") continue;

      for (const outcome of market.outcomes || []) {
        if (outcome.name === homeName) bestHome = Math.max(bestHome, outcome.price);
        if (outcome.name === awayName) bestAway = Math.max(bestAway, outcome.price);
        if (outcome.name === "Draw") bestDraw = Math.max(bestDraw, outcome.price);
      }
    }
  }

  if (!bestHome || !bestAway || !bestDraw) return null;
  return { bestHome, bestDraw, bestAway };
}

export function impliedProbability(odd) {
  return 1 / odd;
}

export function normalizeProbs(pHome, pDraw, pAway) {
  const total = pHome + pDraw + pAway;
  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total,
    overround: total,
  };
}

export function calculateEV(prob, odd) {
  return (prob * odd) - 1;
}

export function pickBest1x2Opportunity({
  matchLabel,
  league,
  modelProb,
  bestOdds,
  marketProb,
  config = {},
}) {
  const cfg = {
    minEdge: 0.02,
    minEV: 0.01,
    minOdd: 1.30,
    maxOdd: 8.00,
    maxOverround: 1.10,
    ...config,
  };

  if (!modelProb || !bestOdds || !marketProb) return null;

  for (const k of ["home", "draw", "away"]) {
    if (!Number.isFinite(modelProb[k]) || modelProb[k] <= 0 || modelProb[k] >= 1) return null;
    if (!Number.isFinite(marketProb[k]) || marketProb[k] <= 0 || marketProb[k] >= 1) return null;
  }

  if (Number.isFinite(marketProb.overround) && marketProb.overround > cfg.maxOverround) {
    return null;
  }

  const candidates = [
    { side: "HOME", odd: bestOdds.bestHome, pModel: modelProb.home, pMkt: marketProb.home },
    { side: "DRAW", odd: bestOdds.bestDraw, pModel: modelProb.draw, pMkt: marketProb.draw },
    { side: "AWAY", odd: bestOdds.bestAway, pModel: modelProb.away, pMkt: marketProb.away },
  ].filter((c) => Number.isFinite(c.odd) && c.odd >= cfg.minOdd && c.odd <= cfg.maxOdd);

  if (candidates.length === 0) return null;

  for (const c of candidates) {
    c.edge = c.pModel - c.pMkt;
    c.ev = calculateEV(c.pModel, c.odd);

    const oddsPenalty = Math.min(0.12, Math.max(0, (c.odd - 3) * 0.03));
    const lowProbPenalty = c.pModel < 0.12 ? 0.06 : 0;

    c.score = (0.70 * c.edge) + (0.30 * c.ev) - oddsPenalty - lowProbPenalty;
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best.edge < cfg.minEdge) return null;
  if (best.ev < cfg.minEV) return null;

  return {
    league,
    match: matchLabel,
    pick: best.side,
    odd: Number(best.odd.toFixed(3)),
    modelProb: { ...modelProb },
    marketProb: { home: marketProb.home, draw: marketProb.draw, away: marketProb.away },
    edge: best.edge,
    ev: best.ev,
    score: best.score,
    details: {
      pModel: best.pModel,
      pMkt: best.pMkt,
      overround: marketProb.overround,
    },
  };
}