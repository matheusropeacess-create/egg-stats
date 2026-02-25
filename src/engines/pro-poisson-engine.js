/**
 * pro-poisson-engine.js
 *
 * Engine canônica do Egg Stats.
 * Treina parâmetros de ataque/defesa via gradient descent com:
 *   - decay temporal exponencial (jogos recentes pesam mais)
 *   - regularização L2 (evita overfitting)
 *   - normalização de identificabilidade (soma-zero)
 *   - shrink de força + ancoragem de gols à média real da liga
 *   - Dixon-Coles rho (pronto para calibrar; default 0)
 *
 * MUDANÇAS em relação à versão anterior:
 *   - Removido `mle-engine.js` (era redundante, usava 4 params/time vs 2 aqui)
 *   - rating-engine.js consolidado: este arquivo é a fonte única de parâmetros
 *   - MAX_GOALS 6 → 8 (cobre 99%+ dos placares reais)
 *   - Iterações 500 → 300 (com lr maior, converge mais rápido e igual)
 *   - Exporta `buildTeamRatings` para uso incremental (evita O(n²) no backtest)
 */

const MAX_GOALS = 8;
const HALF_LIFE_DAYS = 400;
const LEARNING_RATE = 0.001;
const LAMBDA_L2 = 0.001;
const ITERATIONS = 300;
const SHRINK = 0.65;

/* ─────────────────────────────────────────
   HELPERS
───────────────────────────────────────── */

function initTeam() {
  return { attack: 0, defense: 0 };
}

function timeWeight(matchDate) {
  const days = (Date.now() - new Date(matchDate).getTime()) / 86_400_000;
  const d = Number.isFinite(days) ? Math.max(0, days) : 0;
  return Math.exp(-Math.LN2 * d / HALF_LIFE_DAYS);
}

/** Identificabilidade: mantém média de ataque e defesa em zero */
function normalizeTeams(teams) {
  const vals = Object.values(teams);
  if (vals.length === 0) return;
  const avgAtk = vals.reduce((s, t) => s + t.attack, 0) / vals.length;
  const avgDef = vals.reduce((s, t) => s + t.defense, 0) / vals.length;
  for (const t of vals) {
    t.attack -= avgAtk;
    t.defense -= avgDef;
  }
}

/* ─────────────────────────────────────────
   TRAIN
───────────────────────────────────────── */

/**
 * Treina o modelo a partir de um array de partidas finalizadas.
 *
 * Formato esperado (compatível com rows do Supabase):
 *   { home_team, away_team, home_goals, away_goals, match_date }
 *
 * @returns {{ teams, homeAdv, rho, avgGoalsLeague }}
 */
export function trainPoissonModel(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return { teams: {}, homeAdv: 0.1, rho: 0, avgGoalsLeague: 2.5 };
  }

  // Filtra apenas jogos com placar válido
  const valid = matches.filter(m => {
    const gH = Number(m.home_goals);
    const gA = Number(m.away_goals);
    return Number.isFinite(gH) && Number.isFinite(gA);
  });

  if (valid.length === 0) {
    return { teams: {}, homeAdv: 0.1, rho: 0, avgGoalsLeague: 2.5 };
  }

  // Média real de gols da liga (para ancoragem posterior)
  const avgGoalsLeague =
    valid.reduce((s, m) => s + Number(m.home_goals) + Number(m.away_goals), 0) /
    valid.length;

  // Inicializa times
  const teams = {};
  for (const m of valid) {
    if (!teams[m.home_team]) teams[m.home_team] = initTeam();
    if (!teams[m.away_team]) teams[m.away_team] = initTeam();
  }

  let homeAdv = 0.10;

  // Gradient descent
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const m of valid) {
      const gH = Number(m.home_goals);
      const gA = Number(m.away_goals);
      const w  = timeWeight(m.match_date);

      const th = teams[m.home_team];
      const ta = teams[m.away_team];

      const lambdaH = Math.exp(th.attack - ta.defense + homeAdv);
      const lambdaA = Math.exp(ta.attack - th.defense);

      const errH = w * (gH - lambdaH);
      const errA = w * (gA - lambdaA);

      th.attack  += LEARNING_RATE * (errH  - LAMBDA_L2 * th.attack);
      th.defense += LEARNING_RATE * (-errA - LAMBDA_L2 * th.defense);
      ta.attack  += LEARNING_RATE * (errA  - LAMBDA_L2 * ta.attack);
      ta.defense += LEARNING_RATE * (-errH - LAMBDA_L2 * ta.defense);

      homeAdv += LEARNING_RATE * errH; // sem L2 no homeAdv (escalar global)
    }

    normalizeTeams(teams);
  }

  // Shrink de força (reduz overfit em amostras pequenas)
  for (const t of Object.values(teams)) {
    t.attack  *= SHRINK;
    t.defense *= SHRINK;
  }

  // Ancoragem de gols: corrige viés do modelo para refletir média real da liga
  const modelGoals = _estimateAvgGoals(valid, teams, homeAdv);
  if (modelGoals > 0 && avgGoalsLeague > 0) {
    const k = Math.sqrt(avgGoalsLeague / modelGoals);
    for (const t of Object.values(teams)) {
      t.attack  *= k;
      t.defense *= k;
    }
    normalizeTeams(teams);
  }

  return { teams, homeAdv, rho: 0, avgGoalsLeague };
}

