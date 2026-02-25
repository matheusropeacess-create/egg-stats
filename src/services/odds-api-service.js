/**
 * odds-api-service.js
 *
 * Busca odds na The Odds API v4 (formato EU, mercado h2h).
 *
 * MUDANÇAS em relação à versão anterior:
 *   - USE_MOCK_ODDS=true no .env ativa mock controlado (nunca sobe em prod sem saber)
 *   - Tratamento explícito de rate limit (HTTP 429) com mensagem clara
 *   - Cache por sportKey (TTL 10 min) para não estourar quota em múltiplas requisições
 *   - Log de requests remaining (header x-requests-remaining)
 */

import "dotenv/config";

const KEY      = process.env.ODDS_API_KEY;
const BASE_URL = "https://api.the-odds-api.com/v4";

// Cache: sportKey → { data, expiresAt }
const _cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

/* ─────────────────────────────────────────
   REAL API
───────────────────────────────────────── */

export async function fetchOddsBySport(sportKey) {
  // Mock controlado por variável de ambiente
  if (process.env.USE_MOCK_ODDS === "true") {
    console.warn(`[odds-api] ⚠️  MOCK ativo (USE_MOCK_ODDS=true) para ${sportKey}`);
    return _generateMockEvents(sportKey);
  }

  if (!KEY) throw new Error("ODDS_API_KEY ausente no .env");

  // Cache hit
  const cached = _cache.get(sportKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[odds-api] cache hit: ${sportKey}`);
    return cached.data;
  }

  const url =
    `${BASE_URL}/sports/${sportKey}/odds/` +
    `?apiKey=${encodeURIComponent(KEY)}` +
    `&regions=eu` +
    `&markets=h2h` +
    `&oddsFormat=decimal`;

  const response = await fetch(url);

  // Log de quota
  const remaining = response.headers.get("x-requests-remaining");
  const used      = response.headers.get("x-requests-used");
  if (remaining !== null) {
    console.log(`[odds-api] quota — usadas: ${used} | restantes: ${remaining}`);
  }

  if (response.status === 429) {
    throw new Error(
      `[odds-api] Rate limit atingido para ${sportKey}. ` +
      `Restantes: ${remaining ?? "?"}. Aguarde ou ative USE_MOCK_ODDS=true no .env.`
    );
  }

  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`[odds-api] ${response.status} ${response.statusText} — ${txt}`.trim());
  }

  const data = await response.json();
  const events = Array.isArray(data) ? data : [];

  _cache.set(sportKey, { data: events, expiresAt: Date.now() + CACHE_TTL_MS });
  console.log(`[odds-api] ${events.length} eventos para ${sportKey}`);

  return events;
}

/* ─────────────────────────────────────────
   MOCK (só para desenvolvimento)
───────────────────────────────────────── */

const BIG_TEAMS = new Set([
  "real madrid", "barcelona", "bayern munich", "manchester city",
  "liverpool", "arsenal", "psg", "juventus", "ac milan", "inter milan",
]);

function _isBig(name) {
  return BIG_TEAMS.has(name.toLowerCase());
}

/**
 * Gera eventos fictícios com estrutura idêntica à The Odds API v4.
 * Permite testar o pipeline completo sem gastar quota.
 */
function _generateMockEvents(sportKey) {
  const fixtures = _mockFixtures[sportKey] ?? [];

  return fixtures.map(([home, away]) => {
    const homeBig = _isBig(home);
    const awayBig = _isBig(away);

    let oddHome, oddDraw, oddAway;

    if (homeBig && !awayBig)      { oddHome = rand(1.55, 1.85); oddDraw = rand(3.6, 4.2); oddAway = rand(4.8, 6.5); }
    else if (!homeBig && awayBig) { oddHome = rand(4.8, 6.5);   oddDraw = rand(3.6, 4.2); oddAway = rand(1.55, 1.85); }
    else if (homeBig && awayBig)  { oddHome = rand(2.2, 2.8);   oddDraw = rand(3.1, 3.6); oddAway = rand(2.5, 3.2); }
    else                          { oddHome = rand(2.3, 3.2);   oddDraw = rand(2.9, 3.5); oddAway = rand(2.4, 3.2); }

    return {
      id:        `mock-${home}-${away}`.replace(/\s/g, "_"),
      sport_key: sportKey,
      home_team: home,
      away_team: away,
      bookmakers: [{
        key: "mock_bookie",
        title: "Mock Bookie",
        markets: [{
          key: "h2h",
          outcomes: [
            { name: home,   price: round2(oddHome) },
            { name: away,   price: round2(oddAway) },
            { name: "Draw", price: round2(oddDraw) },
          ],
        }],
      }],
    };
  });
}

const _mockFixtures = {
  soccer_epl: [
    ["Arsenal", "Chelsea"], ["Manchester City", "Liverpool"],
    ["Tottenham", "Manchester United"], ["Newcastle United", "Aston Villa"],
  ],
  soccer_italy_serie_a: [
    ["AC Milan", "Inter Milan"], ["Juventus", "Napoli"],
    ["Lazio", "Roma"], ["Atalanta", "Fiorentina"],
  ],
  soccer_spain_la_liga: [
    ["Real Madrid", "Barcelona"], ["Atletico Madrid", "Sevilla"],
    ["Valencia", "Villarreal"], ["Athletic Club", "Real Sociedad"],
  ],
  soccer_germany_bundesliga: [
    ["Bayern Munich", "Borussia Dortmund"], ["RB Leipzig", "Bayer Leverkusen"],
    ["Eintracht Frankfurt", "Borussia Mönchengladbach"],
  ],
  soccer_france_ligue_one: [
    ["PSG", "Olympique Marseille"], ["Lyon", "Monaco"],
    ["Lille", "Lens"],
  ],
  soccer_brazil_campeonato: [
    ["Flamengo", "Palmeiras"], ["Fluminense", "Botafogo"],
    ["Atletico Mineiro", "Gremio"], ["Sao Paulo", "Corinthians"],
  ],
};

function rand(min, max) { return min + Math.random() * (max - min); }
function round2(n)      { return Math.round(n * 100) / 100; }
