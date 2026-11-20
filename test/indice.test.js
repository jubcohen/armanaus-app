// Testes do cálculo do índice (rodar com: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const ind = require('../src/indice');

test('IQAr usa as faixas de PM2,5 da orientação do MMA', () => {
  assert.equal(ind.iqar(10).categoria, 'Boa');
  assert.equal(ind.iqar(15).categoria, 'Boa');
  assert.equal(ind.iqar(32).categoria, 'Moderada');
  assert.equal(ind.iqar(60).categoria, 'Ruim');
  assert.equal(ind.iqar(100).categoria, 'Muito ruim');
  assert.equal(ind.iqar(314.99).categoria, 'Péssima'); // pico de 12/10/2023
  assert.equal(ind.iqar(0).indice, 0);
  assert.equal(ind.iqar(50).indice, 80);
});

test('Índice de calor segue a regressão de Rothfusz', () => {
  // 32 °C e 70% de umidade ≈ 41 °C (tabela do NWS: 90 °F/70% → 106 °F)
  const hi = ind.indiceCalor(32.2, 70);
  assert.ok(hi > 40 && hi < 42.5, `obtido ${hi}`);
  // Clima ameno: índice próximo da temperatura
  assert.ok(Math.abs(ind.indiceCalor(24, 60) - 24) < 1.5);
  assert.equal(ind.categoriaCalor(26.9), 'Normal');
  assert.equal(ind.categoriaCalor(30), 'Cautela');
  assert.equal(ind.categoriaCalor(35), 'Cautela extrema');
  assert.equal(ind.categoriaCalor(45), 'Perigo');
  assert.equal(ind.categoriaCalor(60), 'Perigo extremo');
});

test('Nível final é o maior entre ar e calor (Quadro 4)', () => {
  // Ar bom, calor em cautela → nível 2
  assert.equal(ind.avaliar({ pm25: 8, temperatura: 28, umidade: 70 }).nivel, 2);
  // Ar ruim, calor normal → nível 3
  assert.equal(ind.avaliar({ pm25: 60, temperatura: 24, umidade: 60 }).nivel, 3);
  // Ar péssimo → nível 4
  assert.equal(ind.avaliar({ pm25: 300, temperatura: 24, umidade: 60 }).nivel, 4);
});

test('Atividade intensa ou grupo sensível sobe uma posição', () => {
  const c = { pm25: 30, temperatura: 25, umidade: 60 }; // Moderada → 2
  assert.equal(ind.avaliar(c, { atividade: 'caminhada' }).nivel, 2);
  assert.equal(ind.avaliar(c, { atividade: 'corrida' }).nivel, 3);
  assert.equal(ind.avaliar(c, { atividade: 'caminhada', grupoSensivel: true }).nivel, 3);
  // Não acumula: corrida + grupo sensível continua subindo só uma posição
  assert.equal(ind.avaliar(c, { atividade: 'corrida', grupoSensivel: true }).nivel, 3);
  // Nunca passa de 4
  assert.equal(ind.avaliar({ pm25: 200, temperatura: 24, umidade: 60 }, { atividade: 'corrida' }).nivel, 4);
});

test('Melhor horário encontra a janela mais longa com o menor nível', () => {
  const horas = [
    { hora: '2026-11-20T16:00', pm25: 40, temperatura: 31, umidade: 60 },
    { hora: '2026-11-20T17:00', pm25: 40, temperatura: 30, umidade: 60 },
    { hora: '2026-11-20T18:00', pm25: 10, temperatura: 25, umidade: 70 },
    { hora: '2026-11-20T19:00', pm25: 12, temperatura: 25, umidade: 70 },
    { hora: '2026-11-20T20:00', pm25: 30, temperatura: 25, umidade: 75 },
  ];
  const m = ind.melhorHorario(horas, { abre: '06:00', fecha: '22:00' });
  assert.equal(m.inicio, '2026-11-20T18:00');
  assert.equal(m.fim, '2026-11-20T20:00');
  assert.equal(m.nivel, 1);
});

test('Correção de umidade do sensor reduz a leitura bruta', () => {
  assert.equal(ind.corrigirPM25(50, 80), 25.1);
  assert.equal(ind.corrigirPM25(0, 100), 0);
});
