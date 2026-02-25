// models/rating-engine.js

const K = 0.05;
const HOME_ADV = 0.15;

function daysBetween(d1, d2) {
  return Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
}

function decayWeight(days, halfLife = 60) {
  const lambda = Math.log(2) / halfLife;
  return Math.exp(-lambda * days);
}

export function buildRatings(matches) {
  const ratings = {};

  const sorted = matches
    .filter(m => m.status === "FINISHED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  for (const m of sorted) {
    const date = new Date(m.utcDate);

    const home = m.homeTeam.name;
    const away = m.awayTeam.name;

    if (!ratings[home]) ratings[home] = { attack: 0, defense: 0 };
    if (!ratings[away]) ratings[away] = { attack: 0, defense: 0 };

    const homeGoals = m.score.fullTime.home;
    const awayGoals = m.score.fullTime.away;

    const weight = decayWeight(
      daysBetween(new Date(), date)
    );

    const expectedHome = Math.exp(
      ratings[home].attack -
      ratings[away].defense +
      HOME_ADV
    );

    const expectedAway = Math.exp(
      ratings[away].attack -
      ratings[home].defense
    );

    const errorHome = homeGoals - expectedHome;
    const errorAway = awayGoals - expectedAway;

    ratings[home].attack += K * errorHome * weight;
    ratings[home].defense += K * (-errorAway) * weight;

    ratings[away].attack += K * errorAway * weight;
    ratings[away].defense += K * (-errorHome) * weight;
  }

  return ratings;
}

export function calculateLambdas(home, away, ratings) {
  const homeRating = ratings[home] || { attack: 0, defense: 0 };
  const awayRating = ratings[away] || { attack: 0, defense: 0 };

  const lambdaHome = Math.exp(
    homeRating.attack -
    awayRating.defense +
    HOME_ADV
  );

  const lambdaAway = Math.exp(
    awayRating.attack -
    homeRating.defense
  );

  return { lambdaHome, lambdaAway };
}
