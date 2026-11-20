// ============================================================================
// ArManaus — banco de dados (SQLite nativo do Node.js, módulo node:sqlite)
// Cria as tabelas na primeira execução e insere os locais e as contas de teste.
// ============================================================================
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

// Pasta de dados configurável (no Render, aponte DATA_DIR para um disco persistente)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'armanaus.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------------------------------------------------------------------------
// Esquema
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'usuario' CHECK (papel IN ('usuario','moderador')),
  atividade TEXT NOT NULL DEFAULT 'caminhada' CHECK (atividade IN ('caminhada','corrida','ciclismo')),
  grupo_sensivel INTEGER NOT NULL DEFAULT 0,
  aviso_favorito INTEGER NOT NULL DEFAULT 1,
  aviso_melhor_horario INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);

-- Locais de atividade ao ar livre (Quadro 2 do projeto)
CREATE TABLE IF NOT EXISTS locais (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  zona TEXT NOT NULL,
  descricao TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  raio_m INTEGER NOT NULL DEFAULT 400,          -- área aceita para envio de fotos
  sensor_proprio INTEGER NOT NULL DEFAULT 0,     -- recebe estação ArManaus?
  coordenadas_verificadas INTEGER NOT NULL DEFAULT 0,
  abre TEXT NOT NULL DEFAULT '05:00',
  fecha TEXT NOT NULL DEFAULT '22:00',
  horario_texto TEXT,
  sombra TEXT,
  bebedouros TEXT,
  banheiros TEXT,
  pista TEXT
);

-- Leituras atuais (sensores próprios ou bases públicas)
CREATE TABLE IF NOT EXISTS leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
  data_hora TEXT NOT NULL,          -- horário de Manaus, "AAAA-MM-DDTHH:MM"
  pm25 REAL NOT NULL,
  temperatura REAL NOT NULL,
  umidade REAL NOT NULL,
  fonte TEXT NOT NULL               -- 'sensor', 'open-meteo' ou 'simulado'
);
CREATE INDEX IF NOT EXISTS idx_leituras_local ON leituras(local_id, data_hora);

-- Previsão horária para as próximas horas
CREATE TABLE IF NOT EXISTS previsoes (
  local_id TEXT NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
  hora TEXT NOT NULL,
  pm25 REAL NOT NULL,
  temperatura REAL NOT NULL,
  umidade REAL NOT NULL,
  fonte TEXT NOT NULL,
  PRIMARY KEY (local_id, hora)
);

-- Fotos enviadas pelos frequentadores. A localização NÃO é armazenada (LGPD).
CREATE TABLE IF NOT EXISTS fotos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  arquivo TEXT NOT NULL,
  etiquetas TEXT NOT NULL DEFAULT '[]',
  comentario TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovada','recusada')),
  criada_em TEXT NOT NULL DEFAULT (datetime('now')),
  moderada_em TEXT,
  moderador_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favoritos (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, local_id)
);

