import "dotenv/config";

const KEY = process.env.FOOTBALL_DATA_KEY;

export async function fetchUpcomingMatches() {

  const url =
    `https://api.football-data.org/v4/competitions/PL/matches` +
    `?status=SCHEDULED`;

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": process.env.FOOTBALL_DATA_KEY
    }
  });

  const data = await response.json();

  return data.matches || [];
}

export async function fetchRecentFinishedMatches() {

  const url =
    `https://api.football-data.org/v4/matches?status=FINISHED`;

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": process.env.FOOTBALL_DATA_KEY
    }
  });

  const data = await response.json();

  return data.matches || [];
}