export function trainModel(matches) {

  const teams = {};
  let homeAdv = 0;

  const totalMatches = matches.length;

  for (const match of matches) {

    const home = match.teams.home.name;
    const away = match.teams.away.name;

    if (!teams[home]) {
      teams[home] = {
        attackHome: 0,
        attackAway: 0,
        defenseHome: 0,
        defenseAway: 0
      };
    }

    if (!teams[away]) {
      teams[away] = {
        attackHome: 0,
        attackAway: 0,
        defenseHome: 0,
        defenseAway: 0
      };
    }
  }

  const learningRate = 0.0003;
  const iterations = 600;
  const regularization = 0.001;
  const decayRate = 0.003; // time decay leve

  for (let iter = 0; iter < iterations; iter++) {

    for (let i = 0; i < matches.length; i++) {

      const match = matches[i];

      const home = match.teams.home.name;
      const away = match.teams.away.name;

      const goalsHome = match.goals.home;
      const goalsAway = match.goals.away;

      const age = totalMatches - i;
      const weight = Math.exp(-decayRate * age);

      const lambdaHome = Math.exp(
        teams[home].attackHome -
        teams[away].defenseAway +
        homeAdv
      );

      const lambdaAway = Math.exp(
        teams[away].attackAway -
        teams[home].defenseHome
      );

      const errorHome = weight * (goalsHome - lambdaHome);
      const errorAway = weight * (goalsAway - lambdaAway);

      teams[home].attackHome += learningRate *
        (errorHome - regularization * teams[home].attackHome);

      teams[away].defenseAway -= learningRate *
        (errorHome - regularization * teams[away].defenseAway);

      teams[away].attackAway += learningRate *
        (errorAway - regularization * teams[away].attackAway);

      teams[home].defenseHome -= learningRate *
        (errorAway - regularization * teams[home].defenseHome);

      homeAdv += learningRate *
        (errorHome - regularization * homeAdv);
    }
  }

  return { teams, homeAdv };
}