-- Chaves das estações de monitoramento (ESP32) de cada local-piloto
CREATE TABLE IF NOT EXISTS sensores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
  chave TEXT NOT NULL UNIQUE
);
`);

// ---------------------------------------------------------------------------
// Dados iniciais
// ---------------------------------------------------------------------------
// Coordenadas: verificadas = 1 quando conferidas em fonte pública (Wikipédia,
// OpenStreetMap). As demais são aproximadas e podem ser ajustadas na tela de
// moderação antes do uso real (o raio de envio de fotos depende delas).
const LOCAIS = [
  { id: 'ponta-negra', nome: 'Ponta Negra', zona: 'Oeste', descricao: 'Calçadão e praia na orla do Rio Negro, muito usados para caminhada e corrida, com pouca sombra.', lat: -3.06484, lng: -60.10691, raio_m: 700, sensor_proprio: 1, coordenadas_verificadas: 1, abre: '05:00', fecha: '23:00', horario_texto: 'Aberto todos os dias', sombra: 'Pouca', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'bilhares', nome: 'Parque Ponte dos Bilhares', zona: 'Centro-Sul', descricao: 'Pista de caminhada, ciclovia e equipamentos de ginástica em área urbana densa, às margens do igarapé do Mindu.', lat: -3.10167, lng: -60.02694, raio_m: 450, sensor_proprio: 1, coordenadas_verificadas: 1, abre: '06:00', fecha: '23:00', horario_texto: 'Todos os dias, 6h às 23h', sombra: 'Média', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'mindu', nome: 'Parque do Mindu', zona: 'Centro-Sul', descricao: 'Unidade de conservação com trilhas arborizadas às margens do igarapé do Mindu.', lat: -3.08091, lng: -60.00357, raio_m: 450, sensor_proprio: 1, coordenadas_verificadas: 1, abre: '06:00', fecha: '18:00', horario_texto: '[horário a confirmar]', sombra: 'Muita', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'jefferson-peres', nome: 'Parque Jefferson Péres', zona: 'Centro', descricao: 'Área de lazer no centro histórico, cercada por vias movimentadas.', lat: -3.13587, lng: -60.01678, raio_m: 300, sensor_proprio: 1, coordenadas_verificadas: 1, abre: '06:00', fecha: '22:00', horario_texto: 'Todos os dias, 6h às 22h', sombra: 'Média', bebedouros: '[a levantar]', banheiros: 'Sim', pista: '[extensão a levantar]' },
  { id: 'sumauma', nome: 'Parque Estadual Sumaúma', zona: 'Norte', descricao: 'Unidade de conservação estadual com trilhas em área de mata.', lat: -3.035261, lng: -59.981184, raio_m: 450, sensor_proprio: 1, coordenadas_verificadas: 1, abre: '08:00', fecha: '17:00', horario_texto: '[horário a confirmar]', sombra: 'Muita', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'bosque-ciencia', nome: 'Bosque da Ciência (INPA)', zona: 'Centro-Sul', descricao: 'Trilhas em fragmento de floresta urbana, com visitação.', lat: -3.0975, lng: -59.9867, raio_m: 400, sensor_proprio: 0, coordenadas_verificadas: 0, abre: '09:00', fecha: '16:00', horario_texto: 'Ter. a sex., 9h–12h e 14h–16h; fins de semana, 9h–16h', sombra: 'Muita', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'musa', nome: 'Museu da Amazônia (Musa)', zona: 'Norte', descricao: 'Trilhas em floresta e torre de observação, junto à Reserva Ducke.', lat: -3.0036, lng: -59.9401, raio_m: 600, sensor_proprio: 0, coordenadas_verificadas: 0, abre: '08:30', fecha: '17:00', horario_texto: '8h30 às 17h, fechado às quartas', sombra: 'Muita', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'ufam', nome: 'Campus da Ufam', zona: 'Leste', descricao: 'Vias internas em fragmento florestal, usadas para corrida e ciclismo.', lat: -3.0920, lng: -59.9660, raio_m: 900, sensor_proprio: 0, coordenadas_verificadas: 0, abre: '05:00', fecha: '22:00', horario_texto: '[horário a confirmar]', sombra: 'Média', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
  { id: 'japiim', nome: 'Parque Lagoa do Japiim', zona: 'Sul', descricao: 'Pista de caminhada no entorno de uma lagoa.', lat: -3.1125, lng: -59.9790, raio_m: 400, sensor_proprio: 0, coordenadas_verificadas: 0, abre: '05:00', fecha: '22:00', horario_texto: '[horário a confirmar]', sombra: 'Média', bebedouros: '[a levantar]', banheiros: '[a levantar]', pista: '[extensão a levantar]' },
];

// Contas de teste (todas com a senha abaixo). Troque antes de uso real.
const SENHA_PADRAO = 'ArManaus2026';
const CONTAS = [
  { nome: 'Julia de Brito Cohen', email: 'julia@armanaus.app', papel: 'moderador', atividade: 'caminhada', grupo_sensivel: 0 },
  { nome: 'Davih', email: 'davih@armanaus.app', papel: 'moderador', atividade: 'corrida', grupo_sensivel: 0 },
  { nome: 'Pedro', email: 'pedro@armanaus.app', papel: 'moderador', atividade: 'ciclismo', grupo_sensivel: 0 },
  { nome: 'Ana Lima', email: 'ana@armanaus.app', papel: 'usuario', atividade: 'corrida', grupo_sensivel: 1 },
  { nome: 'Carlos Souza', email: 'carlos@armanaus.app', papel: 'usuario', atividade: 'caminhada', grupo_sensivel: 0 },
];

function semear() {
  // Locais: insere os que faltam (não sobrescreve ajustes feitos na moderação)
  const insLocal = db.prepare(`INSERT OR IGNORE INTO locais
    (id,nome,zona,descricao,lat,lng,raio_m,sensor_proprio,coordenadas_verificadas,abre,fecha,horario_texto,sombra,bebedouros,banheiros,pista)
    VALUES (:id,:nome,:zona,:descricao,:lat,:lng,:raio_m,:sensor_proprio,:coordenadas_verificadas,:abre,:fecha,:horario_texto,:sombra,:bebedouros,:banheiros,:pista)`);
  for (const l of LOCAIS) insLocal.run(l);

  // Contas de teste
  const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?');
  const insUser = db.prepare(`INSERT INTO usuarios (nome,email,senha_hash,papel,atividade,grupo_sensivel)
    VALUES (?,?,?,?,?,?)`);
  const hash = bcrypt.hashSync(SENHA_PADRAO, 10);
  for (const c of CONTAS) {
    if (!existe.get(c.email)) insUser.run(c.nome, c.email, hash, c.papel, c.atividade, c.grupo_sensivel);
  }

  // Favoritos da Ana (usuária de exemplo)
  const ana = existe.get('ana@armanaus.app');
  const insFav = db.prepare('INSERT OR IGNORE INTO favoritos (usuario_id, local_id) VALUES (?,?)');
  for (const l of ['mindu', 'ponta-negra', 'jefferson-peres']) insFav.run(ana.id, l);

  // Chaves das estações dos cinco locais-piloto (usadas pelo ESP32)
  const insSensor = db.prepare('INSERT OR IGNORE INTO sensores (local_id, chave) VALUES (?, ?)');
  for (const l of LOCAIS.filter((x) => x.sensor_proprio)) insSensor.run(l.id, `demo-${l.id}`);

  // Fotos de demonstração (arquivos em public/img/demo)
  const qtd = db.prepare('SELECT COUNT(*) AS n FROM fotos WHERE demo = 1').get().n;
  if (qtd === 0) {
    const insFoto = db.prepare(`INSERT INTO fotos (local_id, usuario_id, arquivo, etiquetas, comentario, status, demo)
      VALUES (?,?,?,?,?,?,1)`);
    const carlos = existe.get('carlos@armanaus.app');
    insFoto.run('ponta-negra', carlos.id, 'demo:ponta-negra-1.jpg', JSON.stringify(['Fumaça visível']), 'Calçadão com fumaça leve', 'aprovada');
    insFoto.run('ponta-negra', ana.id, 'demo:ponta-negra-2.jpg', JSON.stringify(['Pouca gente']), null, 'aprovada');
    insFoto.run('mindu', ana.id, 'demo:mindu-1.jpg', JSON.stringify(['Céu limpo', 'Sombra boa']), 'Trilha principal bem sombreada', 'aprovada');
    insFoto.run('bilhares', carlos.id, 'demo:bilhares-1.jpg', JSON.stringify(['Lotado']), null, 'aprovada');
    // Duas pendentes, para testar a moderação
    insFoto.run('mindu', carlos.id, 'demo:mindu-2.jpg', JSON.stringify(['Pouca gente']), 'Fim de tarde tranquilo', 'pendente');
    insFoto.run('sumauma', ana.id, 'demo:sumauma-1.jpg', JSON.stringify(['Sombra boa']), null, 'pendente');
  }
  // As fotos aprovadas valem 6 horas; para a demonstração, as fotos de
  // exemplo são reposicionadas no tempo a cada inicialização do servidor.
  db.exec(`UPDATE fotos SET criada_em = datetime('now', '-' || (id * 17) || ' minutes') WHERE demo = 1`);
}
semear();

module.exports = { db, UPLOAD_DIR, DATA_DIR, SENHA_PADRAO };
