// ============================================================================
// ArManaus — utilitários de interface
// ============================================================================

/** Escapa texto para inserir com segurança em HTML (evita XSS) */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "2026-11-20T18:00" → "18h"; com minutos ≠ 0 → "18h30" */
export function hora(iso) {
  if (!iso) return '';
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  return m && m !== '00' ? `${h}h${m}` : `${h}h`;
}

/** Diz "hoje" ou "amanhã" para uma hora prevista, no horário de Manaus */
export function dia(iso) {
  const hoje = new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
  return iso.slice(0, 10) === hoje ? 'hoje' : 'amanhã';
}

/** Tempo relativo curto: "há 12 min" */
export function haQuanto(isoUtc) {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(isoUtc)) / 60000));
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h`;
}

/** Texto do melhor horário: "hoje, 18h às 20h" */
export function textoJanela(m) {
  if (!m) return 'Sem horário recomendado nas próximas horas';
  return `${dia(m.inicio)}, ${hora(m.inicio)} às ${hora(m.fim)}`;
}

/** Mostra um aviso rápido no topo da tela */
let temporizador;
export function avisar(texto) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.classList.add('visivel');
  clearTimeout(temporizador);
  temporizador = setTimeout(() => el.classList.remove('visivel'), 3200);
}

/** Ícones SVG usados em mais de um lugar (traço, no estilo SF Symbols) */
export const icones = {
  chevron: '<svg class="chevron" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>',
  voltar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  fechar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  estrela: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  compartilhar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  relogio: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  vento: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>',
  fogo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.2.9 2 1.7 2.4C10.3 8.2 10.6 5.5 12 3z"/></svg>',
  satelite: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  sensor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9z"/><circle cx="12" cy="12" r="2"/></svg>',
  termometro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/></svg>',
  arvore: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 9h-4l3 5H6l3-5H5z"/><path d="M12 17v4"/></svg>',
  pessoa: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="M11 21l2-6-2-3 1-5 3 3h3"/><path d="M9 12l-2 3"/></svg>',
  caminhada: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4" r="2"/><path d="M11 21l2-6-2-3 1-5 3 3h3"/><path d="M9 12l-2 3"/></svg>',
  corrida: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="15" cy="4" r="2"/><path d="M5 21l4-5 3 1 2-4-4-3 3-3 3 4h4"/><path d="M9 11l-3 1"/></svg>',
  ciclismo: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17l4-8h6l3 8M9.5 9L8 6h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
  localizacao: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z"/></svg>',
  camadas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  busca: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  mais: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  escudo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

/** Linha de lista agrupada com ponto colorido de nível */
export function linhaLocal(l, extra = '') {
  const n = l.avaliacao?.nivel || 1;
  const sub = l.aberto === false
    ? 'Fechado agora'
    : `Sensação ${Math.round(l.avaliacao?.indiceCalor ?? l.condicao?.temperatura ?? 0)}° · ${esc(l.melhorHorario ? 'melhor ' + textoJanela(l.melhorHorario) : l.zona)}`;
  return `<a class="linha tocavel" href="/local/${esc(l.id)}" data-link style="--recuo:40px">
    <span class="ponto n${n}" aria-hidden="true"></span>
    <span class="corpo"><span class="titulo">${esc(l.nome)}</span><span class="sub">${sub}</span></span>
    ${extra}${icones.chevron}</a>`;
}
