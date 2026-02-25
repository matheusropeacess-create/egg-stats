/**
 * football-data-service.js — busca partidas em janela de 14 dias
 */
import "dotenv/config";

const KEY      = process.env.FOOTBALL_DATA_KEY;
const BASE_URL = "https://api.football-data.org/v4";

export const SUPPORTED_COMPETITIONS = ["PL", "SA", "PD", "BL1", "FL1", "BSA", "DED", "PPL"];

async function fdGet(path) {
  if (!KEY) throw new Error("FOOTBALL_DATA_KEY ausente no .env");
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": KEY },
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`football-data ${response.status} — ${path} — ${txt}`.trim());
  }
  return response.json();
}

/**
 * Busca partidas agendadas nos próximos 14 dias em todas as ligas.
 */
export async function fetchUpcomingMatches() {
  const dateFrom = new Date();
  const dateTo   = new Date();
  dateTo.setDate(dateTo.getDate() + 14);

  const fmt = d => d.toISOString().slice(0, 10);

  const results = await Promise.allSettled(
    SUPPORTED_COMPETITIONS.map(code =>
      fdGet(`/competitions/${code}/matches?status=SCHEDULED&dateFrom=${fmt(dateFrom)}&dateTo=${fmt(dateTo)}`)
        .then(data => (data.matches ?? []).map(m => ({ ...m, _competitionCode: code })))
    )
  );

  const matches = [];
  const seen    = new Set();

  for (const r of results) {
    if (r.status === "rejected") {
      console.warn("[football-data] falhou:", r.reason?.message);
      continue;
    }
    for (const m of r.value) {
      if (!seen.has(m.id)) { seen.add(m.id); matches.push(m); }
    }
  }

  console.log(`[football-data] ${matches.length} partidas nos próximos 14 dias`);
  return matches;
}

export async function fetchRecentFinishedMatches(competition = null) {
  const path = competition
    ? `/competitions/${competition}/matches?status=FINISHED`
    : `/matches?status=FINISHED`;
  const data = await fdGet(path);
  return data.matches ?? [];
}

export async function fetchHistoricalMatches(competitionCode, seasons) {
  const results = await Promise.allSettled(
    seasons.map(season =>
      fdGet(`/competitions/${competitionCode}/matches?season=${season}&status=FINISHED`)
        .then(data => data.matches ?? [])
    )
  );
  const matches = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value);
    else console.warn(`[football-data] histórico falhou:`, r.reason?.message);
  }
  return matches;
}
