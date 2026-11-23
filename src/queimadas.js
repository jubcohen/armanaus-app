// ============================================================================
// ArManaus — focos de queimada (INPE / Programa Queimadas)
// Baixa os arquivos diários de focos de calor do INPE (dados abertos), filtra
// os das últimas 24 h perto de Manaus e resume, para cada local, quantos focos
// há no entorno e a distância do mais próximo. Focos muito próximos agravam o
// nível de alerta (ver agravarPorQueimadas em indice.js).
//
// Fonte: https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil/
// Arquivos "focos_diario_br_AAAAMMDD.csv" (data em UTC, todo o Brasil).
// As funções de cálculo são puras (sem banco nem rede) para facilitar os testes.
// ============================================================================

const BASE_URL = process.env.INPE_FOCOS_URL
  || 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/diario/Brasil';

const RAIO_INFO_KM = 50;        // focos até essa distância aparecem no resumo
const RAIO_AGRAVANTE_KM = 10;   // focos até essa distância sobem o nível em 1
const JANELA_H = 24;            // só focos das últimas 24 horas
const VALIDADE_H = 3;           // resumo mais velho que isso não é usado (dado vencido)

// Retângulo em volta de Manaus, só para descartar rápido o resto do Brasil
const CAIXA = { latMin: -4.3, latMax: -1.8, lngMin: -61.3, lngMax: -58.7 };

