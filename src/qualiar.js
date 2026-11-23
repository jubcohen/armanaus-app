// ============================================================================
// ArManaus — Qualiar-Ufam (sensores PurpleAir da rede da Ufam)
// Lê o arquivo JSON que o painel QUALIAR-UFAM (CCA e PCU da Ufam) publica a
// cada hora e usa o PM2,5 medido pelos sensores como condição atual dos
// parques, no lugar do modelo, quando há dado recente.
//
// ATENÇÃO: não é uma API oficial documentada. É o arquivo de dados de um
// projeto em versão BETA; o endereço ou o formato podem mudar. Por isso tudo
// aqui é tolerante: se o arquivo faltar ou mudar, o app volta ao modelo.
// Peça autorização ao CCA/PCU e mantenha o crédito na tela (fonte do dado).
//
// Fonte: https://ufamcca.github.io/qualiar_BETA/data/qualiar.json
// Campos usados: gerado_em, atual.mediana, atual.n_sensores e, em cada item de
// sensores: nome, lat, lon, pm (já corrigido pela fórmula da EPA), valido, visto.
// ============================================================================
const { distanciaKm } = require('./queimadas');

const URL_DADOS = process.env.QUALIAR_URL || 'https://ufamcca.github.io/qualiar_BETA/data/qualiar.json';
const RAIO_SENSOR_KM = 5;       // sensor mais próximo só vale se estiver a até 5 km do parque
const VALIDADE_H = 3;           // dado mais velho que isso não é usado

const arred1 = (x) => Math.round(x * 10) / 10;

/**
 * Escolhe a leitura de PM2,5 de um local a partir do JSON do Qualiar.
 * Prefere o sensor válido mais próximo (até 5 km); senão usa a mediana da cidade.
 * @param {{lat:number,lng:number}} local
 * @param {object} dados conteúdo do qualiar.json
 * @param {number} agoraMs instante de referência
 * @returns {{pm25:number, origem:'sensor'|'mediana', sensor:string|null, distanciaKm:number|null,
 *            nSensores:number, geradoEm:string}|null}
 */
function escolherLeitura(local, dados, agoraMs = Date.now()) {
  const gerado = Date.parse(dados?.gerado_em);
  if (!Number.isFinite(gerado) || agoraMs - gerado > VALIDADE_H * 3600000) return null;

  const validos = sensoresValidos(dados, agoraMs);
  let melhor = null;
  for (const s of validos) {
    const d = distanciaKm(local.lat, local.lng, s.lat, s.lon);
    if (!melhor || d < melhor.d) melhor = { s, d };
  }
  if (melhor && melhor.d <= RAIO_SENSOR_KM) {
    return { pm25: arred1(melhor.s.pm), origem: 'sensor', sensor: String(melhor.s.nome || 'sensor'),
      distanciaKm: arred1(melhor.d), nSensores: validos.length, geradoEm: dados.gerado_em };
  }
  const mediana = dados.atual?.mediana;
  if (Number.isFinite(mediana) && mediana >= 0 && mediana <= 1000) {
    return { pm25: arred1(mediana), origem: 'mediana', sensor: null, distanciaKm: null,
      nSensores: Number(dados.atual.n_sensores) || validos.length, geradoEm: dados.gerado_em };
  }
  return null;
}

/**
 * Sensores utilizáveis do arquivo: válidos pelo controle de qualidade do Qualiar,
 * com PM2,5 e posição numéricos e visto nas últimas 3 h.
 * @returns {Array<{nome:string,lat:number,lon:number,pm:number,visto:string}>}
 */
function sensoresValidos(dados, agoraMs = Date.now()) {
  const gerado = Date.parse(dados?.gerado_em);
  return (Array.isArray(dados?.sensores) ? dados.sensores : []).filter((s) => {
    const visto = s && s.visto ? Date.parse(s.visto) : gerado;
    return s && s.valido === true
      && Number.isFinite(s.pm) && s.pm >= 0 && s.pm <= 1000
      && Number.isFinite(s.lat) && Number.isFinite(s.lon)
      && Number.isFinite(visto) && agoraMs - visto <= VALIDADE_H * 3600000;
  }).map((s) => ({ nome: String(s.nome || 'sensor').slice(0, 60), lat: s.lat, lon: s.lon, pm: s.pm,
    visto: s.visto || dados.gerado_em }));
}

// ---------------------------------------------------------------------------
// Rede e banco
// ---------------------------------------------------------------------------
let ultimoErro = null;
let ultimaAtualizacao = null;

async function atualizar() {
  const { db } = require('./db');
  const agora = Date.now();
  try {
    const r = await fetch(URL_DADOS, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Qualiar-Ufam respondeu ${r.status}`);
    const dados = await r.json();
    const locais = db.prepare('SELECT id, lat, lng FROM locais').all();
    const salvar = db.prepare(`INSERT OR REPLACE INTO qualiar_locais
      (local_id, pm25, origem, sensor, distancia_km, n_sensores, gerado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)`);
    const apagar = db.prepare('DELETE FROM qualiar_locais WHERE local_id = ?');
    const salvarSensor = db.prepare(`INSERT INTO qualiar_sensores (nome, lat, lng, pm25, visto_em, gerado_em) VALUES (?,?,?,?,?,?)`);
    const iso = new Date(agora).toISOString();
    let usados = 0;
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM qualiar_sensores');
      for (const sen of sensoresValidos(dados, agora)) salvarSensor.run(sen.nome, sen.lat, sen.lon, sen.pm, sen.visto, dados.gerado_em);
      for (const l of locais) {
        const leitura = escolherLeitura(l, dados, agora);
        if (leitura) {
          salvar.run(l.id, leitura.pm25, leitura.origem, leitura.sensor, leitura.distanciaKm, leitura.nSensores, leitura.geradoEm, iso);
          usados++;
        } else apagar.run(l.id);   // dado vencido ou inválido: volta ao modelo
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    if (!usados) throw new Error('Qualiar-Ufam sem dado utilizável (arquivo velho ou formato diferente)');
    ultimoErro = null;
    ultimaAtualizacao = new Date(agora);
    return { locais: usados };
  } catch (e) {
    ultimoErro = e.message;
    throw e;
  }
}

/** Leitura gravada de um local, ou null se não existir ou estiver vencida */
function doLocal(localId, agora = Date.now()) {
  const { db } = require('./db');
  const l = db.prepare('SELECT * FROM qualiar_locais WHERE local_id = ?').get(localId);
  if (!l) return null;
  if (agora - Date.parse(l.gerado_em) > VALIDADE_H * 3600000) return null;
  return { pm25: l.pm25, origem: l.origem, sensor: l.sensor, distanciaKm: l.distancia_km, nSensores: l.n_sensores, geradoEm: l.gerado_em };
}

/** Sensores gravados (para o mapa), ou lista vazia se o dado estiver vencido */
function sensores(agora = Date.now()) {
  const { db } = require('./db');
  return db.prepare('SELECT nome, lat, lng, pm25, visto_em, gerado_em FROM qualiar_sensores ORDER BY nome').all()
    .filter((s) => agora - Date.parse(s.gerado_em) <= VALIDADE_H * 3600000)
    .map((s) => ({ nome: s.nome, lat: s.lat, lng: s.lng, pm25: s.pm25, vistoEm: s.visto_em, geradoEm: s.gerado_em }));
}

function estado() {
  return { atualizadoEm: ultimaAtualizacao, erro: ultimoErro };
}

module.exports = { RAIO_SENSOR_KM, escolherLeitura, sensoresValidos, atualizar, doLocal, sensores, estado };
