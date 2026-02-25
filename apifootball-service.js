// apifootball-service.js - Versão Oficial (sem RapidAPI)
import axios from 'axios';
import 'dotenv/config';

// Sua chave do dashboard.api-football.com
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const BASE_URL = 'https://v3.football.api-sports.io';

// Caches para respeitar limites e ser rápido
const teamCache = new Map();
const h2hCache = new Map();

async function getTeamId(teamName) {
  try {
    // Cache para não repetir buscas
    if (teamCache.has(teamName)) {
      console.log(`📦 Cache: ${teamName} -> ID ${teamCache.get(teamName)}`);
      return teamCache.get(teamName);
    }

    console.log(`🔍 Buscando time: "${teamName}"`);

    // Busca SEMPRE sem filtrar por liga - pega qualquer time
    const response = await axios({
      method: 'GET',
      url: `${BASE_URL}/teams`,
      params: { 
        search: teamName
        // ⚠️ REMOVEMOS league e season - busca em TODAS as ligas!
      },
      headers: {
        'x-apisports-key': API_FOOTBALL_KEY
      },
      timeout: 8000 // Aumenta timeout
    });

    const teams = response.data?.response || [];
    
    if (teams.length === 0) {
      console.log(`❌ Nenhum time encontrado para: "${teamName}"`);
      return null;
    }

    // Log dos times encontrados para debug
    console.log(`📋 Times encontrados: ${teams.length}`);
    teams.slice(0, 3).forEach(t => {
      console.log(`   - ${t.team.name} (${t.team.country})`);
    });

    // Pega o primeiro resultado
    const team = teams[0]?.team;
    if (team?.id) {
      console.log(`✅ Time encontrado: ${team.name} (ID: ${team.id}, País: ${team.country})`);
      teamCache.set(teamName, team.id);
      return team.id;
    }

    return null;
  } catch (error) {
    console.log(`❌ Erro buscar time ${teamName}:`, error.message);
    return null;
  }
}

export async function fetchH2HAPI(team1, team2) {
  try {
    const cacheKey = `${team1}_${team2}`;
    
    // Cache de 12 horas (respeita limite diário)
    if (h2hCache.has(cacheKey)) {
      const cached = h2hCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 1000 * 60 * 60 * 12) {
        console.log(`📦 H2H cache: ${team1} vs ${team2}`);
        return cached.data;
      }
    }

    console.log(`🔄 Buscando H2H: ${team1} vs ${team2}`);

    // Busca IDs dos dois times
    const [team1Id, team2Id] = await Promise.all([
      getTeamId(team1),
      getTeamId(team2)
    ]);

    if (!team1Id || !team2Id) {
      console.log(`❌ Time não encontrado: ${!team1Id ? team1 : team2}`);
      return null;
    }

    // Endpoint de H2H
    const response = await axios({
      method: 'GET',
      url: `${BASE_URL}/fixtures/headtohead`,
      params: {
        h2h: `${team1Id}-${team2Id}`,
        last: 5,
        timezone: 'America/Sao_Paulo'
      },
      headers: {
        'x-apisports-key': API_FOOTBALL_KEY
      },
      timeout: 5000
    });

    const fixtures = response.data?.response || [];
    console.log(`✅ ${fixtures.length} confrontos encontrados`);

    // Formata IGUAL ao que seu frontend espera
    const formatted = fixtures.map(f => ({
      utcDate: f.fixture.date,
      competition: f.league.name,
      homeTeam: f.teams.home.name,
      awayTeam: f.teams.away.name,
      score: f.goals.home !== null ? `${f.goals.home}-${f.goals.away}` : '0-0'
    }));

    // Salva cache
    h2hCache.set(cacheKey, {
      timestamp: Date.now(),
      data: formatted
    });

    return formatted;

  } catch (error) {
    console.log('❌ Erro H2H:', error.message);
    return null;
  }
}