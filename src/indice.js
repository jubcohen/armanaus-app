// ============================================================================
// ArManaus — cálculo do índice de recomendação
// Implementa a Etapa 4 do projeto (seção 4.5): combina a qualidade do ar (IQAr)
// com o índice de calor e ajusta o resultado pelo tipo de atividade e pelo
// grupo sensível. Todas as funções são puras para facilitar os testes.
// ============================================================================

// Faixas de PM2,5 (média de 24 h, µg/m³) do IQAr atualizado conforme a
// Resolução Conama nº 506/2024 e a orientação técnica do MMA (jan. 2025).
// A transição Boa → Moderada usa o valor da OMS (15 µg/m³).
const FAIXAS_IQAR = [
  { nome: 'Boa', cMin: 0, cMax: 15, iMin: 0, iMax: 40 },
  { nome: 'Moderada', cMin: 15, cMax: 50, iMin: 41, iMax: 80 },
  { nome: 'Ruim', cMin: 50, cMax: 75, iMin: 81, iMax: 120 },
  { nome: 'Muito ruim', cMin: 75, cMax: 125, iMin: 121, iMax: 200 },
  { nome: 'Péssima', cMin: 125, cMax: 500, iMin: 201, iMax: 400 },
];

// Textos dos quatro níveis de alerta (Quadro 4 do projeto)
const NIVEIS = {
  1: { rotulo: 'Recomendado', curto: 'Recomendado', cor: 'verde' },
  2: { rotulo: 'Com cautela', curto: 'Cautela', cor: 'amarelo' },
  3: { rotulo: 'Não recomendado para grupos sensíveis e atividades intensas', curto: 'Evitar se sensível', cor: 'laranja' },
  4: { rotulo: 'Não recomendado: prefira ambiente fechado', curto: 'Não recomendado', cor: 'vermelho' },
};

// Atividades consideradas intensas sobem um nível (seção 4.5)
const ATIVIDADES = {
  caminhada: { nome: 'Caminhada', intensa: false },
  corrida: { nome: 'Corrida', intensa: true },
  ciclismo: { nome: 'Ciclismo', intensa: true },
};

/**
 * Converte a concentração de PM2,5 em IQAr (índice e categoria),
 * usando interpolação linear dentro da faixa, como faz o MMA.
 * @param {number} pm25 concentração em µg/m³
 */
function iqar(pm25) {
  const c = Math.max(0, Number(pm25) || 0);
  // Encontra a faixa; acima do topo, fica na última
  const faixa = FAIXAS_IQAR.find((f) => c <= f.cMax) || FAIXAS_IQAR[FAIXAS_IQAR.length - 1];
  const prop = (Math.min(c, faixa.cMax) - faixa.cMin) / (faixa.cMax - faixa.cMin);
  const indice = Math.round(faixa.iMin + prop * (faixa.iMax - faixa.iMin));
  return { indice, categoria: faixa.nome };
}

/**
 * Índice de calor (temperatura aparente) pela regressão de Rothfusz (1990),
 * com os ajustes do National Weather Service. Entrada e saída em °C.
 * @param {number} tempC temperatura do ar em °C
 * @param {number} umidade umidade relativa em %
 */
function indiceCalor(tempC, umidade) {
  const T = (tempC * 9) / 5 + 32; // °C → °F
  const RH = Math.min(100, Math.max(0, umidade));
  // Fórmula simples de Steadman, usada quando o resultado fica abaixo de 80 °F
  let hi = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094);
  if ((hi + T) / 2 >= 80) {
    // Regressão completa de Rothfusz
    hi = -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH
      - 0.00683783 * T * T - 0.05481717 * RH * RH + 0.00122874 * T * T * RH
      + 0.00085282 * T * RH * RH - 0.00000199 * T * T * RH * RH;
    // Ajuste para umidade baixa
    if (RH < 13 && T >= 80 && T <= 112) {
      hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    }
    // Ajuste para umidade alta
    if (RH > 85 && T >= 80 && T <= 87) {
      hi += ((RH - 85) / 10) * ((87 - T) / 5);
    }
  }
  return Math.round((((hi - 32) * 5) / 9) * 10) / 10; // °F → °C, 1 casa decimal
}

/** Classificação do índice de calor (Quadro 3 do projeto) */
function categoriaCalor(hiC) {
  if (hiC < 27) return 'Normal';
  if (hiC < 32) return 'Cautela';
  if (hiC < 41) return 'Cautela extrema';
  if (hiC < 54) return 'Perigo';
  return 'Perigo extremo';
}

