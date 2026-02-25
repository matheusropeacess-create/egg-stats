// odds-service.js - VERSÃO OTIMIZADA
import axios from 'axios';
import 'dotenv/config';

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.the-odds-api.com/v4';

// Cache de 24 horas para não estourar limite
const oddsCache = new Map();

// ⚠️ APENAS LIGAS PRINCIPAIS (reduz requisições)
const COMPETITIONS_WITH_ODDS = [
  'soccer_epl',           // Premier League
  'soccer_spain_la_liga', // La Liga
  'soccer_italy_serie_a', // Serie A
  'soccer_germany_bundesliga', // Bundesliga
  'soccer_france_ligue_one', // Ligue 1
  'soccer_uefa_champs_league', // Champions League
  'soccer_uefa_europa_league', // Europa League
  'soccer_brazil_serie_a' // Brasileirão
];

export async function fetchOddsForMatch(homeTeam, awayTeam, competitionCode) {
  // 🔥 DADOS MOCKADOS PARA TESTE ENQUANTO A API ESTIVER NO LIMITE
  console.log(`🎲 Usando odds MOCK para: ${homeTeam} vs ${awayTeam}`);
  
  // Simula odds realistas baseadas nos times
  const mockOdds = generateMockOdds(homeTeam, awayTeam);
  
  // Simula um delay de rede
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return mockOdds;
}

// Função para gerar odds fictícias realistas
function generateMockOdds(homeTeam, awayTeam) {
  // Times grandes têm odds menores (mais favoritos)
  const bigTeams = ['real madrid', 'barcelona', 'bayern', 'man city', 'liverpool', 'arsenal', 'psg', 'juventus', 'milan', 'inter'];
  
  const homeNorm = homeTeam.toLowerCase();
  const awayNorm = awayTeam.toLowerCase();
  
  const isHomeBig = bigTeams.some(team => homeNorm.includes(team));
  const isAwayBig = bigTeams.some(team => awayNorm.includes(team));
  
  let homeOdds, drawOdds, awayOdds;
  
  if (isHomeBig && !isAwayBig) {
    // Favorito em casa
    homeOdds = 1.65 + Math.random() * 0.2;
    drawOdds = 3.80 + Math.random() * 0.4;
    awayOdds = 5.20 + Math.random() * 0.8;
  } else if (!isHomeBig && isAwayBig) {
    // Favorito fora
    homeOdds = 4.80 + Math.random() * 0.8;
    drawOdds = 3.90 + Math.random() * 0.4;
    awayOdds = 1.70 + Math.random() * 0.2;
  } else if (isHomeBig && isAwayBig) {
    // Clássico
    homeOdds = 2.40 + Math.random() * 0.3;
    drawOdds = 3.30 + Math.random() * 0.3;
    awayOdds = 2.80 + Math.random() * 0.3;
  } else {
    // Jogo equilibrado entre times médios
    homeOdds = 2.60 + Math.random() * 0.5;
    drawOdds = 3.20 + Math.random() * 0.3;
    awayOdds = 2.80 + Math.random() * 0.5;
  }
  
  return {
    best: {
      home: Number(homeOdds.toFixed(2)),
      draw: Number(drawOdds.toFixed(2)),
      away: Number(awayOdds.toFixed(2))
    },
    totalBookmakers: Math.floor(Math.random() * 5) + 3, // Entre 3 e 8 casas
    hasOdds: true
  };
}

