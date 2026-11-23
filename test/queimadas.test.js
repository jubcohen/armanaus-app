// Testes da integração de queimadas (rodar com: npm test). Não usam rede nem banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src/queimadas');
const ind = require('../src/indice');

const AGORA = Date.parse('2026-11-22T20:00:00Z');
const CABECALHO = 'lat,lon,data_hora_gmt,satelite,municipio,estado,pais,municipio_id,estado_id,pais_id,numero_dias_sem_chuva,precipitacao,risco_fogo,bioma,frp';
const linha = (lat, lon, dh) => `${lat},${lon},${dh},NOAA-20,Manaus,AMAZONAS,Brasil,1302603,13,33,3,0,0.9,Amazônia,12.5`;

const MINDU = { id: 'mindu', lat: -3.08091, lng: -60.00357 };
const SUMAUMA = { id: 'sumauma', lat: -3.035261, lng: -59.981184 };

test('Distância de Haversine: 1° de latitude ≈ 111 km', () => {
  assert.ok(Math.abs(q.distanciaKm(0, 0, 1, 0) - 111.19) < 0.5);
  assert.equal(q.distanciaKm(-3.1, -60, -3.1, -60), 0);
});

test('URLs cobrem hoje e ontem em UTC, mesmo perto da meia-noite de Manaus', () => {
  // 21/11 às 21h em Manaus já é 22/11 01h UTC
  const urls = q.urlsDaJanela(new Date('2026-11-22T01:00:00Z'));
  assert.ok(urls[0].endsWith('focos_diario_br_20261121.csv'));
  assert.ok(urls[1].endsWith('focos_diario_br_20261122.csv'));
});

test('CSV: lê focos de Manaus nas últimas 24 h e descarta o resto', () => {
  const csv = [
    CABECALHO,
    linha(-3.09, -60.01, '2026-11-22 18:30:00'),   // perto do Mindu, recente: entra
    linha(-3.09, -60.01, '2026-11-20 18:30:00'),   // velho demais
    linha(-10.5, -55.0, '2026-11-22 18:30:00'),    // fora da caixa de Manaus
    linha(-3.04, -59.99, '2026-11-21 21:00:00'),   // dentro das 24 h (23 h atrás)
    '',
    'lixo,sem,numeros',
  ].join('\n');
  const focos = q.lerCsv(csv, AGORA);
  assert.equal(focos.length, 2);
});

test('CSV: aceita nomes alternativos de coluna e BOM', () => {
  const csv = '﻿latitude,longitude,datahora\n-3.09,-60.01,2026-11-22T18:30:00Z\n';
  assert.equal(q.lerCsv(csv, AGORA).length, 1);
});

test('CSV: formato desconhecido gera erro claro, em vez de silenciar', () => {
  assert.throws(() => q.lerCsv('a,b,c\n1,2,3\n', AGORA), /não reconhecido/);
});

test('Resumo por local: conta até 50 km, separa os de até 10 km e acha o mais próximo', () => {
  const focos = [
    { lat: -3.09, lng: -60.01 },     // ~1,3 km do Mindu
    { lat: -3.20, lng: -60.00 },     // ~13 km do Mindu (dentro de 50, fora de 10)
    { lat: -2.70, lng: -60.30 },     // ~50+ km: fora
  ];
  const r = q.resumirPorLocal(focos, [MINDU, SUMAUMA]);
  assert.equal(r.mindu.focos24h, 2);
  assert.equal(r.mindu.focosPerto, 1);
  assert.ok(r.mindu.maisProximoKm > 1 && r.mindu.maisProximoKm < 2);
  // O Sumaúma fica ~6,7 km do primeiro foco: também conta como "perto"
  assert.equal(r.sumauma.focosPerto, 1);
  assert.ok(r.sumauma.maisProximoKm > 6 && r.sumauma.maisProximoKm < 7.5);
});

test('Resumo sem focos: zero e distância nula', () => {
  const r = q.resumirPorLocal([], [MINDU]);
  assert.deepEqual(r.mindu, { focos24h: 0, focosPerto: 0, maisProximoKm: null });
});

test('Repetidos entre arquivos diários são contados uma vez só', () => {
  const f = { lat: -3.09, lng: -60.01, quando: 1 };
  assert.equal(q.semRepetidos([f, { ...f }, { ...f, quando: 2 }]).length, 2);
});

test('Agravante: foco a menos de 10 km sobe o nível em 1', () => {
  const base = ind.avaliar({ pm25: 5, temperatura: 26, umidade: 70 });   // nível 1
  assert.equal(base.nivel, 1);
  const a = ind.agravarPorQueimadas(base, { focosPerto: 1 });
  assert.equal(a.nivel, 2);
  assert.equal(a.agravadoPorQueimadas, true);
  assert.equal(a.rotulo, ind.NIVEIS[2].rotulo);
  assert.equal(base.nivel, 1, 'não altera a avaliação original');
});

test('Agravante: focos só distantes, ausência de dados ou nível 4 não mudam nada', () => {
  const base = ind.avaliar({ pm25: 5, temperatura: 26, umidade: 70 });
  assert.equal(ind.agravarPorQueimadas(base, { focosPerto: 0 }).nivel, 1);
  assert.equal(ind.agravarPorQueimadas(base, null).nivel, 1);
  const pior = ind.avaliar({ pm25: 200, temperatura: 30, umidade: 70 });
  assert.equal(pior.nivel, 4);
  const r = ind.agravarPorQueimadas(pior, { focosPerto: 5 });
  assert.equal(r.nivel, 4);
  assert.equal(r.agravadoPorQueimadas, false);
});

test('Melhor horário aceita o ajuste de queimadas', () => {
  const horas = [10, 11, 12].map((h) => ({ hora: `2026-11-22T${h}:00`, pm25: 5, temperatura: 26, umidade: 70 }));
  const sem = ind.melhorHorario(horas, { abre: '06:00', fecha: '22:00' }, {});
  const com = ind.melhorHorario(horas, { abre: '06:00', fecha: '22:00' }, {}, (a) => ind.agravarPorQueimadas(a, { focosPerto: 1 }));
  assert.equal(sem.nivel, 1);
  assert.equal(com.nivel, 2);
});
