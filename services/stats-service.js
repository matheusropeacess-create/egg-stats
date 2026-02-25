// services/stats-service.js

function average(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function lastN(arr, n) {
  return arr
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
    .slice(0, n);
}

function shrink(value, games, k = 5) {
  return (value * games + 1 * k) / (games + k);
}

export function buildLeagueModel(matches) {
  const finished = matches.filter(m => m.status === "FINISHED");

  const homeGoals = finished.map(m => m.score.fullTime.home);
  const awayGoals = finished.map(m => m.score.fullTime.away);

  const leagueAvgHome = average(homeGoals);
  const leagueAvgAway = average(awayGoals);

  const teams = {};

  finished.forEach(m => {
    const home = m.homeTeam.name;
    const away = m.awayTeam.name;

    if (!teams[home]) teams[home] = [];
    if (!teams[away]) teams[away] = [];

    teams[home].push(m);
    teams[away].push(m);
  });

  const strengths = {};

  for (const team in teams) {
    const matches = teams[team];

    const homeMatches = lastN(
      matches.filter(m => m.homeTeam.name === team),
      10
    );

    const awayMatches = lastN(
      matches.filter(m => m.awayTeam.name === team),
      10
    );

    const avgHomeScored = average(
      homeMatches.map(m => m.score.fullTime.home)
    );

    const avgHomeConceded = average(
      homeMatches.map(m => m.score.fullTime.away)
    );

    const avgAwayScored = average(
      awayMatches.map(m => m.score.fullTime.away)
    );

    const avgAwayConceded = average(
      awayMatches.map(m => m.score.fullTime.home)
    );

    const attackHomeRaw = avgHomeScored / leagueAvgHome || 1;
    const defenseHomeRaw = avgHomeConceded / leagueAvgAway || 1;

    const attackAwayRaw = avgAwayScored / leagueAvgAway || 1;
    const defenseAwayRaw = avgAwayConceded / leagueAvgHome || 1;

    strengths[team] = {
      attackHome: shrink(attackHomeRaw, homeMatches.length),
      defenseHome: shrink(defenseHomeRaw, homeMatches.length),
      attackAway: shrink(attackAwayRaw, awayMatches.length),
      defenseAway: shrink(defenseAwayRaw, awayMatches.length)
    };
  }

  return {
    leagueAvgHome,
    leagueAvgAway,
    strengths
  };
}
