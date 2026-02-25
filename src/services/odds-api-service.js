import "dotenv/config";

const KEY = process.env.ODDS_API_KEY;

export async function fetchOddsBySport(sportKey) {
  if (!KEY) throw new Error("ODDS_API_KEY ausente");

  const url =
    `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/` +
    `?apiKey=${encodeURIComponent(KEY)}` +
    `&regions=eu` +
    `&markets=h2h` +
    `&oddsFormat=decimal`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Odds API error: ${response.status}`);
  }

  return Array.isArray(data) ? data : [];
}