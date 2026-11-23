// ============================================================================
// ArManaus — servidor web (API + site)
// ============================================================================
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { db, UPLOAD_DIR } = require('./db');
const clima = require('./clima');
const queimadas = require('./queimadas');
const qualiar = require('./qualiar');
const push = require('./push');
const indice = require('./indice');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VALIDADE_FOTO_H = 6;            // fotos ficam visíveis por até 6 horas
const SESSAO_DIAS = 30;

app.disable('x-powered-by');
app.set('trust proxy', 1);            // necessário atrás do proxy do Render
app.use(express.json({ limit: '100kb' }));

// Cabeçalhos de segurança básicos
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
  next();
});

// ---------------------------------------------------------------------------
// Sessão (cookie httpOnly com token aleatório guardado no banco)
// ---------------------------------------------------------------------------
function lerCookie(req, nome) {
  const par = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(nome + '='));
  return par ? decodeURIComponent(par.slice(nome.length + 1)) : null;
}

function criarSessao(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSAO_DIAS * 86400000);
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?,?,?)').run(token, usuarioId, expira.toISOString());
  res.cookie('armanaus_sessao', token, { httpOnly: true, sameSite: 'lax', secure: PRODUCAO, expires: expira, path: '/' });
}

// Carrega o usuário da sessão em req.usuario (ou null)
app.use((req, res, next) => {
  req.usuario = null;
  const token = lerCookie(req, 'armanaus_sessao');
  if (token) {
    const linha = db.prepare(`SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = ? AND s.expira_em > ?`).get(token, new Date().toISOString());
    if (linha) req.usuario = linha;
  }
  next();
});

function exigeLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ erro: 'Entre na sua conta para continuar.' });
  next();
}
function exigeModerador(req, res, next) {
  if (!req.usuario || req.usuario.papel !== 'moderador') return res.status(403).json({ erro: 'Acesso restrito à moderação.' });
  next();
}