/** Distância em km entre dois pontos (fórmula de Haversine) */
function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** "AAAAMMDD" (UTC) de uma data */
function dataUtc(data) {
  return data.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Endereços dos arquivos diários que cobrem a janela de 24 h (hoje e ontem, em UTC) */
function urlsDaJanela(agora = new Date()) {
  const ontem = new Date(agora.getTime() - 24 * 3600000);
  return [dataUtc(ontem), dataUtc(agora)].map((d) => `${BASE_URL}/focos_diario_br_${d}.csv`);
}

// Nomes aceitos para cada coluna (o INPE já mudou o formato antes)
const COLUNAS = {
  lat: ['lat', 'latitude'],
  lng: ['lon', 'lng', 'long', 'longitude'],
  data: ['data_hora_gmt', 'datahora', 'data_hora', 'datetime', 'data'],
};

function acharColuna(cabecalho, nomes) {
  return cabecalho.findIndex((c) => nomes.includes(c));
}

/** Interpreta "2026-11-22 18:30:00" ou "2026-11-22T18:30:00Z" como UTC (ms) */
function lerDataUtc(texto) {
  if (!texto) return NaN;
  const t = texto.trim().replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z');
}

/**
 * Lê o CSV do INPE e devolve os focos dentro da caixa de Manaus e da janela de tempo.
 * @param {string} texto conteúdo do CSV
 * @param {number} agoraMs instante de referência
 * @returns {Array<{lat:number,lng:number,quando:number}>}
 */
function lerCsv(texto, agoraMs = Date.now()) {
  const linhas = String(texto).split(/\r?\n/);
  if (!linhas.length) return [];
  const cab = linhas[0].replace(/^﻿/, '').split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const iLat = acharColuna(cab, COLUNAS.lat);
  const iLng = acharColuna(cab, COLUNAS.lng);
  const iData = acharColuna(cab, COLUNAS.data);
  if (iLat < 0 || iLng < 0 || iData < 0) {
    throw new Error(`formato do CSV do INPE não reconhecido (colunas: ${cab.slice(0, 8).join(', ')})`);
  }
  const desde = agoraMs - JANELA_H * 3600000;
  const focos = [];
  for (let i = 1; i < linhas.length; i++) {
    if (!linhas[i]) continue;
    const campos = linhas[i].split(',');
    const lat = Number(campos[iLat]);
    const lng = Number(campos[iLng]);
    const quando = lerDataUtc((campos[iData] || '').replace(/"/g, ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(quando)) continue;
    if (lat < CAIXA.latMin || lat > CAIXA.latMax || lng < CAIXA.lngMin || lng > CAIXA.lngMax) continue;
    if (quando < desde || quando > agoraMs + 3600000) continue;
    focos.push({ lat, lng, quando });
  }
  return focos;
}

/** Tira focos repetidos (mesmo ponto e hora, vindos de arquivos diferentes) */
function semRepetidos(focos) {
  const vistos = new Set();
  return focos.filter((f) => {
    const chave = `${f.lat.toFixed(4)}|${f.lng.toFixed(4)}|${f.quando}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/**
 * Resume os focos para cada local.
 * @param {Array<{lat:number,lng:number}>} focos
 * @param {Array<{id:string,lat:number,lng:number}>} locais
 * @returns {Record<string,{focos24h:number, focosPerto:number, maisProximoKm:number|null}>}
 *   focos24h: até 50 km; focosPerto: até 10 km (os que agravam o nível)
 */
function resumirPorLocal(focos, locais) {
  const resumo = {};
  for (const l of locais) {
    let total = 0;
    let perto = 0;
    let menor = null;
    for (const f of focos) {
      const d = distanciaKm(l.lat, l.lng, f.lat, f.lng);
      if (d <= RAIO_INFO_KM) {
        total++;
        if (d <= RAIO_AGRAVANTE_KM) perto++;
        if (menor === null || d < menor) menor = d;
      }
    }
    resumo[l.id] = { focos24h: total, focosPerto: perto, maisProximoKm: menor === null ? null : Math.round(menor * 10) / 10 };
  }
  return resumo;
}

// ---------------------------------------------------------------------------
// Rede e banco (só aqui; o resto do arquivo é testável sem eles)
// ---------------------------------------------------------------------------
let ultimoErro = null;
let ultimaAtualizacao = null;

async function baixar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;   // arquivo do dia ainda não publicado
  if (!r.ok) throw new Error(`INPE respondeu ${r.status} em ${url}`);
  return r.text();
}

/** Baixa os arquivos, resume por local e grava no banco */
async function atualizar() {
  const { db } = require('./db');
  const agora = Date.now();
  try {
    const textos = [];
    for (const url of urlsDaJanela(new Date(agora))) {
      const t = await baixar(url);
      if (t) textos.push(t);
    }
    if (!textos.length) throw new Error('nenhum arquivo de focos disponível no INPE');
    const focos = semRepetidos(textos.flatMap((t) => lerCsv(t, agora)));
    const locais = db.prepare('SELECT id, lat, lng FROM locais').all();
    const resumo = resumirPorLocal(focos, locais);
    const iso = new Date(agora).toISOString();
    const salvar = db.prepare(`INSERT OR REPLACE INTO queimadas_locais
      (local_id, focos_24h, focos_perto, mais_proximo_km, atualizado_em) VALUES (?,?,?,?,?)`);
    db.exec('BEGIN');
    try {
      for (const [id, r] of Object.entries(resumo)) salvar.run(id, r.focos24h, r.focosPerto, r.maisProximoKm, iso);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    ultimoErro = null;
    ultimaAtualizacao = new Date(agora);
    return { focos: focos.length };
  } catch (e) {
    ultimoErro = e.message;
    throw e;
  }
}

/** Resumo gravado de um local, ou null se não existir ou estiver vencido */
function doLocal(localId, agora = Date.now()) {
  const { db } = require('./db');
  const l = db.prepare('SELECT * FROM queimadas_locais WHERE local_id = ?').get(localId);
  if (!l) return null;
  if (agora - Date.parse(l.atualizado_em) > VALIDADE_H * 3600000) return null;
  return {
    focos24h: l.focos_24h,
    focosPerto: l.focos_perto,
    maisProximoKm: l.mais_proximo_km,
    raioInfoKm: RAIO_INFO_KM,
    raioAgravanteKm: RAIO_AGRAVANTE_KM,
    atualizadoEm: l.atualizado_em,
  };
}

function estado() {
  return { atualizadoEm: ultimaAtualizacao, erro: ultimoErro };
}

module.exports = {
  RAIO_INFO_KM, RAIO_AGRAVANTE_KM,
  distanciaKm, urlsDaJanela, lerCsv, semRepetidos, resumirPorLocal,
  atualizar, doLocal, estado,
};
