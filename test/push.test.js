// Testes das notificações push (rodar com: npm test). Não usam rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const push = require('../src/push');

const local = (id, nivel, extra = {}) => ({ id, nome: id.toUpperCase(), nivel, curto: 'Cautela', aberto: true, ...extra });

test('Primeira verificação só registra os níveis, sem avisar', () => {
  const r = push.decidirAvisos({}, [local('mindu', 2)]);
  assert.equal(r.avisos.length, 0);
  assert.deepEqual(r.novos, { mindu: 2 });
});

test('Avisa quando o nível muda, dizendo se melhorou ou piorou', () => {
  const pior = push.decidirAvisos({ mindu: 1 }, [local('mindu', 3)]);
  assert.equal(pior.avisos.length, 1);
  assert.equal(pior.avisos[0].corpo, 'As condições pioraram.');
  assert.equal(pior.avisos[0].url, '/local/mindu');
  const melhor = push.decidirAvisos({ mindu: 3 }, [local('mindu', 1)]);
  assert.equal(melhor.avisos[0].corpo, 'As condições melhoraram.');
});

test('Não avisa se o nível é o mesmo ou se o local está fechado, mas registra o nível', () => {
  assert.equal(push.decidirAvisos({ mindu: 2 }, [local('mindu', 2)]).avisos.length, 0);
  const fechado = push.decidirAvisos({ mindu: 1 }, [local('mindu', 4, { aberto: false })]);
  assert.equal(fechado.avisos.length, 0);
  assert.equal(fechado.novos.mindu, 4);
});

test('Valida a inscrição enviada pelo navegador', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPk', auth: 'xyz' } };
  assert.deepEqual(push.validarInscricao(ok), { endpoint: ok.endpoint, p256dh: 'BPk', auth: 'xyz' });
  assert.equal(push.validarInscricao({ ...ok, endpoint: 'http://inseguro.com/x' }), null);
  assert.equal(push.validarInscricao({ endpoint: ok.endpoint }), null);
  assert.equal(push.validarInscricao(null), null);
  assert.equal(push.validarInscricao({ ...ok, keys: { p256dh: 1, auth: 2 } }), null);
});

function bancoDeTeste() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE usuarios (id INTEGER PRIMARY KEY, aviso_favorito INTEGER, atividade TEXT, grupo_sensivel INTEGER);
    CREATE TABLE locais (id TEXT PRIMARY KEY, nome TEXT);
    CREATE TABLE favoritos (usuario_id INTEGER, local_id TEXT);
    CREATE TABLE push_inscricoes (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT);
    CREATE TABLE push_estado (usuario_id INTEGER, local_id TEXT, nivel INTEGER, PRIMARY KEY (usuario_id, local_id));
    INSERT INTO usuarios VALUES (1, 1, 'corrida', 0), (2, 0, 'caminhada', 0), (3, 1, 'caminhada', 0);
    INSERT INTO locais VALUES ('mindu', 'Mindu');
    INSERT INTO favoritos VALUES (1, 'mindu'), (2, 'mindu'), (3, 'mindu');
    INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (1, 'https://e/1', 'k', 'a'), (2, 'https://e/2', 'k', 'a');
  `);
  return db;
}

test('verificar: só avisa quem tem push e aviso ligado, e só na mudança', async () => {
  const db = bancoDeTeste();
  const enviados = [];
  const enviar = async (insc, carga) => { enviados.push({ endpoint: insc.endpoint, carga }); };
  let nivel = 1;
  const avaliar = () => ({ nome: 'Mindu', nivel, curto: 'Cautela', aberto: true });

  await push.verificar(db, avaliar, enviar);          // registra nível 1
  assert.equal(enviados.length, 0);
  nivel = 3;
  const r = await push.verificar(db, avaliar, enviar); // piorou
  assert.equal(r.enviados, 1);
  assert.equal(enviados[0].endpoint, 'https://e/1');   // usuário 2 tem aviso desligado; usuário 3 não tem inscrição
  assert.equal(enviados[0].carga.url, '/local/mindu');
  await push.verificar(db, avaliar, enviar);           // sem mudança: não repete
  assert.equal(enviados.length, 1);
});

test('verificar: inscrição cancelada pelo navegador (410) é apagada', async () => {
  const db = bancoDeTeste();
  let nivel = 1;
  const avaliar = () => ({ nome: 'Mindu', nivel, curto: 'Cautela', aberto: true });
  await push.verificar(db, avaliar, async () => {});
  nivel = 4;
  await push.verificar(db, avaliar, async () => { const e = new Error('gone'); e.statusCode = 410; throw e; });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM push_inscricoes WHERE usuario_id = 1').get().n, 0);
});

test('Sem chaves VAPID o push fica desligado', () => {
  assert.equal(push.ativo(), false);
});
