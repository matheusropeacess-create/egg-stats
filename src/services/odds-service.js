import "dotenv/config";

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;

function toNumberOdd(v) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Busca odds 1X2 (bet=1) e retorna "BEST PRICE" (maior odd por seleção).
 * Retorna null se não existir odds disponíveis para esse fixture.
 */
export async function fetchBest1x2OddsForFixture(fixtureId) {
  if (!API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY ausente no .env");

  const url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}&bet=1`;
  const resp = await fetch(url, { headers: { "x-apisports-key": API_FOOTBALL_KEY } });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`API-Football odds ${resp.status} ${resp.statusText} ${txt}`.trim());
  }

  const data = await resp.json();
  const response = data.response || [];
  if (!response.length) return null;

  // Estrutura típica: response[0].bookmakers[].bets[].values[]
  // bet=1 costuma ser "Match Winner" (1X2)
  let bestHome = null;
  let bestDraw = null;
  let bestAway = null;

  for (const item of response) {
    const bookmakers = item.bookmakers || [];
    for (const bm of bookmakers) {
      const bets = bm.bets || [];
      for (const b of bets) {
        const values = b.values || [];
        for (const v of values) {
          const label = String(v.value || "").toLowerCase();
          const odd = toNumberOdd(v.odd);
          if (!odd) continue;

          if (label === "home" || label === "1") bestHome = bestHome ? Math.max(bestHome, odd) : odd;
          else if (label === "draw" || label === "x") bestDraw = bestDraw ? Math.max(bestDraw, odd) : odd;
          else if (label === "away" || label === "2") bestAway = bestAway ? Math.max(bestAway, odd) : odd;
        }
      }
    }
  }

  // Se não conseguiu achar 1X2 completo, não salva
  if (!bestHome || !bestDraw || !bestAway) return null;

  return {
    bookmaker: "BEST",
    oddHome: bestHome,
    oddDraw: bestDraw,
    oddAway: bestAway,
  };
}