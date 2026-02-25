import "dotenv/config";

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

async function apiFootballGet(url) {
  if (!API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY ausente no .env");

  const resp = await fetch(url, {
    headers: { "x-apisports-key": API_FOOTBALL_KEY },
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`API-Football ${resp.status} ${resp.statusText} ${txt}`.trim());
  }

  const data = await resp.json();
  return data.response || [];
}

export async function fetchFixturesSeason(league, season) {
  const url = `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}`;
  return apiFootballGet(url);
}

export async function fetchNextFixtures(league, limit = 20) {
  const url = `https://v3.football.api-sports.io/fixtures?league=${league}&next=${limit}`;
  return apiFootballGet(url);
}