// Testes do Qualiar-Ufam (rodar com: npm test). Não usam rede nem banco.
// A amostra em fixtures/ é um recorte do qualiar.json público do QUALIAR-UFAM
// (CCA/PCU/Ufam), de 23/11/2026: gerado_em, mediana e os 11 sensores de Manaus.
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src/qualiar');
const amostra = require('./fixtures/qualiar-amostra.json');

const AGORA = Date.parse(amostra.gerado_em) + 10 * 60000;   // 10 min depois da geração
const BILHARES = { id: 'bilhares', lat: -3.10167, lng: -60.02694 };
const SUMAUMA = { id: 'sumauma', lat: -3.035261, lng: -59.981184 };
const copia = () => JSON.parse(JSON.stringify(amostra));

test('Usa o sensor válido mais próximo quando está a até 5 km', () => {
  const r = q.escolherLeitura(BILHARES, amostra, AGORA);
  assert.equal(r.origem, 'sensor');
  assert.ok(r.distanciaKm <= q.RAIO_SENSOR_KM);
  assert.ok(Number.isFinite(r.pm25) && r.pm25 > 0);
  assert.equal(r.nSensores, 11);
});

test('Sem sensor perto, usa a mediana da cidade', () => {
  const longe = { id: 'longe', lat: -3.50, lng: -60.00 };
  const r = q.escolherLeitura(longe, amostra, AGORA);
  assert.equal(r.origem, 'mediana');
  assert.equal(r.pm25, amostra.atual.mediana);
  assert.equal(r.sensor, null);
});

test('Sensor marcado como inválido é ignorado', () => {
  const d = copia();
  d.sensores.forEach((s) => { s.valido = false; });
  const r = q.escolherLeitura(BILHARES, d, AGORA);
  assert.equal(r.origem, 'mediana');
});

test('Arquivo velho (mais de 3 h) não é usado', () => {
  assert.equal(q.escolherLeitura(BILHARES, amostra, AGORA + 4 * 3600000), null);
});

test('Formato inesperado ou valores absurdos não quebram: viram null', () => {
  assert.equal(q.escolherLeitura(BILHARES, {}, AGORA), null);
  assert.equal(q.escolherLeitura(BILHARES, null, AGORA), null);
  const d = copia();
  d.sensores = [{ nome: 'x', lat: -3.1, lon: -60.0, pm: 99999, valido: true, visto: amostra.gerado_em }];
  delete d.atual;
  assert.equal(q.escolherLeitura(BILHARES, d, AGORA), null);
  const e = copia();
  e.sensores = 'não é lista';
  assert.equal(q.escolherLeitura(BILHARES, e, AGORA).origem, 'mediana');
});

test('sensoresValidos devolve só os sensores utilizáveis, com nome limpo', () => {
  const lista = q.sensoresValidos(amostra, AGORA);
  assert.equal(lista.length, 11);
  assert.ok(lista.every((s) => Number.isFinite(s.pm) && Number.isFinite(s.lat) && Number.isFinite(s.lon) && typeof s.nome === 'string'));
  const d = copia();
  d.sensores[0].valido = false;
  d.sensores[1].pm = null;
  d.sensores[2].visto = '2026-11-20T00:00:00Z';   // sensor parado há dias
  assert.equal(q.sensoresValidos(d, AGORA).length, 8);
  assert.deepEqual(q.sensoresValidos({}, AGORA), []);
});

test('Classe do IQAr (1 a 5) para a cor dos sensores no mapa', () => {
  const ind = require('../src/indice');
  assert.equal(ind.classeIqar(10), 1);
  assert.equal(ind.classeIqar(35.9), 2);
  assert.equal(ind.classeIqar(55), 3);
  assert.equal(ind.classeIqar(100), 4);
  assert.equal(ind.classeIqar(300), 5);
});
