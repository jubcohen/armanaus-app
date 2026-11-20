// ============================================================================
// ArManaus — comunicação com o servidor
// ============================================================================

/** Faz uma requisição à API e devolve o JSON; erros viram exceção com mensagem */
async function req(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    credentials: 'same-origin',
    headers: opcoes.body && !(opcoes.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opcoes,
    body: opcoes.body && !(opcoes.body instanceof FormData) ? JSON.stringify(opcoes.body) : opcoes.body,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) {
    const erro = new Error(dados.erro || 'Não foi possível concluir. Verifique sua conexão.');
    erro.status = r.status;
    throw erro;
  }
  return dados;
}

/** Parâmetros do perfil para quem não está logado (salvos no onboarding) */
function perfilLocal() {
  try {
    const p = JSON.parse(localStorage.getItem('armanaus_perfil') || '{}');
    const q = new URLSearchParams();
    if (p.atividade) q.set('atividade', p.atividade);
    if (p.grupoSensivel != null) q.set('sensivel', p.grupoSensivel ? '1' : '0');
    return q.toString() ? '?' + q : '';
  } catch { return ''; }
}

export const api = {
  locais: (logado) => req('/api/locais' + (logado ? '' : perfilLocal())),
  local: (id, logado) => req(`/api/locais/${encodeURIComponent(id)}` + (logado ? '' : perfilLocal())),
  eu: () => req('/api/eu'),
  entrar: (email, senha) => req('/api/auth/entrar', { method: 'POST', body: { email, senha } }),
  cadastrar: (dados) => req('/api/auth/cadastrar', { method: 'POST', body: dados }),
  sair: () => req('/api/auth/sair', { method: 'POST' }),
  atualizarPerfil: (dados) => req('/api/eu', { method: 'PATCH', body: dados }),
  favoritar: (id, sim) => req(`/api/favoritos/${encodeURIComponent(id)}`, { method: sim ? 'POST' : 'DELETE' }),
  verificarPresenca: (id, pos) => req(`/api/locais/${encodeURIComponent(id)}/verificar-presenca`, { method: 'POST', body: pos }),
  enviarFoto: (form) => req('/api/fotos', { method: 'POST', body: form }),
  fotosPendentes: () => req('/api/moderacao/fotos'),
  moderar: (id, acao) => req(`/api/moderacao/fotos/${id}`, { method: 'POST', body: { acao } }),
  locaisModeracao: () => req('/api/moderacao/locais'),
  salvarLocal: (id, dados) => req(`/api/moderacao/locais/${encodeURIComponent(id)}`, { method: 'PUT', body: dados }),
};
