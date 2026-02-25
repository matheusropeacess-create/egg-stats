const MAX_GOALS = 6;

/* ================= TRAIN ================= */

export function trainPoissonModel(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return { teams: {}, homeAdv: 0, rho: 0 };
  }

  // Média real de gols da liga (ancoragem)
  const avgGoalsLeague =
    matches.reduce((s, m) => s + Number(m.home_goals ?? 0) + Number(m.away_goals ?? 0), 0) /
    matches.length;

  const teams = {};
  const now = new Date();

  // init teams
  for (const m of matches) {
    const h = m.home_team;
    const a = m.away_team;
    if (!teams[h]) teams[h] = initTeam();
    if (!teams[a]) teams[a] = initTeam();
  }

  let homeAdv = 0.10;
  const rho = 0; // (mantemos 0 por enquanto; DC-rho tuning vem depois)

  const learningRate = 0.001;
  const lambdaL2 = 0.001;
  const HALF_LIFE_DAYS = 400;

  // Treino por gradiente
  for (let iter = 0; iter < 500; iter++) {
    for (const m of matches) {
      const gH = Number(m.home_goals);
      const gA = Number(m.away_goals);

      // só treina com jogos finalizados com gols numéricos
      if (!Number.isFinite(gH) || !Number.isFinite(gA)) continue;

      const daysDiff = (now - new Date(m.match_date)) / (1000 * 60 * 60 * 24);
      const weight = Math.exp(-Math.log(2) * (Number.isFinite(daysDiff) ? daysDiff : 0) / HALF_LIFE_DAYS);

      const home = m.home_team;
      const away = m.away_team;

      const th = teams[home];
      const ta = teams[away];
      if (!th || !ta) continue;

      const lambdaHome = Math.exp(th.attack - ta.defense + homeAdv);
      const lambdaAway = Math.exp(ta.attack - th.defense);

      // gradientes (Poisson)
      th.attack += learningRate * (weight * (gH - lambdaHome) - lambdaL2 * th.attack);
      th.defense += learningRate * (weight * (lambdaAway - gA) - lambdaL2 * th.defense);

      ta.attack += learningRate * (weight * (gA - lambdaAway) - lambdaL2 * ta.attack);
      ta.defense += learningRate * (weight * (lambdaHome - gH) - lambdaL2 * ta.defense);

      // home advantage global
      homeAdv += learningRate * weight * (gH - lambdaHome);
    }

    // Identificabilidade: soma zero em ataque/defesa
    normalizeTeams(teams);
  }

  // 1) Strength shrink (puxa forças em direção à média)
  const SHRINK = 0.65;
  for (const t of Object.values(teams)) {
    t.attack *= SHRINK;
    t.defense *= SHRINK;
  }

  // 2) League Goal Normalization (ancora média de gols do modelo)
  // estima gols médios previstos pelo modelo (em média por jogo)
  let totalLambda = 0;
  let used = 0;

  for (const m of matches) {
    const home = teams[m.home_team];
    const away = teams[m.away_team];
    const gH = Number(m.home_goals);
    const gA = Number(m.away_goals);

    if (!home || !away) continue;
    if (!Number.isFinite(gH) || !Number.isFinite(gA)) continue;

    const lambdaHome = Math.exp(home.attack - away.defense + homeAdv);
    const lambdaAway = Math.exp(away.attack - home.defense);

    totalLambda += (lambdaHome + lambdaAway);
    used++;
  }

  const avgModelGoals = used > 0 ? (totalLambda / used) : 0;

  if (avgModelGoals > 0 && Number.isFinite(avgModelGoals) && avgGoalsLeague > 0 && Number.isFinite(avgGoalsLeague)) {
    const correction = avgGoalsLeague / avgModelGoals;

    // correção suave e estável
    const k = Math.sqrt(correction);

    for (const t of Object.values(teams)) {
      t.attack *= k;
      t.defense *= k;
    }

    // re-normaliza depois da transformação
    normalizeTeams(teams);
  }

  return { teams, homeAdv, rho };
}

function initTeam() {
  return { attack: 0, defense: 0 };
}

function normalizeTeams(teams) {
  const teamList = Object.values(teams);
  if (teamList.length === 0) return;

  const avgAttack = teamList.reduce((s, t) => s + t.attack, 0) / teamList.length;
  const avgDefense = teamList.reduce((s, t) => s + t.defense, 0) / teamList.length;

  for (const t of teamList) {
    t.attack -= avgAttack;
    t.defense -= avgDefense;
  }
}

/* ================= PROBABILITIES ================= */

export function calculateMatchProbabilities(lambdaHome, lambdaAway, rho = 0) {
  let homeProb = 0;
  let drawProb = 0;
  let awayProb = 0;

  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      let p = poisson(lambdaHome, i) * poisson(lambdaAway, j);

      // Dixon-Coles “shape” (mantemos, mas rho=0 por enquanto)
      if (i === 0 && j === 0) p *= 1 - rho;
      if (i === 1 && j === 0) p *= 1 + rho;
      if (i === 0 && j === 1) p *= 1 + rho;
      if (i === 1 && j === 1) p *= 1 - rho;

      if (i > j) homeProb += p;
      else if (i === j) drawProb += p;
      else awayProb += p;
    }
  }

  const total = homeProb + drawProb + awayProb;
  return {
    home: homeProb / total,
    draw: drawProb / total,
    away: awayProb / total,
  };
}

function poisson(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}