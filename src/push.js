// ============================================================================
// ArManaus — notificações push (Web Push), inclusive com o site fechado
// Avisa quando um local favorito muda de nível. Só funciona se as chaves VAPID
// estiverem configuradas (veja o README). Sem elas, o recurso fica desligado e
// o app continua avisando enquanto estiver aberto.
//
// Chaves: npx web-push generate-vapid-keys
// Variáveis: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex.: mailto:voce@email.com)
// ============================================================================
const PUBLICA = process.env.VAPID_PUBLIC_KEY || '';
const PRIVADA = process.env.VAPID_PRIVATE_KEY || '';
const ASSUNTO = process.env.VAPID_SUBJECT || 'mailto:contato@armanaus.app';

let webpush = null;
let falhaModulo = null;

/** O push está configurado e o módulo web-push está instalado? */
function ativo() {
  if (!PUBLICA || !PRIVADA) return false;
  if (webpush) return true;
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(ASSUNTO, PUBLICA, PRIVADA);
    return true;
  } catch (e) {
    if (!falhaModulo) { falhaModulo = e.message; console.warn('[push] desligado:', e.message); }
    return false;
  }
}

function chavePublica() {
  return PUBLICA;
}

/** Confere o formato de uma inscrição enviada pelo navegador */
function validarInscricao(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

/**
 * Decide quais avisos enviar (função pura).
 * Avisa quando o nível mudou desde a última verificação e o local está aberto.
 * A primeira vez que um local aparece só registra o nível, sem avisar.
 * @param {Record<string, number>} anteriores nível anterior por local
 * @param {Array<{id:string, nome:string, nivel:number, curto:string, aberto:boolean}>} atuais
 * @returns {{avisos:Array<{localId:string,titulo:string,corpo:string,url:string}>, novos:Record<string,number>}}
 */
function decidirAvisos(anteriores, atuais) {
  const avisos = [];
  const novos = {};
  for (const l of atuais) {
    const antes = anteriores[l.id];
    if (antes && antes !== l.nivel && l.aberto) {
      avisos.push({
        localId: l.id,
        titulo: `${l.nome}: ${l.curto}`,
        corpo: l.nivel < antes ? 'As condições melhoraram.' : 'As condições pioraram.',
        url: '/local/' + l.id,
      });
    }
    novos[l.id] = l.nivel;
  }
  return { avisos, novos };
}

async function enviarPadrao(inscricao, carga) {
  await webpush.sendNotification(
    { endpoint: inscricao.endpoint, keys: { p256dh: inscricao.p256dh, auth: inscricao.auth } },
    JSON.stringify(carga),
    { TTL: 3600 },
  );
}

/**
 * Percorre quem tem push ligado e avisa sobre os favoritos que mudaram de nível.
 * @param {object} db banco SQLite
 * @param {(usuario:object, local:object)=>{nome:string,nivel:number,curto:string,aberto:boolean}|null} avaliar
 * @param {Function} [enviar] troca do envio (usada nos testes)
 */
async function verificar(db, avaliar, enviar = enviarPadrao) {
  if (enviar === enviarPadrao && !ativo()) return { enviados: 0 };
  const usuarios = db.prepare(`SELECT * FROM usuarios WHERE aviso_favorito = 1
    AND EXISTS (SELECT 1 FROM push_inscricoes p WHERE p.usuario_id = usuarios.id)`).all();
  const guardar = db.prepare('INSERT OR REPLACE INTO push_estado (usuario_id, local_id, nivel) VALUES (?,?,?)');
  const removerInsc = db.prepare('DELETE FROM push_inscricoes WHERE endpoint = ?');
  let enviados = 0;
  for (const u of usuarios) {
    const locais = db.prepare(`SELECT l.* FROM locais l JOIN favoritos f ON f.local_id = l.id WHERE f.usuario_id = ?`).all(u.id);
    const atuais = [];
    for (const l of locais) {
      const a = avaliar(u, l);
      if (a) atuais.push({ id: l.id, ...a });
    }
    const anteriores = {};
    for (const e of db.prepare('SELECT local_id, nivel FROM push_estado WHERE usuario_id = ?').all(u.id)) anteriores[e.local_id] = e.nivel;
    const { avisos, novos } = decidirAvisos(anteriores, atuais);
    const inscricoes = db.prepare('SELECT * FROM push_inscricoes WHERE usuario_id = ?').all(u.id);
    for (const aviso of avisos) {
      for (const insc of inscricoes) {
        try {
          await enviar(insc, { titulo: aviso.titulo, corpo: aviso.corpo, url: aviso.url });
          enviados++;
        } catch (e) {
          // 404/410: o navegador cancelou a inscrição, então ela é apagada
          if (e && (e.statusCode === 404 || e.statusCode === 410)) removerInsc.run(insc.endpoint);
          else console.warn('[push] falha ao enviar:', e?.message || e);
        }
      }
    }
    for (const [localId, nivel] of Object.entries(novos)) guardar.run(u.id, localId, nivel);
  }
  return { enviados };
}

module.exports = { ativo, chavePublica, validarInscricao, decidirAvisos, verificar };
