/**
 * league-mapping.js
 *
 * Mapeamento: football-data competition.code → The Odds API sport_key
 *
 * Deve estar em sync com SUPPORTED_COMPETITIONS em football-data-service.js.
 */

export const LEAGUE_MAP = {
  "PL":  "soccer_epl",
  "SA":  "soccer_italy_serie_a",
  "PD":  "soccer_spain_la_liga",
  "BL1": "soccer_germany_bundesliga",
  "FL1": "soccer_france_ligue_one",
  "BSA": "soccer_brazil_campeonato",
  "DED": "soccer_netherlands_eredivisie",
  "PPL": "soccer_portugal_primeira_liga",
};

/** Inverso: sport_key → competition.code (útil para lookups de odds) */
export const SPORT_KEY_MAP = Object.fromEntries(
  Object.entries(LEAGUE_MAP).map(([k, v]) => [v, k])
);