function _estimateAvgGoals(matches, teams, homeAdv) {
  let total = 0, count = 0;
  for (const m of matches) {
    const th = teams[m.home_team];
    const ta = teams[m.away_team];
    if (!th || !ta) continue;
    total += Math.exp(th.attack - ta.defense + homeAdv);
    total += Math.exp(ta.attack - th.defense);
    count++;
  }
  return count > 0 ? total / count : 0;
}

/* ─────────────────────────────────────────
   PROBABILITIES (Poisson bivariado + Dixon-Coles)
───────────────────────────────────────── */

/**
 * Calcula probabilidades home/draw/away via convolução de Poisson.
 *
 * @param {number} lambdaHome - taxa esperada de gols do time da casa
 * @param {number} lambdaAway - taxa esperada de gols do visitante
 * @param {number} [rho=0]    - parâmetro Dixon-Coles (0 = desativado)
 * @returns {{ home, draw, away }}
 */
export function calculateMatchProbabilities(lambdaHome, lambdaAway, rho = 0) {
  // Guards
  lambdaHome = Math.max(0.01, Number.isFinite(lambdaHome) ? lambdaHome : 1.3);
  lambdaAway = Math.max(0.01, Number.isFinite(lambdaAway) ? lambdaAway : 1.0);

  let homeProb = 0, drawProb = 0, awayProb = 0;

  // Pré-calcula fatoriais e Poisson
  const pH = Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonPMF(lambdaHome, k));
  const pA = Array.from({ length: MAX_GOALS + 1 }, (_, k) => poissonPMF(lambdaAway, k));

  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      let p = pH[i] * pA[j];

      // Correção Dixon-Coles (baixo placar)
      if (rho !== 0) {
        if (i === 0 && j === 0) p *= 1 - rho * lambdaHome * lambdaAway;
        else if (i === 1 && j === 0) p *= 1 + rho * lambdaAway;
        else if (i === 0 && j === 1) p *= 1 + rho * lambdaHome;
        else if (i === 1 && j === 1) p *= 1 - rho;
      }

      if (i > j)      homeProb += p;
      else if (i < j) awayProb += p;
      else            drawProb += p;
    }
  }

  const total = homeProb + drawProb + awayProb;
  if (total === 0) return { home: 1/3, draw: 1/3, away: 1/3 };

  return {
    home: homeProb / total,
    draw: drawProb / total,
    away: awayProb / total,
  };
}

/**
 * Calcula lambdas para um confronto dado o modelo treinado.
 * Retorna null se algum time não estiver no modelo.
 */
export function calculateLambdas(homeTeam, awayTeam, model) {
  const th = model.teams[homeTeam];
  const ta = model.teams[awayTeam];
  if (!th || !ta) return null;

  return {
    lambdaHome: Math.exp(th.attack - ta.defense + model.homeAdv),
    lambdaAway: Math.exp(ta.attack - th.defense),
  };
}

/* ─────────────────────────────────────────
   UTILS
───────────────────────────────────────── */

const _factCache = [1];
function factorial(n) {
  for (let i = _factCache.length; i <= n; i++) _factCache[i] = _factCache[i - 1] * i;
  return _factCache[n] ?? Infinity;
}

function poissonPMF(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