/** Nível (1–4) a partir da categoria do ar */
function nivelDoAr(categoria) {
  return { Boa: 1, Moderada: 2, Ruim: 3, 'Muito ruim': 4, 'Péssima': 4 }[categoria] || 1;
}

/** Nível (1–4) a partir do índice de calor */
function nivelDoCalor(hiC) {
  if (hiC < 27) return 1;
  if (hiC < 32) return 2;
  if (hiC < 41) return 3;
  return 4;
}

/**
 * Nível de alerta final (Quadro 4): o maior entre ar e calor, subindo uma
 * posição para atividade intensa ou grupo sensível (não acumula).
 * @param {{pm25:number, temperatura:number, umidade:number}} c condições
 * @param {{atividade?:string, grupoSensivel?:boolean}} perfil
 */
function avaliar(c, perfil = {}) {
  const ar = iqar(c.pm25);
  const hi = indiceCalor(c.temperatura, c.umidade);
  const base = Math.max(nivelDoAr(ar.categoria), nivelDoCalor(hi));
  const atividade = ATIVIDADES[perfil.atividade] || ATIVIDADES.caminhada;
  const sobe = atividade.intensa || Boolean(perfil.grupoSensivel);
  const nivel = Math.min(4, base + (sobe && base > 1 ? 1 : 0));
  return {
    nivel,
    nivelBase: base,
    ...NIVEIS[nivel],
    iqar: ar.indice,
    categoriaAr: ar.categoria,
    indiceCalor: hi,
    categoriaCalor: categoriaCalor(hi),
  };
}

/**
 * Melhor janela de horário nas próximas horas (seção 4.5): calcula o nível de
 * cada hora prevista dentro do horário de funcionamento e escolhe a sequência
 * mais longa com o menor nível.
 * @param {Array<{hora:string, pm25:number, temperatura:number, umidade:number}>} horas previsões ordenadas
 * @param {{abre?:string, fecha?:string}} local horário de funcionamento "HH:MM"
 * @param {object} perfil atividade e grupo sensível
 */
function melhorHorario(horas, local = {}, perfil = {}) {
  const abre = hParaNum(local.abre || '05:00');
  const fecha = hParaNum(local.fecha || '22:00');
  // Mantém só as horas em que o local está aberto
  const avaliadas = horas
    .filter((h) => {
      const hh = Number(h.hora.slice(11, 13));
      return hh >= Math.floor(abre) && hh < Math.ceil(fecha);
    })
    .map((h) => ({ hora: h.hora, nivel: avaliar(h, perfil).nivel }));
  if (!avaliadas.length) return null;
  const menor = Math.min(...avaliadas.map((h) => h.nivel));
  // Procura a maior sequência contínua (horas consecutivas) com o menor nível
  let melhor = null;
  let atual = null;
  for (let i = 0; i < avaliadas.length; i++) {
    const h = avaliadas[i];
    const consecutiva = atual && diffHoras(avaliadas[i - 1].hora, h.hora) === 1;
    if (h.nivel === menor) {
      atual = consecutiva && atual ? { ...atual, fim: h.hora, n: atual.n + 1 } : { inicio: h.hora, fim: h.hora, n: 1 };
      if (!melhor || atual.n > melhor.n) melhor = { ...atual };
    } else {
      atual = null;
    }
  }
  return { inicio: melhor.inicio, fim: somaHora(melhor.fim, 1), nivel: menor, ...NIVEIS[menor] };
}

/**
 * Correção de umidade para sensores ópticos Plantower (PMS5003), no formato
 * da correção da Agência de Proteção Ambiental dos EUA usada por redes de
 * sensores de baixo custo: PM = 0,524·bruto − 0,0862·UR + 5,75.
 * Os coeficientes devem ser recalibrados com os dados de Manaus (seção 4.4).
 */
function corrigirPM25(bruto, umidade) {
  const v = 0.524 * bruto - 0.0862 * umidade + 5.75;
  return Math.max(0, Math.round(v * 10) / 10);
}

// ---- utilitários de hora no formato "AAAA-MM-DDTHH:MM" ----
function hParaNum(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h + (m || 0) / 60;
}
function diffHoras(a, b) {
  return Math.round((Date.parse(b + ':00Z') - Date.parse(a + ':00Z')) / 3600000);
}
function somaHora(iso, n) {
  const d = new Date(Date.parse(iso + ':00Z') + n * 3600000);
  return d.toISOString().slice(0, 16);
}

module.exports = {
  FAIXAS_IQAR, NIVEIS, ATIVIDADES,
  iqar, indiceCalor, categoriaCalor, nivelDoAr, nivelDoCalor, avaliar, melhorHorario, corrigirPM25,
};
