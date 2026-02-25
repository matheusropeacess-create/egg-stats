export function calculateEloRatings(matches, kFactor = 20) {

  const ratings = {};

  function getRating(team) {
    if (!ratings[team]) ratings[team] = 1500;
    return ratings[team];
  }

  for (const match of matches) {

    const home = match.teams.home.name;
    const away = match.teams.away.name;

    const homeGoals = match.goals.home;
    const awayGoals = match.goals.away;

    const homeRating = getRating(home);
    const awayRating = getRating(away);

    const expectedHome = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
    const expectedAway = 1 - expectedHome;

    let scoreHome = 0.5;
    let scoreAway = 0.5;

    if (homeGoals > awayGoals) {
      scoreHome = 1;
      scoreAway = 0;
    } else if (homeGoals < awayGoals) {
      scoreHome = 0;
      scoreAway = 1;
    }

    ratings[home] = homeRating + kFactor * (scoreHome - expectedHome);
    ratings[away] = awayRating + kFactor * (scoreAway - expectedAway);
  }

  return ratings;
}