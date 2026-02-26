import axios from "axios"
import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"
import express from "express"
import path from "path"
import { fileURLToPath } from "url"

dotenv.config()

// ===============================
// EXPRESS INIT
// ===============================

const app = express()
app.use(express.json())

// __dirname (ESM fix)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Servir dashboard.html
app.use(express.static(__dirname))

// ===============================
// SUPABASE
// ===============================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

console.log("ODDS_API_KEY =", process.env.ODDS_API_KEY)

// ===============================
// UTILIDADES
// ===============================

function calculateEV(probModel, marketOdd) {
  return (probModel * marketOdd) - 1
}

function getConfidenceLabel(ev) {
  if (ev >= 0.08) return "HIGH"
  if (ev >= 0.04) return "MEDIUM"
  return "LOW"
}

// ===============================
// MOCK REALISTA
// ===============================

const USE_MOCK_ODDS = true

const MOCK_MATCHES = [
  { id: 2001, league_id: 39, home: "Arsenal", away: "Chelsea" },
  { id: 2002, league_id: 39, home: "Liverpool", away: "Tottenham" },
  { id: 2003, league_id: 135, home: "Inter", away: "Milan" },
  { id: 2004, league_id: 140, home: "Real Madrid", away: "Barcelona" },
  { id: 2005, league_id: 78, home: "Bayern", away: "Dortmund" },
  { id: 2006, league_id: 61, home: "PSG", away: "Marseille" }
]

const mockState = new Map()

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x))
}

function normalizeProbs(pHome, pDraw, pAway) {
  const s = pHome + pDraw + pAway
  return { pHome: pHome / s, pDraw: pDraw / s, pAway: pAway / s }
}

function getModelProbs(matchId) {
  let st = mockState.get(matchId)

  if (!st || !st.probs) {
    let pHome = 0.42 + Math.random() * 0.18
    let pDraw = 0.18 + Math.random() * 0.10
    let pAway = 0.22 + Math.random() * 0.18

    st = { odds: null, probs: normalizeProbs(pHome, pDraw, pAway) }
    mockState.set(matchId, st)
  }

  let { pHome, pDraw, pAway } = st.probs

  pHome = clamp(pHome + (Math.random() * 2 - 1) * 0.01, 0.25, 0.70)
  pDraw = clamp(pDraw + (Math.random() * 2 - 1) * 0.008, 0.12, 0.35)
  pAway = clamp(pAway + (Math.random() * 2 - 1) * 0.01, 0.10, 0.65)

  st.probs = normalizeProbs(pHome, pDraw, pAway)
  mockState.set(matchId, st)

  return st.probs
}

function jitterOdd(current) {
  const delta = (Math.random() * 2 - 1) * 0.08
  return clamp(current + delta, 1.15, 8.5)
}

function initOrMoveOdds(matchId) {
  let st = mockState.get(matchId) || { odds: null, probs: null }

  if (!st.odds) {
    st.odds = {
      home: 1.6 + Math.random() * 1.4,
      draw: 2.8 + Math.random() * 1.2,
      away: 1.6 + Math.random() * 1.8
    }
    mockState.set(matchId, st)
    return st.odds
  }

  st.odds = {
    home: jitterOdd(st.odds.home),
    draw: jitterOdd(st.odds.draw),
    away: jitterOdd(st.odds.away)
  }

  mockState.set(matchId, st)
  return st.odds
}

async function fetchOdds() {
  if (!USE_MOCK_ODDS) return []

  console.log("⚠️ MOCK ativo")

  return MOCK_MATCHES.map(m => {
    const odds = initOrMoveOdds(m.id)

    return {
      id: m.id,
      league_id: m.league_id,
      home_team: m.home,
      away_team: m.away,
      bookmakers: [
        {
          key: "mockbook",
          markets: [
            {
              key: "h2h",
              outcomes: [
                { name: m.home, price: Number(odds.home.toFixed(2)) },
                { name: "Draw", price: Number(odds.draw.toFixed(2)) },
                { name: m.away, price: Number(odds.away.toFixed(2)) }
              ]
            }
          ]
        }
      ]
    }
  })
}

// ===============================
// PROCESSAMENTO
// ===============================

async function processOdds() {
  console.log("🔎 Buscando odds...")

  const games = await fetchOdds()

  for (const game of games) {
    const probs = getModelProbs(game.id)
    let best = null

    for (const bookmaker of game.bookmakers) {
      const market = bookmaker.markets[0]

      for (const outcome of market.outcomes) {
        const odd = outcome.price

        let modelProb =
          outcome.name === game.home_team ? probs.pHome :
          outcome.name === "Draw" ? probs.pDraw :
          probs.pAway

        const marketProb = 1 / odd
        const ev = calculateEV(modelProb, odd)
        const edge = modelProb - marketProb
        const confidenceLabel = getConfidenceLabel(ev)

        await supabase.from("odds_snapshots").insert({
          match_id: game.id,
          selection: outcome.name,
          odd,
          bookmaker: bookmaker.key,
          captured_at: new Date()
        })

        if (!best || ev > best.ev) {
          best = { outcome, odd, modelProb, marketProb, ev, edge, confidenceLabel }
        }
      }
    }

    if (best) {
      await supabase.from("opportunities").upsert({
        external_match_id: game.id,
        league_id: game.league_id,
        market: "h2h",
        selection: best.outcome.name,
        model_prob: best.modelProb,
        market_prob: best.marketProb,
        edge: best.edge,
        ev: best.ev,
        confidence: best.ev,
        confidence_label: best.confidenceLabel,
        created_at: new Date()
      }, { onConflict: "external_match_id,market,selection" })
    }
  }

  console.log("✅ Processamento concluído.")
}

// ===============================
// LOOP
// ===============================

async function runWorker() {
  while (true) {
    await processOdds()
    console.log("⏳ Aguardando 60 segundos...")
    await new Promise(r => setTimeout(r, 60000))
  }
}

runWorker()

// ===============================
// API
// ===============================

app.get("/api/health", (req, res) => {
  res.json({ ok: true })
})

app.get("/api/opportunities", async (req, res) => {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

const formatted = (data || []).map(o => ({
  match: o.external_match_id,
  league: o.league_id,
  pick: o.selection,
  odd: (1 / o.market_prob).toFixed(2),
  edge: o.edge,
  ev: o.ev,
  confidence: o.confidence_label,

  // 👇 RESTAURA ESTRUTURA ORIGINAL
  modelProb: { home: o.model_prob },
  marketProb: { home: o.market_prob },

  home: MOCK_MATCHES.find(m => m.id === o.external_match_id)?.home || 'Home',
  away: MOCK_MATCHES.find(m => m.id === o.external_match_id)?.away || 'Away'
}))

  res.json({ count: formatted.length, top: formatted })
})

app.get("/api/odds-history/:matchId", async (req, res) => {
  const { matchId } = req.params

  const { data, error } = await supabase
    .from("odds_snapshots")
    .select("selection, odd, captured_at")
    .eq("match_id", matchId)
    .order("captured_at", { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  res.json(data || [])
})

app.get("/api/debug/bets", async (req, res) => {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .limit(20)

  if (error) return res.status(500).json({ error: error.message })

  res.json(data || [])
})

app.get("/api/db-structure", async (req, res) => {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .limit(1)

  if (error) return res.status(500).json({ error: error.message })

  res.json({
    ok: true,
    sample: data?.[0] || null
  })
})

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 API rodando")
})