/** Dados públicos do usuário (sem hash de senha) */
function usuarioPublico(u) {
  if (!u) return null;
  const favoritos = db.prepare('SELECT local_id FROM favoritos WHERE usuario_id = ?').all(u.id).map((f) => f.local_id);
  const fotos = db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'aprovada') AS aprovadas FROM fotos WHERE usuario_id = ?`).get(u.id);
  return {
    id: u.id, nome: u.nome, email: u.email, papel: u.papel,
    atividade: u.atividade, grupoSensivel: Boolean(u.grupo_sensivel),
    avisoFavorito: Boolean(u.aviso_favorito), avisoMelhorHorario: Boolean(u.aviso_melhor_horario),
    favoritos, fotosEnviadas: fotos.total || 0, fotosAprovadas: fotos.aprovadas || 0,
  };
}

// Limite simples de tentativas de login por IP (proteção contra força bruta)
const tentativas = new Map();
function limiteLogin(req, res, next) {
  const chave = req.ip;
  const agora = Date.now();
  const t = (tentativas.get(chave) || []).filter((x) => agora - x < 15 * 60000);
  if (t.length >= 10) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  t.push(agora);
  tentativas.set(chave, t);
  next();
}

// ---------------------------------------------------------------------------
// Condições de cada local
// ---------------------------------------------------------------------------
/** Perfil usado no cálculo: do usuário logado ou dos parâmetros da URL */
function perfilDe(req) {
  const atividade = indice.ATIVIDADES[req.query.atividade] ? req.query.atividade : req.usuario?.atividade || 'caminhada';
  const grupoSensivel = req.query.sensivel != null ? req.query.sensivel === '1' : Boolean(req.usuario?.grupo_sensivel);
  return { atividade, grupoSensivel };
}

/**
 * Condição atual, por ordem de prioridade: sensor próprio recente (< 30 min),
 * PM2,5 do Qualiar-Ufam (sensores PurpleAir, até 3 h) ou leitura/previsão da hora.
 * No caso do Qualiar, temperatura e umidade continuam vindo da previsão.
 */
function condicaoAtual(localId) {
  const limite = clima.horaManaus(new Date(Date.now() - 30 * 60000));
  const sensor = db.prepare(`SELECT * FROM leituras WHERE local_id = ? AND fonte = 'sensor' AND data_hora >= ?
    ORDER BY data_hora DESC LIMIT 1`).get(localId, limite);
  if (sensor) return { ...sensor, hora: sensor.data_hora };
  const hora = clima.horaCheiaAtual();
  const modelo = db.prepare('SELECT *, hora AS data_hora FROM previsoes WHERE local_id = ? AND hora <= ? ORDER BY hora DESC LIMIT 1')
    .get(localId, hora);
  const medido = qualiar.doLocal(localId);
  if (modelo && medido) return { ...modelo, pm25: medido.pm25, fonte: 'qualiar-ufam', detalhe: medido };
  return modelo;
}

function previsaoProximas(localId, horas = 24) {
  const inicio = clima.horaCheiaAtual();
  return db.prepare('SELECT * FROM previsoes WHERE local_id = ? AND hora >= ? ORDER BY hora LIMIT ?').all(localId, inicio, horas);
}

function fotosVisiveis(localId) {
  return db.prepare(`SELECT f.id, f.arquivo, f.etiquetas, f.comentario, f.criada_em, u.nome AS autor
    FROM fotos f LEFT JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.local_id = ? AND f.status = 'aprovada' AND f.criada_em >= datetime('now', ?)
    ORDER BY f.criada_em DESC`).all(localId, `-${VALIDADE_FOTO_H} hours`)
    .map((f) => ({
      id: f.id,
      url: f.arquivo.startsWith('demo:') ? `/img/demo/${f.arquivo.slice(5)}` : `/api/fotos/${f.id}/arquivo`,
      etiquetas: JSON.parse(f.etiquetas),
      comentario: f.comentario,
      criadaEm: f.criada_em.replace(' ', 'T') + 'Z',
      autor: (f.autor || 'Frequentador').split(' ')[0],
      demo: f.arquivo.startsWith('demo:'),
    }));
}

/** O local está aberto agora? (horário de Manaus) */
function estaAberto(l) {
  const agora = clima.horaManaus().slice(11, 16);
  return agora >= l.abre && agora < l.fecha;
}

/** Monta o resumo de um local para o perfil informado */
function resumoLocal(l, perfil) {
  const atual = condicaoAtual(l.id);
  const prev = previsaoProximas(l.id);
  const queima = queimadas.doLocal(l.id);
  const ajuste = (av) => indice.agravarPorQueimadas(av, queima);
  const aval = atual ? ajuste(indice.avaliar(atual, perfil)) : null;
  return {
    id: l.id, nome: l.nome, zona: l.zona, descricao: l.descricao, lat: l.lat, lng: l.lng,
    sensorProprio: Boolean(l.sensor_proprio),
    aberto: estaAberto(l),
    condicao: atual ? { pm25: atual.pm25, temperatura: atual.temperatura, umidade: atual.umidade, fonte: atual.fonte, hora: atual.data_hora, detalhe: atual.detalhe || null } : null,
    avaliacao: aval,
    melhorHorario: indice.melhorHorario(prev, l, perfil, ajuste),
    queimadas: queima,
    fotosRecentes: fotosVisiveis(l.id).length,
  };
}

// ---------------------------------------------------------------------------
// Rotas da API
// ---------------------------------------------------------------------------
app.get('/api/saude', (req, res) => res.json({ ok: true, dados: clima.estado(), queimadas: queimadas.estado(), qualiar: qualiar.estado(), push: push.ativo() }));

app.get('/api/locais', (req, res) => {
  const perfil = perfilDe(req);
  const locais = db.prepare('SELECT * FROM locais ORDER BY nome').all().map((l) => resumoLocal(l, perfil));
  res.json({ perfil, dados: clima.estado(), locais });
});

app.get('/api/locais/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM locais WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ erro: 'Local não encontrado.' });
  const perfil = perfilDe(req);
  const resumo = resumoLocal(l, perfil);
  // Recomendação para cada atividade, com o grupo sensível do perfil
  const atual = resumo.condicao;
  const ajuste = (av) => indice.agravarPorQueimadas(av, resumo.queimadas);
  const porAtividade = Object.entries(indice.ATIVIDADES).map(([id, a]) => ({
    id, nome: a.nome,
    avaliacao: atual ? ajuste(indice.avaliar(atual, { atividade: id, grupoSensivel: perfil.grupoSensivel })) : null,
    melhorHorario: indice.melhorHorario(previsaoProximas(l.id), l, { atividade: id, grupoSensivel: perfil.grupoSensivel }, ajuste),
  }));
  const horas = previsaoProximas(l.id, 12).map((p) => ({ ...p, nivel: ajuste(indice.avaliar(p, perfil)).nivel }));
  res.json({
    ...resumo,
    perfil,
    estrutura: { sombra: l.sombra, bebedouros: l.bebedouros, banheiros: l.banheiros, pista: l.pista, horario: l.horario_texto },
    funcionamento: { abre: l.abre, fecha: l.fecha },
    raio_m: l.raio_m,
    porAtividade,
    horas,
    fotos: fotosVisiveis(l.id),
    dados: clima.estado(),
  });
});

// ---- Autenticação ----
app.post('/api/auth/entrar', limiteLogin, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!u || !bcrypt.compareSync(senha, u.senha_hash)) return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
  criarSessao(res, u.id);
  res.json({ usuario: usuarioPublico(u) });
});

app.post('/api/auth/cadastrar', limiteLogin, (req, res) => {
  const nome = String(req.body.nome || '').trim().slice(0, 80);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
  const senha = String(req.body.senha || '');
  if (!nome || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erro: 'Informe nome e um e-mail válido.' });
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) return res.status(409).json({ erro: 'Já existe uma conta com esse e-mail.' });
  const atividade = indice.ATIVIDADES[req.body.atividade] ? req.body.atividade : 'caminhada';
  const r = db.prepare('INSERT INTO usuarios (nome,email,senha_hash,atividade,grupo_sensivel) VALUES (?,?,?,?,?)')
    .run(nome, email, bcrypt.hashSync(senha, 10), atividade, req.body.grupoSensivel ? 1 : 0);
  criarSessao(res, r.lastInsertRowid);
  res.status(201).json({ usuario: usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.lastInsertRowid)) });
});

app.post('/api/auth/sair', (req, res) => {
  const token = lerCookie(req, 'armanaus_sessao');
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  res.clearCookie('armanaus_sessao', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/eu', (req, res) => res.json({ usuario: usuarioPublico(req.usuario) }));

app.patch('/api/eu', exigeLogin, (req, res) => {
  const b = req.body;
  const campos = {
    atividade: indice.ATIVIDADES[b.atividade] ? b.atividade : req.usuario.atividade,
    grupo_sensivel: b.grupoSensivel != null ? (b.grupoSensivel ? 1 : 0) : req.usuario.grupo_sensivel,
    aviso_favorito: b.avisoFavorito != null ? (b.avisoFavorito ? 1 : 0) : req.usuario.aviso_favorito,
    aviso_melhor_horario: b.avisoMelhorHorario != null ? (b.avisoMelhorHorario ? 1 : 0) : req.usuario.aviso_melhor_horario,
  };
  db.prepare(`UPDATE usuarios SET atividade=:atividade, grupo_sensivel=:grupo_sensivel, aviso_favorito=:aviso_favorito,
    aviso_melhor_horario=:aviso_melhor_horario WHERE id=:id`).run({ ...campos, id: req.usuario.id });
  res.json({ usuario: usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id)) });
});

// ---- Favoritos ----
app.post('/api/favoritos/:localId', exigeLogin, (req, res) => {
  if (!db.prepare('SELECT 1 FROM locais WHERE id = ?').get(req.params.localId)) return res.status(404).json({ erro: 'Local não encontrado.' });
  db.prepare('INSERT OR IGNORE INTO favoritos (usuario_id, local_id) VALUES (?,?)').run(req.usuario.id, req.params.localId);
  res.json({ usuario: usuarioPublico(req.usuario) });
});
app.delete('/api/favoritos/:localId', exigeLogin, (req, res) => {
  db.prepare('DELETE FROM favoritos WHERE usuario_id = ? AND local_id = ?').run(req.usuario.id, req.params.localId);
  res.json({ usuario: usuarioPublico(req.usuario) });
});

// ---- Sensores do Qualiar-Ufam (pontos do mapa) ----
app.get('/api/qualiar/sensores', (req, res) => {
  const lista = qualiar.sensores().map((x) => {
    const ar = indice.iqar(x.pm25);
    return { ...x, classe: indice.classeIqar(x.pm25), categoria: ar.categoria, iqar: ar.indice };
  });
  res.json({ sensores: lista, fonte: 'Qualiar-Ufam (sensores PurpleAir)', atualizadoEm: lista[0]?.geradoEm || null });
});

// ---- Notificações push ----
app.get('/api/push/chave', (req, res) => res.json({ ativo: push.ativo(), chavePublica: push.ativo() ? push.chavePublica() : null }));

app.post('/api/push/inscrever', exigeLogin, (req, res) => {
  if (!push.ativo()) return res.status(503).json({ erro: 'Notificações no celular não estão disponíveis neste servidor.' });
  const insc = push.validarInscricao(req.body?.inscricao);
  if (!insc) return res.status(400).json({ erro: 'Inscrição inválida.' });
  db.prepare(`INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(req.usuario.id, insc.endpoint, insc.p256dh, insc.auth);
  res.status(201).json({ ok: true });
});