// Função MELHORADA para encontrar o jogo
function findMatchImproved(homeTeam, awayTeam, matches) {
  const normalize = (str) => {
    return str.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .replace(/\b(fc|cf|ac|sc|us|as|ssc|cd|ec|cr|se|sc)\b/g, '') // Remove siglas comuns
      .trim();
  };

  // Versão ainda mais simples (só o nome principal)
  const simplify = (str) => {
    return str.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z]/g, '')
      .replace(/(fc|cf|ac|sc|us|as|ssc|cd|ec|cr|se|sc)/g, '');
  };

  const homeNorm = normalize(homeTeam);
  const awayNorm = normalize(awayTeam);
  const homeSimple = simplify(homeTeam);
  const awaySimple = simplify(awayTeam);

  console.log(`🔍 Normalizado: "${homeTeam}" -> "${homeNorm}" (simplificado: "${homeSimple}")`);
  console.log(`🔍 Normalizado: "${awayTeam}" -> "${awayNorm}" (simplificado: "${awaySimple}")`);

  // Mapeamento de nomes comuns
  const nameMap = {
    'roma': 'as roma',
    'cremonese': 'us cremonese',
    'heidenheim': '1 fc heidenheim 1846',
    'stuttgart': 'vfb stuttgart',
    'osasuna': 'ca osasuna',
    'realmadrid': 'real madrid',
    'realmadridcf': 'real madrid',
    'leipzig': 'rb leipzig',
    'leverkusen': 'bayer leverkusen',
    'mgladbach': 'borussia monchengladbach',
    'wolfsburg': 'vfl wolfsburg',
    'mainz': '1 fsv mainz 05',
    'unionberlin': '1 fc union berlin',
    'freiburg': 'sc freiburg',
    'hoffenheim': 'tsg 1899 hoffenheim',
    'augsburg': 'fc augsburg',
    'monchengladbach': 'borussia monchengladbach',
    'bayer': 'bayer leverkusen',
    'bayern': 'fc bayern munchen',
    'dortmund': 'borussia dortmund'
  };

  return matches.find(m => {
    const teams = m.teams || [];
    const matchTeamsNorm = teams.map(t => normalize(t));
    const matchTeamsSimple = teams.map(t => simplify(t));

    // Tenta correspondência exata primeiro
    const exactMatch = teams.some(t => t === homeTeam) && teams.some(t => t === awayTeam);
    if (exactMatch) return true;

    // Tenta correspondência normalizada
    const normMatch = matchTeamsNorm.some(t => t === homeNorm) && 
                     matchTeamsNorm.some(t => t === awayNorm);
    if (normMatch) return true;

    // Tenta correspondência simplificada
    const simpleMatch = matchTeamsSimple.some(t => t === homeSimple) && 
                       matchTeamsSimple.some(t => t === awaySimple);
    if (simpleMatch) return true;

    // Tenta inclusão
    const homeIncluded = matchTeamsNorm.some(t => t.includes(homeNorm) || homeNorm.includes(t));
    const awayIncluded = matchTeamsNorm.some(t => t.includes(awayNorm) || awayNorm.includes(t));
    if (homeIncluded && awayIncluded) return true;

    // Tenta mapeamento
    const homeMapped = nameMap[homeSimple] || nameMap[homeNorm];
    const awayMapped = nameMap[awaySimple] || nameMap[awayNorm];
    if (homeMapped || awayMapped) {
      const mappedMatch = matchTeamsNorm.some(t => t === homeMapped) && 
                         matchTeamsNorm.some(t => t === awayMapped);
      if (mappedMatch) return true;
    }

    return false;
  });
}

function mapCompetitionToSport(compCode) {
  const mapping = {
    'PL': 'soccer_epl',
    'PD': 'soccer_spain_la_liga',
    'BL1': 'soccer_germany_bundesliga',
    'SA': 'soccer_italy_serie_a',
    'FL1': 'soccer_france_ligue_one',
    'BSA': 'soccer_brazil_serie_a',
    'CL': 'soccer_uefa_champs_league',
    'EL': 'soccer_uefa_europa_league'
  };
  return mapping[compCode] || null;
}

function processMatchOdds(match) {
  const bookmakers = match.bookmakers || [];
  const allOdds = [];
  
  bookmakers.forEach(book => {
    const markets = book.markets || [];
    const h2hMarket = markets.find(m => m.key === 'h2h');
    
    if (h2hMarket) {
      const outcomes = h2hMarket.outcomes || [];
      const homeOdds = outcomes.find(o => o.name === match.home_team)?.price;
      const awayOdds = outcomes.find(o => o.name === match.away_team)?.price;
      const drawOdds = outcomes.find(o => o.name === 'Draw')?.price;
      
      if (homeOdds && awayOdds && drawOdds) {
        allOdds.push({ home: homeOdds, draw: drawOdds, away: awayOdds });
      }
    }
  });
  
  if (allOdds.length === 0) {
    return { hasOdds: false, totalBookmakers: 0 };
  }
  
  const bestOdds = {
    home: Math.max(...allOdds.map(o => o.home)),
    draw: Math.max(...allOdds.map(o => o.draw)),
    away: Math.max(...allOdds.map(o => o.away))
  };
  
  return {
    best: bestOdds,
    totalBookmakers: allOdds.length,
    hasOdds: true
  };
}