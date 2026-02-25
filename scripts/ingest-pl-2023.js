import "dotenv/config";
import { query } from "../src/config/db.js";

async function ingest() {

  const COMPETITION = "PL";
  const SEASON = 2023;

  console.log(`Ingesting ${COMPETITION} ${SEASON}...`);

  const url =
    `https://api.football-data.org/v4/competitions/${COMPETITION}/matches?season=${SEASON}`;

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": process.env.FOOTBALL_DATA_KEY
    }
  });

  const data = await response.json();

  if (!data.matches) {
    console.log("No matches returned:", data);
    return;
  }

  console.log(`Fetched ${data.matches.length} matches`);

  for (const m of data.matches) {

    await query(`
      INSERT INTO matches (
        external_match_id,
        competition_code,
        season,
        home_team,
        away_team,
        match_date,
        home_goals,
        away_goals,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (external_match_id) DO NOTHING
    `, [
      m.id,
      COMPETITION,
      SEASON,
      m.homeTeam.name,
      m.awayTeam.name,
      m.utcDate,
      m.score.fullTime.home,
      m.score.fullTime.away,
      m.status
    ]);
  }

  console.log("Done.");
}

ingest();