app.delete('/api/push/inscrever', exigeLogin, (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  db.prepare('DELETE FROM push_inscricoes WHERE endpoint = ? AND usuario_id = ?').run(endpoint, req.usuario.id);
  res.json({ ok: true });
});

// ---- Fotos (envio com confirmação de localização) ----
const ETIQUETAS = ['Céu limpo', 'Sombra boa', 'Fumaça visível', 'Pouca gente', 'Lotado', 'Chuva'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

/** Distância em metros entre dois pontos (fórmula de Haversine) */
function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Verifica a localização sem enviar a foto (usado para mostrar "Você está no parque")
app.post('/api/locais/:id/verificar-presenca', exigeLogin, (req, res) => {
  const l = db.prepare('SELECT * FROM locais WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ erro: 'Local não encontrado.' });
  const { lat, lng, precisao } = req.body;
  const d = distanciaM(Number(lat), Number(lng), l.lat, l.lng);
  const tolerancia = l.raio_m + Math.min(Number(precisao) || 0, 100);
  res.json({ dentro: d <= tolerancia, distanciaM: Math.round(d) });
});

app.post('/api/fotos', exigeLogin, upload.single('foto'), (req, res) => {
  const l = db.prepare('SELECT * FROM locais WHERE id = ?').get(req.body.local_id);
  if (!l) return res.status(404).json({ erro: 'Local não encontrado.' });
  if (!req.file) return res.status(400).json({ erro: 'Envie uma foto em JPG, PNG ou WebP de até 6 MB.' });
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ erro: 'Não foi possível confirmar sua localização.' });
  // Confirmação de presença: dentro do raio do local, com folga pela precisão do GPS (máx. 100 m)
  const d = distanciaM(lat, lng, l.lat, l.lng);
  const tolerancia = l.raio_m + Math.min(Number(req.body.precisao) || 0, 100);
  if (d > tolerancia) {
    return res.status(403).json({ erro: `Você parece estar a ${Math.round(d)} m de ${l.nome}. A foto só pode ser enviada de dentro do local.` });
  }
  // Grava o arquivo com nome aleatório. As coordenadas NÃO são salvas (LGPD).
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[req.file.mimetype];
  const nome = crypto.randomBytes(16).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, nome), req.file.buffer);
  let etiquetas = [];
  try { etiquetas = JSON.parse(req.body.etiquetas || '[]').filter((e) => ETIQUETAS.includes(e)); } catch { /* ignora */ }
  const comentario = String(req.body.comentario || '').trim().slice(0, 140) || null;
  const r = db.prepare('INSERT INTO fotos (local_id, usuario_id, arquivo, etiquetas, comentario) VALUES (?,?,?,?,?)')
    .run(l.id, req.usuario.id, nome, JSON.stringify(etiquetas), comentario);
  res.status(201).json({ id: r.lastInsertRowid, status: 'pendente' });
});

