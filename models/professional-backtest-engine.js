import { trainModel } from "./mle-engine.js";

/* ================= UTIL ================= */

function factorial(n) {
  if (n === 0) return 1;
  return n * factorial(n - 1);
}

function poisson(lambda, k) {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function calculateMatchProbabilities(lambdaHome, lambdaAway) {
  let homeProb = 0,
    drawProb = 0,
    awayProb = 0;

  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const p = poisson(lambdaHome, i) * poisson(lambdaAway, j);
      if (i > j) homeProb += p;
      else if (i === j) drawProb += p;
      else awayProb += p;
    }
  }

  const total = homeProb + drawProb + awayProb;

  return {
    homeProb: homeProb / total,
    drawProb: drawProb / total,
    awayProb: awayProb / total,
  };
}

/* 🔥 shrink fixo (melhor zona observada) */
function shrinkProbabilities(probs, baseline, alpha = 0.88) {
  return {
    homeProb: alpha * probs.homeProb + (1 - alpha) * baseline.home,
    drawProb: alpha * probs.drawProb + (1 - alpha) * baseline.draw,
    awayProb: alpha * probs.awayProb + (1 - alpha) * baseline.away,
  };
}

/* ================= BACKTEST ================= */

export function runProfessionalBacktest(matches) {
  const MIN_TRAIN_SIZE = 50;

  if (!Array.isArray(matches) || matches.length <= MIN_TRAIN_SIZE)
    throw new Error("Poucos jogos para backtest");

  let totalLogLoss = 0;
  let totalBrier = 0;
  let totalGames = 0;
  let correct = 0;

  for (let i = MIN_TRAIN_SIZE; i < matches.length; i++) {
    const trainSet = matches.slice(0, i);
    const testMatch = matches[i];

    const model = trainModel(trainSet);

    // baseline real da liga (no trainSet)
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;

    for (const m of trainSet) {
      if (m.goals.home > m.goals.away) homeWins++;
      else if (m.goals.home === m.goals.away) draws++;
      else awayWins++;
    }

    const totalLeagueGames = trainSet.length;

    const leagueBaseline = {
      home: homeWins / totalLeagueGames,
      draw: draws / totalLeagueGames,
      away: awayWins / totalLeagueGames,
    };

    const home = testMatch.teams.home.name;
    const away = testMatch.teams.away.name;

    const lambdaHome = Math.exp(
      (model.teams[home]?.attackHome || 0) -
        (model.teams[away]?.defenseAway || 0) +
        model.homeAdv
    );

    const lambdaAway = Math.exp(
      (model.teams[away]?.attackAway || 0) -
        (model.teams[home]?.defenseHome || 0)
    );

    let probs = calculateMatchProbabilities(lambdaHome, lambdaAway);
    probs = shrinkProbabilities(probs, leagueBaseline, 0.88);

    const homeGoals = testMatch.goals.home;
    const awayGoals = testMatch.goals.away;

    const actual = { home: 0, draw: 0, away: 0 };
    if (homeGoals > awayGoals) actual.home = 1;
    else if (homeGoals === awayGoals) actual.draw = 1;
    else actual.away = 1;

    const epsilon = 1e-15;

    const logLoss = -(
      actual.home * Math.log(Math.max(probs.homeProb, epsilon)) +
      actual.draw * Math.log(Math.max(probs.drawProb, epsilon)) +
      actual.away * Math.log(Math.max(probs.awayProb, epsilon))
    );

    totalLogLoss += logLoss;

    const brier =
      Math.pow(probs.homeProb - actual.home, 2) +
      Math.pow(probs.drawProb - actual.draw, 2) +
      Math.pow(probs.awayProb - actual.away, 2);

    totalBrier += brier;

    const predicted =
      probs.homeProb > probs.drawProb && probs.homeProb > probs.awayProb
        ? "home"
        : probs.drawProb > probs.awayProb
        ? "draw"
        : "away";

    const real =
      homeGoals > awayGoals ? "home" : homeGoals === awayGoals ? "draw" : "away";

    if (predicted === real) correct++;

    totalGames++;
  }

  return {
    gamesTested: totalGames,
    avgLogLoss: Number((totalLogLoss / totalGames).toFixed(5)),
    avgBrierScore: Number((totalBrier / totalGames).toFixed(5)),
    accuracyPct: Number(((correct / totalGames) * 100).toFixed(2)),
  };
}

/* ================= DIAGNOSTICS (CALIBRATION BUCKETS) ================= */
/**
 * Retorna buckets por faixa de confiança do "pick" (max prob)
 * Ex.: 40-60: predicted soma das probs máximas, actual acertos, count jogos
 */
export function runDiagnostics(matches) {
  const MIN_TRAIN_SIZE = 50;

  if (!Array.isArray(matches) || matches.length <= MIN_TRAIN_SIZE)
    throw new Error("Poucos jogos para diagnostics");

  const buckets = {
    "0-20": { predicted: 0, actual: 0, count: 0 },
    "20-40": { predicted: 0, actual: 0, count: 0 },
    "40-60": { predicted: 0, actual: 0, count: 0 },
    "60-80": { predicted: 0, actual: 0, count: 0 },
    "80-100": { predicted: 0, actual: 0, count: 0 },
  };

  for (let i = MIN_TRAIN_SIZE; i < matches.length; i++) {
    const trainSet = matches.slice(0, i);
    const testMatch = matches[i];

    const model = trainModel(trainSet);

    // baseline liga (trainSet)
    let homeWins = 0,
      draws = 0,
      awayWins = 0;

    for (const m of trainSet) {
      if (m.goals.home > m.goals.away) homeWins++;
      else if (m.goals.home === m.goals.away) draws++;
      else awayWins++;
    }

    const totalLeagueGames = trainSet.length;

    const leagueBaseline = {
      home: homeWins / totalLeagueGames,
      draw: draws / totalLeagueGames,
      away: awayWins / totalLeagueGames,
    };

    const home = testMatch.teams.home.name;
    const away = testMatch.teams.away.name;

    const lambdaHome = Math.exp(
      (model.teams[home]?.attackHome || 0) -
        (model.teams[away]?.defenseAway || 0) +
        model.homeAdv
    );

    const lambdaAway = Math.exp(
      (model.teams[away]?.attackAway || 0) -
        (model.teams[home]?.defenseHome || 0)
    );

    let probs = calculateMatchProbabilities(lambdaHome, lambdaAway);
    probs = shrinkProbabilities(probs, leagueBaseline, 0.88);

    const maxProb = Math.max(probs.homeProb, probs.drawProb, probs.awayProb);

    const homeGoals = testMatch.goals.home;
    const awayGoals = testMatch.goals.away;

    // acertou o resultado que tinha maxProb?
    let hit = 0;
    if (maxProb === probs.homeProb && homeGoals > awayGoals) hit = 1;
    else if (maxProb === probs.drawProb && homeGoals === awayGoals) hit = 1;
    else if (maxProb === probs.awayProb && homeGoals < awayGoals) hit = 1;

    const pct = maxProb * 100;

    let key = "80-100";
    if (pct < 20) key = "0-20";
    else if (pct < 40) key = "20-40";
    else if (pct < 60) key = "40-60";
    else if (pct < 80) key = "60-80";

    buckets[key].predicted += maxProb;
    buckets[key].actual += hit;
    buckets[key].count += 1;
  }

  return buckets;
}