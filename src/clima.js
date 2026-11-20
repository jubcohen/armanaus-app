// ============================================================================
// ArManaus — integração de dados (Etapa 2 do projeto)
// Busca previsão de temperatura, umidade e PM2,5 na Open-Meteo (que distribui
// gratuitamente as previsões do serviço Copernicus). Se a internet do servidor
// estiver indisponível, gera dados simulados para a demonstração continuar
// funcionando, sempre marcados como fonte "simulado" na interface.
// ============================================================================
const { db } = require('./db');

const FUSO_MANAUS_MS = -4 * 3600 * 1000; // Manaus: UTC−4, sem horário de verão

/** Data → "AAAA-MM-DDTHH:MM" no horário de Manaus */
function horaManaus(data = new Date()) {
  return new Date(data.getTime() + FUSO_MANAUS_MS).toISOString().slice(0, 16);
}

/** Início da hora atual em Manaus ("AAAA-MM-DDTHH:00") */
function horaCheiaAtual() {
  return horaManaus().slice(0, 13) + ':00';
}

/** Gerador pseudoaleatório determinístico (mesma hora → mesmo valor) */
function ruido(semente) {
  let x = 0;
  for (const ch of semente) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return ((x >>> 0) % 1000) / 1000; // 0..1
}

/**
 * Condições simuladas, plausíveis para Manaus: ciclo diário de temperatura
 * (24–33 °C), umidade inversa e PM2,5 mais alto na estação seca (ago–nov),
 * de manhã cedo e à noite, e em locais expostos ou de tráfego intenso.
 */
function simular(local, horaIso) {
  const h = Number(horaIso.slice(11, 13));
  const mes = Number(horaIso.slice(5, 7));
  const estacaoSeca = mes >= 8 && mes <= 11;
  const r = ruido(local.id + horaIso.slice(0, 13));
  // Temperatura: mínima ~6h, máxima ~14h
  const ciclo = Math.cos(((h - 14) / 24) * 2 * Math.PI); // 1 às 14h, −1 às 2h
  const sombra = { Muita: -1.2, 'Média': -0.4, Pouca: 0.6 }[local.sombra] ?? 0;
  const temperatura = 28.5 + 4.5 * ciclo + sombra + (r - 0.5) * 1.2;
  const umidade = Math.min(98, Math.max(45, 76 - 16 * ciclo + (r - 0.5) * 6));
  // PM2,5: fundo + episódio de fumaça; acumula à noite e de manhã cedo
  const fundo = estacaoSeca ? 30 : 10;
  const acumulo = h >= 19 || h <= 7 ? 1.35 : h >= 11 && h <= 16 ? 0.8 : 1;
  const exposicao = { 'jefferson-peres': 1.25, bilhares: 1.15, 'ponta-negra': 1.1, japiim: 1.1 }[local.id] || 0.9;
  const pm25 = fundo * acumulo * exposicao * (0.75 + r * 0.6);
  return {
    pm25: Math.round(pm25 * 10) / 10,
    temperatura: Math.round(temperatura * 10) / 10,
    umidade: Math.round(umidade),
  };
}

/** Busca as previsões na Open-Meteo para todos os locais de uma vez */
async function buscarOpenMeteo(locais) {
  const lat = locais.map((l) => l.lat).join(',');
  const lng = locais.map((l) => l.lng).join(',');
  const base = `latitude=${lat}&longitude=${lng}&timezone=America%2FManaus&forecast_days=2`;
  const sinal = AbortSignal.timeout(10000);
  const [rTempo, rAr] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${base}&hourly=temperature_2m,relative_humidity_2m`, { signal: sinal }),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${base}&hourly=pm2_5`, { signal: sinal }),
  ]);
  if (!rTempo.ok || !rAr.ok) throw new Error(`Open-Meteo respondeu ${rTempo.status}/${rAr.status}`);
  // Com várias coordenadas a API devolve uma lista; com uma, um objeto
  const tempo = [].concat(await rTempo.json());
  const ar = [].concat(await rAr.json());
  return locais.map((local, i) => {
    const t = tempo[i].hourly;
    const pmPorHora = new Map(ar[i].hourly.time.map((hora, j) => [hora, ar[i].hourly.pm2_5[j]]));
    return t.time.map((hora, j) => ({
      local_id: local.id,
      hora,
      temperatura: t.temperature_2m[j],
      umidade: t.relative_humidity_2m[j],
      pm25: pmPorHora.get(hora) ?? null,
    })).filter((p) => p.temperatura != null && p.umidade != null && p.pm25 != null);
  });
}

let ultimaFonte = 'simulado';
let ultimaAtualizacao = null;

/**
 * Atualiza previsões das próximas 36 h e a leitura da hora atual de cada local.
 * Leituras de sensor recebidas há menos de 30 min têm prioridade (servidor.js).
 */
async function atualizar() {
  const locais = db.prepare('SELECT * FROM locais').all();
  const agora = horaCheiaAtual();
  let porLocal;
  try {
    porLocal = await buscarOpenMeteo(locais);
    ultimaFonte = 'open-meteo';
  } catch (erro) {
    // Sem acesso à Open-Meteo: dados simulados para a demonstração
    console.warn('[clima] usando dados simulados:', erro.message);
    ultimaFonte = 'simulado';
    porLocal = locais.map((local) => {
      const lista = [];
      for (let i = -2; i < 36; i++) {
        const hora = horaManaus(new Date(Date.parse(agora + ':00Z') - FUSO_MANAUS_MS + i * 3600000));
        lista.push({ local_id: local.id, hora, ...simular(local, hora) });
      }
      return lista;
    });
  }

  // Grava tudo numa transação
  const salvarPrev = db.prepare(`INSERT OR REPLACE INTO previsoes (local_id,hora,pm25,temperatura,umidade,fonte)
    VALUES (?,?,?,?,?,?)`);
  const salvarLeitura = db.prepare(`INSERT INTO leituras (local_id,data_hora,pm25,temperatura,umidade,fonte)
    VALUES (?,?,?,?,?,?)`);
  const jaTem = db.prepare(`SELECT 1 FROM leituras WHERE local_id = ? AND data_hora = ? AND fonte = ?`);
  db.exec('BEGIN');
  try {
    // Remove previsões antigas (mais de 3 h atrás)
    db.prepare('DELETE FROM previsoes WHERE hora < ?').run(horaManaus(new Date(Date.now() - 3 * 3600000)));
    for (const lista of porLocal) {
      for (const p of lista) salvarPrev.run(p.local_id, p.hora, p.pm25, p.temperatura, p.umidade, ultimaFonte);
      const atual = lista.find((p) => p.hora === agora);
      if (atual && !jaTem.get(atual.local_id, agora, ultimaFonte)) {
        salvarLeitura.run(atual.local_id, agora, atual.pm25, atual.temperatura, atual.umidade, ultimaFonte);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  ultimaAtualizacao = new Date();
  return { fonte: ultimaFonte, atualizadoEm: ultimaAtualizacao };
}

function estado() {
  return { fonte: ultimaFonte, atualizadoEm: ultimaAtualizacao };
}

module.exports = { atualizar, estado, horaManaus, horaCheiaAtual, simular };