// Arquivo da foto: público se aprovada; o autor e a moderação veem as pendentes
app.get('/api/fotos/:id/arquivo', (req, res) => {
  const f = db.prepare('SELECT * FROM fotos WHERE id = ?').get(req.params.id);
  if (!f || f.arquivo.startsWith('demo:')) return res.sendStatus(404);
  const podeVer = f.status === 'aprovada' || (req.usuario && (req.usuario.papel === 'moderador' || req.usuario.id === f.usuario_id));
  if (!podeVer) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(UPLOAD_DIR, path.basename(f.arquivo)));
});

// ---- Moderação ----
app.get('/api/moderacao/fotos', exigeModerador, (req, res) => {
  const fotos = db.prepare(`SELECT f.*, l.nome AS local_nome, u.nome AS autor FROM fotos f
    JOIN locais l ON l.id = f.local_id LEFT JOIN usuarios u ON u.id = f.usuario_id
    WHERE f.status = 'pendente' ORDER BY f.criada_em`).all()
    .map((f) => ({
      id: f.id, localId: f.local_id, localNome: f.local_nome, autor: f.autor,
      etiquetas: JSON.parse(f.etiquetas), comentario: f.comentario, criadaEm: f.criada_em.replace(' ', 'T') + 'Z',
      url: f.arquivo.startsWith('demo:') ? `/img/demo/${f.arquivo.slice(5)}` : `/api/fotos/${f.id}/arquivo`,
    }));
  res.json({ fotos });
});

app.post('/api/moderacao/fotos/:id', exigeModerador, (req, res) => {
  const acao = req.body.acao === 'aprovar' ? 'aprovada' : req.body.acao === 'recusar' ? 'recusada' : null;
  if (!acao) return res.status(400).json({ erro: 'Ação inválida.' });
  const r = db.prepare(`UPDATE fotos SET status = ?, moderada_em = datetime('now'), moderador_id = ? WHERE id = ? AND status = 'pendente'`)
    .run(acao, req.usuario.id, req.params.id);
  if (!r.changes) return res.status(404).json({ erro: 'Foto não encontrada ou já moderada.' });
  // Foto recusada: o arquivo é apagado do servidor
  if (acao === 'recusada') {
    const f = db.prepare('SELECT arquivo FROM fotos WHERE id = ?').get(req.params.id);
    if (!f.arquivo.startsWith('demo:')) fs.rmSync(path.join(UPLOAD_DIR, path.basename(f.arquivo)), { force: true });
  }
  res.json({ ok: true, status: acao });
});

// Ajuste de coordenadas, raio e estrutura de um local (cadastro da Etapa 1)
app.put('/api/moderacao/locais/:id', exigeModerador, (req, res) => {
  const l = db.prepare('SELECT * FROM locais WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ erro: 'Local não encontrado.' });
  const b = req.body;
  const num = (v, atual) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : atual);
  const txt = (v, atual) => (typeof v === 'string' ? v.trim().slice(0, 120) : atual);
  db.prepare(`UPDATE locais SET lat=?, lng=?, raio_m=?, coordenadas_verificadas=?, sombra=?, bebedouros=?, banheiros=?, pista=?, horario_texto=? WHERE id=?`)
    .run(num(b.lat, l.lat), num(b.lng, l.lng), Math.round(num(b.raio_m, l.raio_m)), b.coordenadasVerificadas ? 1 : l.coordenadas_verificadas,
      txt(b.sombra, l.sombra), txt(b.bebedouros, l.bebedouros), txt(b.banheiros, l.banheiros), txt(b.pista, l.pista), txt(b.horario, l.horario_texto), l.id);
  res.json({ local: db.prepare('SELECT * FROM locais WHERE id = ?').get(l.id) });
});
app.get('/api/moderacao/locais', exigeModerador, (req, res) => {
  res.json({ locais: db.prepare('SELECT * FROM locais ORDER BY nome').all() });
});

// ---- Estações de monitoramento (ESP32) — Etapa 3 ----
// Envio: POST /api/sensores/leitura com cabeçalho "X-Chave-Sensor" e JSON
// { "pm25_bruto": 41.2, "temperatura": 30.1, "umidade": 78 }
app.post('/api/sensores/leitura', (req, res) => {
  const sensor = db.prepare('SELECT * FROM sensores WHERE chave = ?').get(String(req.get('X-Chave-Sensor') || ''));
  if (!sensor) return res.status(401).json({ erro: 'Chave de sensor inválida.' });
  const bruto = Number(req.body.pm25_bruto);
  const temperatura = Number(req.body.temperatura);
  const umidade = Number(req.body.umidade);
  if (![bruto, temperatura, umidade].every(Number.isFinite)) return res.status(400).json({ erro: 'Dados incompletos.' });
  // Descarta leituras fora da faixa física esperada (seção 4.4)
  if (bruto < 0 || bruto > 1000 || temperatura < 10 || temperatura > 50 || umidade < 0 || umidade > 100) {
    return res.status(422).json({ erro: 'Leitura fora da faixa esperada; descartada.' });
  }
  const pm25 = indice.corrigirPM25(bruto, umidade);
  db.prepare(`INSERT INTO leituras (local_id, data_hora, pm25, temperatura, umidade, fonte) VALUES (?,?,?,?,?, 'sensor')`)
    .run(sensor.local_id, clima.horaManaus(), pm25, temperatura, umidade);
  res.status(201).json({ ok: true, pm25Corrigido: pm25 });
});

// ---- Dados abertos (resultado esperado: base de dados aberta) ----
app.get('/api/dados/leituras.csv', (req, res) => {
  const linhas = db.prepare('SELECT local_id, data_hora, pm25, temperatura, umidade, fonte FROM leituras ORDER BY data_hora DESC LIMIT 50000').all();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="armanaus-leituras.csv"');
  res.write('local_id,data_hora,pm25_ugm3,temperatura_c,umidade_pct,fonte\n');
  for (const l of linhas) res.write(`${l.local_id},${l.data_hora},${l.pm25},${l.temperatura},${l.umidade},${l.fonte}\n`);
  res.end();
});

// Erros de upload (tamanho, tipo)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ erro: 'Foto muito grande (máximo 6 MB).' });
  console.error(err);
  res.status(500).json({ erro: 'Erro interno. Tente de novo.' });
});

// ---------------------------------------------------------------------------
// Site (PWA): arquivos estáticos e rota única para o roteador do navegador
// ---------------------------------------------------------------------------
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, arquivo) {
    // O service worker nunca deve ficar em cache, para as atualizações chegarem
    if (arquivo.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function iniciar() {
  try { await clima.atualizar(); } catch (e) { console.error('[clima] falha inicial:', e.message); }
  // Focos de queimada do INPE: se falhar, o app segue sem o agravante (resumo vencido é ignorado)
  const focos = () => queimadas.atualizar().catch((e) => console.warn('[queimadas]', e.message));
  focos();
  setInterval(focos, 60 * 60000);
  // Qualiar-Ufam (PM2,5 medido por sensores): se falhar, vale o modelo
  const medidos = () => qualiar.atualizar().catch((e) => console.warn('[qualiar]', e.message));
  medidos();
  setInterval(medidos, 30 * 60000);
  // Push: avisa quem tem favorito que mudou de nível (a cada 10 min; só lê o banco)
  const avisosPush = () => push.verificar(db, (u, l) => {
    const r = resumoLocal(l, { atividade: u.atividade, grupoSensivel: Boolean(u.grupo_sensivel) });
    return r.avaliacao ? { nome: l.nome, nivel: r.avaliacao.nivel, curto: r.avaliacao.curto, aberto: r.aberto } : null;
  }).catch((e) => console.warn('[push]', e.message));
  setInterval(avisosPush, 10 * 60000);
  // Atualiza os dados a cada 30 minutos
  setInterval(() => clima.atualizar().catch((e) => console.error('[clima]', e.message)), 30 * 60000);
  // Limpa sessões vencidas uma vez por dia
  setInterval(() => db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(new Date().toISOString()), 86400000);
  app.listen(PORT, () => console.log(`ArManaus rodando em http://localhost:${PORT}`));
}

if (require.main === module) iniciar();
module.exports = { app, iniciar, distanciaM };
