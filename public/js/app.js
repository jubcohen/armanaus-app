// ============================================================================
// ArManaus — aplicativo web (PWA)
// Roteador simples + telas: boas-vindas, mapa, locais, local, enviar foto,
// perfil e moderação.
// ============================================================================
import { api } from './api.js';
import { esc, hora, textoJanela, haQuanto, avisar, icones, linhaLocal } from './ui.js';

const app = document.getElementById('app');
const telaMapa = document.getElementById('tela-mapa');
const abas = document.getElementById('abas');
const botaoBusca = document.getElementById('botao-busca');

// Estado compartilhado entre as telas
const estado = {
  usuario: null,
  locais: null,        // última lista de locais (com avaliação)
  dados: null,         // fonte dos dados e horário da atualização
  mapa: null,
  camadaPinos: null,
  pedidoInstalacao: null,
};

const NOMES_ATIVIDADE = { caminhada: 'caminhar', corrida: 'correr', ciclismo: 'pedalar' };
const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------------------------------------------------------------------------
// Preferências de quem ainda não tem conta (guardadas no aparelho)
// ---------------------------------------------------------------------------
function lerPerfilLocal() {
  try { return JSON.parse(localStorage.getItem('armanaus_perfil') || '{}'); } catch { return {}; }
}
function salvarPerfilLocal(p) {
  try { localStorage.setItem('armanaus_perfil', JSON.stringify({ ...lerPerfilLocal(), ...p })); } catch { /* modo privado */ }
}
function perfilAtual() {
  const u = estado.usuario;
  if (u) return { atividade: u.atividade, grupoSensivel: u.grupoSensivel };
  const p = lerPerfilLocal();
  return { atividade: p.atividade || 'caminhada', grupoSensivel: Boolean(p.grupoSensivel) };
}
function onboardingFeito() {
  try { return localStorage.getItem('armanaus_onboarding') === '1'; } catch { return true; }
}
function marcarOnboarding() {
  try { localStorage.setItem('armanaus_onboarding', '1'); } catch { /* ignora */ }
}

// ---------------------------------------------------------------------------
// Roteador (History API): cada tela tem uma URL própria
// ---------------------------------------------------------------------------
const rotas = [
  [/^\/boas-vindas\/?(\d)?$/, (m) => telaBoasVindas(Number(m[1] || 1))],
  [/^\/(mapa)?$/, () => telaMapaPrincipal()],
  [/^\/locais$/, () => telaLocais()],
  [/^\/local\/([\w-]+)$/, (m) => telaLocal(m[1])],
  [/^\/local\/([\w-]+)\/foto$/, (m) => telaLocal(m[1], { foto: true })],
  [/^\/perfil$/, () => telaPerfil()],
  [/^\/moderacao$/, () => telaModeracao()],
];

export function navegar(url, { substituir = false } = {}) {
  if (substituir) history.replaceState({}, '', url); else history.pushState({}, '', url);
  rotear();
}

async function rotear() {
  const caminho = location.pathname;
  // Primeiro acesso: boas-vindas antes do mapa
  if ((caminho === '/' || caminho === '/mapa') && !onboardingFeito()) {
    history.replaceState({}, '', '/boas-vindas');
    return rotear();
  }
  const rota = rotas.find(([re]) => re.test(caminho));
  const naBoasVindas = caminho.startsWith('/boas-vindas');
  abas.hidden = naBoasVindas;
  botaoBusca.hidden = naBoasVindas;
  telaMapa.hidden = !(caminho === '/' || caminho === '/mapa');
  // Marca a aba atual
  const aba = caminho.startsWith('/local') ? 'locais' : caminho.startsWith('/perfil') || caminho.startsWith('/moderacao') ? 'perfil' : 'mapa';
  abas.querySelectorAll('a').forEach((a) => { if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.querySelector('.veu')?.remove();
  document.querySelector('.folha-modal')?.remove();
  if (!rota) { app.innerHTML = '<div class="tela"><div class="vazio"><h2>Página não encontrada</h2><a href="/mapa" data-link>Voltar ao mapa</a></div></div>'; return; }
  await rota[1](caminho.match(rota[0]));
}

// Links internos não recarregam a página
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || a.target === '_blank') return;
  e.preventDefault();
  navegar(a.getAttribute('href'));
});
window.addEventListener('popstate', rotear);

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
async function carregarLocais() {
  const r = await api.locais(Boolean(estado.usuario));
  estado.locais = r.locais;
  estado.dados = r.dados;
  return r.locais;
}

function textoFonte(dados) {
  const quando = dados?.atualizadoEm ? new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }).replace(':', 'h') : '';
  const fonte = dados?.fonte === 'open-meteo' ? 'Open-Meteo (Copernicus)' : 'dados simulados';
  return `${fonte}${quando ? ' · atualizado às ' + quando : ''}`;
}
function faixaDemo(dados) {
  return dados?.fonte === 'simulado'
    ? '<p class="faixa-demo">Modo demonstração: o servidor não conseguiu acessar a Open-Meteo, então os números são simulados.</p>'
    : '';
}

/** Ordem de recomendação: abertos primeiro, depois menor nível e menor calor */
function ordenarRecomendados(locais) {
  return [...locais].sort((a, b) => (b.aberto - a.aberto) || (a.avaliacao.nivel - b.avaliacao.nivel) || (a.avaliacao.indiceCalor - b.avaliacao.indiceCalor));
}

// ---------------------------------------------------------------------------
// Tela: boas-vindas (onboarding em 2 passos, pulável)
// ---------------------------------------------------------------------------
function telaBoasVindas(passo) {
  window.scrollTo(0, 0);
  if (passo === 1) {
    app.innerHTML = `
    <section class="boas-vindas">
      <button class="botao texto pular" type="button" data-acao="pular">Pular</button>
      <div class="centro">
        <img class="icone-app" src="/icons/icon-192.png" alt="">
        <h1>Saiba onde e quando dá para se exercitar sem fumaça e calor</h1>
        <p>O ArManaus junta a qualidade do ar e o calor dos parques de Manaus e indica o melhor horário para caminhar, correr ou pedalar.</p>
      </div>
      <div class="acoes">
        <div class="pontos-paginas" aria-hidden="true"><i class="ativo"></i><i></i></div>
        <a class="botao cheio tocavel" href="/boas-vindas/2" data-link>Começar</a>
      </div>
    </section>`;
  } else {
    const p = perfilAtual();
    app.innerHTML = `
    <section class="boas-vindas">
      <button class="botao texto pular" type="button" data-acao="pular">Agora não</button>
      <div class="centro">
        <h1>Como você se exercita?</h1>
        <p>Assim os alertas já vêm ajustados para você. Dá para mudar depois no Perfil.</p>
        <div class="escolhas" role="radiogroup" aria-label="Atividade principal">
          ${['caminhada', 'corrida', 'ciclismo'].map((a) => `
            <button type="button" role="radio" aria-checked="${p.atividade === a}" data-atividade="${a}" class="tocavel">
              ${icones[a]}${{ caminhada: 'Caminhada', corrida: 'Corrida', ciclismo: 'Ciclismo' }[a]}</button>`).join('')}
        </div>
        <div class="grupo"><label class="linha"><span class="corpo"><span class="titulo">Faço parte de um grupo sensível</span>
          <span class="sub">Asma, doença cardíaca, gestação ou 60 anos ou mais</span></span>
          <span class="interruptor"><input type="checkbox" id="sensivel" ${p.grupoSensivel ? 'checked' : ''}><span></span></span></label></div>
      </div>
      <div class="acoes">
        <div class="pontos-paginas" aria-hidden="true"><i></i><i class="ativo"></i></div>
        <button class="botao cheio tocavel" type="button" data-acao="concluir">Ver o mapa</button>
      </div>
    </section>`;
    app.querySelectorAll('[data-atividade]').forEach((b) => b.addEventListener('click', () => {
      app.querySelectorAll('[data-atividade]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    app.querySelector('[data-acao="concluir"]').addEventListener('click', async () => {
      const atividade = app.querySelector('[data-atividade][aria-checked="true"]')?.dataset.atividade || 'caminhada';
      const grupoSensivel = app.querySelector('#sensivel').checked;
      salvarPerfilLocal({ atividade, grupoSensivel });
      if (estado.usuario) estado.usuario = (await api.atualizarPerfil({ atividade, grupoSensivel })).usuario;
      marcarOnboarding();
      navegar('/mapa', { substituir: true });
    });
  }
  app.querySelector('[data-acao="pular"]').addEventListener('click', () => { marcarOnboarding(); navegar('/mapa', { substituir: true }); });
}

// ---------------------------------------------------------------------------
// Tela: mapa (mapa real de Manaus + folha inferior em vidro)
// ---------------------------------------------------------------------------
function iniciarMapa() {
  if (estado.mapa || !window.L) return;
  const escuro = matchMedia('(prefers-color-scheme: dark)').matches;
  estado.mapa = L.map('mapa', { zoomControl: false, attributionControl: true }).setView([-3.075, -60.02], 12);
  // Duas bases: mapa (OpenStreetMap com o estilo claro/escuro da CARTO) e satélite (imagens da Esri)
  estado.bases = {
    mapa: L.tileLayer(`https://{s}.basemaps.cartocdn.com/${escuro ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }),
    satelite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 18,
      attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics e a comunidade GIS',
    }),
  };
  estado.satelite = lerPreferencia('armanaus_base') === 'satelite';
  estado.bases[estado.satelite ? 'satelite' : 'mapa'].addTo(estado.mapa);
  estado.camadaSensores = L.layerGroup();
  estado.mostrarSensores = lerPreferencia('armanaus_sensores') !== '0';
  if (estado.mostrarSensores) estado.camadaSensores.addTo(estado.mapa);
  estado.camadaPinos = L.layerGroup().addTo(estado.mapa);

  // Controles flutuantes (vidro) e legenda
  const controles = document.createElement('div');
  controles.className = 'mapa-controles vidro';
  controles.innerHTML = `<button type="button" aria-label="Mostrar minha localização" data-acao="localizar">${icones.localizacao}</button><hr>
    <button type="button" aria-label="Centralizar em Manaus" data-acao="centralizar">${icones.camadas}</button><hr>
    <button type="button" aria-label="Mostrar mapa de satélite" aria-pressed="${estado.satelite}" data-acao="satelite">${icones.satelite}</button><hr>
    <button type="button" aria-label="Mostrar sensores de qualidade do ar da Ufam" aria-pressed="${estado.mostrarSensores}" data-acao="sensores">${icones.sensor}</button>`;
  const legenda = document.createElement('div');
  legenda.className = 'legenda vidro';
  legenda.setAttribute('aria-label', 'Legenda');
  legenda.innerHTML = ['Recomendado', 'Com cautela', 'Grupos sensíveis', 'Não recomendado']
    .map((t, i) => `<span><i class="ponto n${i + 1}" aria-hidden="true"></i>${t}</span>`).join('')
    + `<span data-legenda="sensores" ${estado.mostrarSensores ? '' : 'hidden'}><i class="sensor-legenda" aria-hidden="true"></i>Sensor Qualiar (cor = PM2,5)</span>`;
  telaMapa.append(controles, legenda);
  controles.addEventListener('click', (e) => {
    const acao = e.target.closest('button')?.dataset.acao;
    if (acao === 'centralizar') estado.mapa.flyTo([-3.075, -60.02], 12);
    if (acao === 'localizar') localizarNoMapa();
    if (acao === 'satelite') alternarSatelite(controles);
    if (acao === 'sensores') alternarSensores(controles, legenda);
  });
}

/** localStorage pode falhar (modo privado): sem ele, vale o padrão */
function lerPreferencia(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function gravarPreferencia(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* ignora */ }
}

function alternarSatelite(controles) {
  estado.mapa.removeLayer(estado.bases[estado.satelite ? 'satelite' : 'mapa']);
  estado.satelite = !estado.satelite;
  estado.bases[estado.satelite ? 'satelite' : 'mapa'].addTo(estado.mapa);
  estado.bases[estado.satelite ? 'satelite' : 'mapa'].bringToBack();
  controles.querySelector('[data-acao="satelite"]').setAttribute('aria-pressed', String(estado.satelite));
  gravarPreferencia('armanaus_base', estado.satelite ? 'satelite' : 'mapa');
}

async function alternarSensores(controles, legenda) {
  estado.mostrarSensores = !estado.mostrarSensores;
  controles.querySelector('[data-acao="sensores"]').setAttribute('aria-pressed', String(estado.mostrarSensores));
  legenda.querySelector('[data-legenda="sensores"]').hidden = !estado.mostrarSensores;
  gravarPreferencia('armanaus_sensores', estado.mostrarSensores ? '1' : '0');
  if (!estado.mostrarSensores) return estado.camadaSensores.remove();
  estado.camadaSensores.addTo(estado.mapa);
  const n = await atualizarSensores();
  if (n === 0) avisar('Sem dados dos sensores da Ufam agora.');
}

/** Desenha os sensores do Qualiar-Ufam (PurpleAir) no mapa; devolve quantos foram desenhados */
async function atualizarSensores() {
  if (!estado.mostrarSensores || !estado.camadaSensores) return 0;
  try {
    const { sensores } = await api.sensoresQualiar();
    estado.camadaSensores.clearLayers();
    for (const x of sensores) {
      const pm = String(x.pm25).replace('.', ',');
      const html = `<div class="sensor-marcador c${x.classe}" role="img" aria-label="Sensor ${esc(x.nome)}: PM2,5 ${pm}, ${esc(x.categoria)}"></div>`;
      L.marker([x.lat, x.lng], { icon: L.divIcon({ className: 'marcador-pino', html, iconSize: [0, 0] }), keyboard: false, zIndexOffset: -100 })
        .bindPopup(`<b>Sensor ${esc(x.nome)}</b><br>PM2,5: ${pm} µg/m³ · ${esc(x.categoria)}<br>Medido ${haQuanto(x.vistoEm)}<br>Fonte: rede Qualiar-Ufam (PurpleAir)`)
        .addTo(estado.camadaSensores);
    }
    return sensores.length;
  } catch { return 0; }   // sem conexão ou sem dado: o mapa segue sem a camada
}

let marcadorEu = null;
function localizarNoMapa() {
  if (!navigator.geolocation) return avisar('Seu navegador não oferece localização.');
  navigator.geolocation.getCurrentPosition((p) => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (marcadorEu) marcadorEu.setLatLng(ll);
    else marcadorEu = L.marker(ll, { icon: L.divIcon({ className: 'marcador-pino', html: '<div class="minha-posicao" style="transform:translate(-50%,-50%)"></div>', iconSize: [0, 0] }) }).addTo(estado.mapa);
    estado.mapa.flyTo(ll, 14);
  }, () => avisar('Não foi possível obter sua localização. Verifique a permissão nos Ajustes.'), { enableHighAccuracy: true, timeout: 10000 });
}

function desenharPinos(locais) {
  estado.camadaPinos.clearLayers();
  for (const l of locais) {
    const n = l.avaliacao.nivel;
    const temp = Math.round(l.avaliacao.indiceCalor);
    const html = `<a class="pino n${n} ${l.aberto ? '' : 'fechado'}" href="/local/${esc(l.id)}" data-link
      aria-label="${esc(l.nome)}: ${esc(l.avaliacao.rotulo)}, sensação de ${temp} graus${l.aberto ? '' : ', fechado agora'}" style="transform:translate(-50%,-19px)">
      <span class="circulo">${temp}°</span><span class="nome">${esc(l.nome.replace(/^Parque (Estadual |Municipal )?(do |da |dos )?/, ''))}</span></a>`;
    L.marker([l.lat, l.lng], { icon: L.divIcon({ className: 'marcador-pino', html, iconSize: [0, 0] }), keyboard: false }).addTo(estado.camadaPinos);
  }
}

async function telaMapaPrincipal() {
  iniciarMapa();
  app.innerHTML = `
  <section class="folha vidro" id="folha" aria-label="Melhores locais agora">
    <button class="alca" type="button" aria-label="Expandir ou recolher a lista"><span></span></button>
    <div class="conteudo"><div class="carregando">Carregando condições…</div></div>
  </section>`;
  setTimeout(() => estado.mapa?.invalidateSize(), 50);
  const folha = app.querySelector('#folha');
  configurarFolha(folha);
  try {
    atualizarSensores();
    const locais = await carregarLocais();
    desenharPinos(locais);
    const ordenados = ordenarRecomendados(locais);
    const desktop = matchMedia('(min-width: 1000px)').matches;
    folha.querySelector('.conteudo').innerHTML = `
      <h2>Melhores agora</h2>
      <p class="resumo">Manaus · ${esc(textoFonte(estado.dados))}</p>
      ${estado.dados?.fonte === 'simulado' ? `<div style="margin:0 16px">${faixaDemo(estado.dados)}</div>` : ''}
      <div>${ordenados.slice(0, desktop ? 9 : 5).map((l) => `
        <a class="linha tocavel" href="/local/${esc(l.id)}" data-link style="--recuo:78px">
          <span class="miniatura n${l.avaliacao.nivel}"><b>${Math.round(l.avaliacao.indiceCalor)}°</b></span>
          <span class="corpo"><span class="titulo">${esc(l.nome)}</span>
          <span class="sub">${l.aberto ? 'Melhor ' + esc(textoJanela(l.melhorHorario)) : 'Fechado agora'}${l.fotosRecentes ? ` · ${l.fotosRecentes} foto${l.fotosRecentes > 1 ? 's' : ''}` : ''}</span></span>
          <span class="selo n${l.avaliacao.nivel}">${esc(l.avaliacao.curto)}</span></a>`).join('')}
      </div>
      <a class="linha" href="/locais" data-link><span class="corpo"><span class="titulo" style="color:var(--destaque)">Ver todos os locais</span></span>${icones.chevron}</a>`;
  } catch (e) {
    folha.querySelector('.conteudo').innerHTML = `<div class="vazio"><h2>Sem conexão</h2><p>${esc(e.message)}</p>
      <button class="botao" type="button" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}

/**
 * Folha inferior arrastável: acompanha o dedo 1:1, projeta o movimento pela
 * velocidade ao soltar (como a rolagem do iOS) e encaixa na altura mais próxima.
 */
function configurarFolha(folha) {
  const alturas = () => [Math.round(innerHeight * 0.3), Math.round(innerHeight * 0.52), Math.round(innerHeight * 0.86)];
  let altura = alturas()[1];
  const aplicar = (h) => { altura = h; folha.style.setProperty('--altura-folha', h + 'px'); folha.style.transform = ''; };
  aplicar(altura);
  const max = innerHeight * 0.86;
  let inicioY = 0; let inicioAltura = 0; let historico = [];
  const alvoArrasto = folha.querySelector('.alca');
  const comecar = (e) => {
    if (matchMedia('(min-width: 1000px)').matches) return;
    inicioY = e.clientY; inicioAltura = altura; historico = [{ y: e.clientY, t: performance.now() }];
    folha.classList.add('arrastando');
    alvoArrasto.setPointerCapture(e.pointerId);
  };
  const mover = (e) => {
    if (!folha.classList.contains('arrastando')) return;
    let h = inicioAltura + (inicioY - e.clientY);
    const [min] = alturas();
    // Resistência progressiva além dos limites (rubber-band)
    const elastico = (x, d) => (x * d * 0.55) / (d + 0.55 * Math.abs(x));
    if (h > max) h = max + elastico(h - max, innerHeight);
    if (h < min) h = min - elastico(min - h, innerHeight);
    folha.style.transform = `translateY(${max - h}px)`;
    historico.push({ y: e.clientY, t: performance.now() });
    if (historico.length > 5) historico.shift();
  };
  const terminar = (e) => {
    if (!folha.classList.contains('arrastando')) return;
    folha.classList.remove('arrastando');
    const a = historico[0]; const b = historico[historico.length - 1];
    const v = b.t > a.t ? ((a.y - b.y) / (b.t - a.t)) * 1000 : 0; // px/s, positivo = para cima
    const atual = inicioAltura + (inicioY - e.clientY);
    // Projeção do ponto final (fórmula de desaceleração usada pela Apple)
    const projetada = atual + (v / 1000) * 0.998 / (1 - 0.998);
    const alvo = alturas().reduce((m, x) => (Math.abs(x - projetada) < Math.abs(m - projetada) ? x : m));
    // Toque simples na alça alterna entre média e alta
    if (Math.abs(inicioY - e.clientY) < 6) return aplicar(altura === alturas()[2] ? alturas()[1] : alturas()[2]);
    aplicar(alvo);
  };
  alvoArrasto.addEventListener('pointerdown', comecar);
  alvoArrasto.addEventListener('pointermove', mover);
  alvoArrasto.addEventListener('pointerup', terminar);
  alvoArrasto.addEventListener('pointercancel', terminar);
}

// ---------------------------------------------------------------------------
// Tela: lista de locais agrupada por nível
// ---------------------------------------------------------------------------
async function telaLocais() {
  const buscar = new URLSearchParams(location.search).has('buscar');
  app.innerHTML = `<div class="tela">
    <h1 class="titulo-grande" style="margin-top:48px">Locais</h1>
    <label class="busca">${icones.busca}<span class="oculto-visual">Buscar local</span>
      <input type="search" id="busca" placeholder="Buscar parque ou praça" autocomplete="off"></label>
    <div id="lista"><div class="carregando">Carregando…</div></div></div>`;
  window.scrollTo(0, 0);
  const campo = app.querySelector('#busca');
  if (buscar) campo.focus();
  try {
    const locais = await carregarLocais();
    const desenhar = () => {
      const termo = campo.value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
      const filtrados = locais.filter((l) => l.nome.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(termo));
      const grupos = [
        ['Recomendados agora', (l) => l.aberto && l.avaliacao.nivel === 1],
        ['Com cautela', (l) => l.aberto && l.avaliacao.nivel === 2],
        ['Evite se for de grupo sensível', (l) => l.aberto && l.avaliacao.nivel === 3],
        ['Não recomendados agora', (l) => l.aberto && l.avaliacao.nivel === 4],
        ['Fechados agora', (l) => !l.aberto],
      ];
      const html = grupos.map(([titulo, f]) => {
        const itens = ordenarRecomendados(filtrados.filter(f));
        return itens.length ? `<h2 class="cabecalho-secao">${titulo}</h2><div class="grupo">${itens.map((l) => linhaLocal(l)).join('')}</div>` : '';
      }).join('');
      app.querySelector('#lista').innerHTML = html || '<div class="vazio"><h2>Nenhum local encontrado</h2><p>Tente outro nome.</p></div>';
      if (html) app.querySelector('#lista').insertAdjacentHTML('beforeend', `<p class="rodape-secao">Os níveis consideram fumaça e calor juntos, para ${esc(NOMES_ATIVIDADE[perfilAtual().atividade])}${perfilAtual().grupoSensivel ? ' e grupo sensível' : ''}. Fonte: ${esc(textoFonte(estado.dados))}.</p>`);
    };
    campo.addEventListener('input', desenhar);
    desenhar();
  } catch (e) {
    app.querySelector('#lista').innerHTML = `<div class="vazio"><h2>Sem conexão</h2><p>${esc(e.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// Tela: página do local (estilo Apple Tempo)
// ---------------------------------------------------------------------------
function textoAr(categoria) {
  return { Boa: 'Ar bom', Moderada: 'Fumaça leve', Ruim: 'Fumaça', 'Muito ruim': 'Fumaça intensa', 'Péssima': 'Fumaça intensa' }[categoria] || '';
}

function fraseRecomendacao(local) {
  const p = local.perfil;
  const minha = local.porAtividade.find((a) => a.id === p.atividade);
  const verbo = NOMES_ATIVIDADE[p.atividade];
  const janela = minha?.melhorHorario;
  const jan = janela ? ` O melhor horário é ${textoJanela(janela)}.` : '';
  if (!local.aberto) return `O local está fechado agora. Abre às ${local.funcionamento.abre.replace(':00', 'h').replace(':', 'h')}.${jan}`;
  switch (minha.avaliacao.nivel) {
    case 1: return `Bom momento para ${verbo}. Leve água e aproveite.`;
    case 2: return `Dá para ${verbo} com cautela: hidrate-se e reduza a intensidade.${jan}`;
    case 3: return `Evite ${verbo} agora se você é de grupo sensível ou vai fazer esforço intenso.${jan}`;
    default: return `Não é recomendado ${verbo} agora. Prefira uma atividade em ambiente fechado.${jan}`;
  }
}

async function telaLocal(id, { foto = false } = {}) {
  // Evita recarregar a página do local ao abrir/fechar a folha de foto
  const jaAberta = app.querySelector(`.pagina-local[data-id="${CSS.escape(id)}"]`);
  let local = estado.localAberto?.id === id ? estado.localAberto : null;
  if (!jaAberta || !local) {
    app.innerHTML = '<div class="pagina-local"><div class="carregando" style="color:#fff">Carregando…</div></div>';
    window.scrollTo(0, 0);
    try {
      local = await api.local(id, Boolean(estado.usuario));
      estado.localAberto = local;
    } catch (e) {
      app.innerHTML = `<div class="tela"><div class="vazio"><h2>Não foi possível abrir</h2><p>${esc(e.message)}</p><a href="/locais" data-link>Voltar</a></div></div>`;
      return;
    }
    desenharLocal(local);
  }
  if (foto) abrirFolhaFoto(local);
}

/** De onde veio a condição atual do local (sensor próprio, Qualiar-Ufam ou modelo) */
function textoFonteLocal(l) {
  const c = l.condicao;
  if (c.fonte === 'sensor') return 'sensor ArManaus do local';
  if (c.fonte === 'qualiar-ufam' && c.detalhe) {
    const d = c.detalhe;
    const quem = d.origem === 'sensor'
      ? `sensor ${d.sensor}, a ${String(d.distanciaKm).replace('.', ',')} km`
      : `mediana dos ${d.nSensores} sensores de Manaus`;
    return `PM2,5 medido pela rede Qualiar-Ufam (${quem}, PurpleAir); temperatura e umidade do ${textoFonte(l.dados)}`;
  }
  return textoFonte(l.dados);
}

/** Cartão de focos de queimada (INPE); some quando ainda não há dado recente */
function cartaoQueimadas(q, a) {
  if (!q) return '';
  const perto = q.focosPerto > 0;
  const texto = q.focos24h === 0
    ? `Nenhum foco de queimada detectado a menos de ${q.raioInfoKm} km nas últimas 24 horas.`
    : `${q.focos24h} ${q.focos24h === 1 ? 'foco' : 'focos'} a menos de ${q.raioInfoKm} km nas últimas 24 horas; o mais próximo está a ${String(q.maisProximoKm).replace('.', ',')} km.`;
  return `<section class="cartao-escuro" aria-label="Focos de queimada">
        <h2>${icones.fogo}Focos de queimada</h2>
        <p class="recomendacao" style="margin-top:0">${texto}</p>
        ${perto ? `<p class="nota">${a.agravadoPorQueimadas ? 'Há foco a menos de ' + q.raioAgravanteKm + ' km: o alerta subiu um nível por causa da fumaça próxima.' : 'Há foco a menos de ' + q.raioAgravanteKm + ' km, mas o alerta já está no nível máximo.'}</p>` : ''}
        <p class="nota">Fonte: INPE (Programa Queimadas), atualizado ${haQuanto(q.atualizadoEm)}.</p>
      </section>`;
}

function desenharLocal(l) {
  const a = l.avaliacao;
  const fav = estado.usuario?.favoritos?.includes(l.id);
  const minha = l.porAtividade.find((x) => x.id === l.perfil.atividade) || l.porAtividade[0];
  const fundo = a.categoriaAr === 'Boa' && a.nivel === 1 ? 'ceu-limpo' : a.categoriaAr === 'Boa' && a.indiceCalor >= 32 ? 'calor' : '';
  const melhores = new Set();
  if (minha.melhorHorario) {
    for (let t = Date.parse(minha.melhorHorario.inicio + ':00Z'); t < Date.parse(minha.melhorHorario.fim + ':00Z'); t += 3600000) {
      melhores.add(new Date(t).toISOString().slice(0, 16));
    }
  }
  const valor = (v) => (String(v || '').startsWith('[') ? '<span style="opacity:.7">A levantar</span>' : esc(v));
  app.innerHTML = `
  <div class="topo-flutuante">
    <button type="button" class="botao-redondo vidro-escuro tocavel" data-acao="voltar" aria-label="Voltar">${icones.voltar}</button>
    <div class="grupo-botoes vidro-escuro">
      <button type="button" data-acao="compartilhar" aria-label="Compartilhar local">${icones.compartilhar}</button>
      <button type="button" data-acao="favoritar" aria-label="${fav ? 'Remover dos favoritos' : 'Favoritar local'}" aria-pressed="${Boolean(fav)}">${icones.estrela.replace('<svg', `<svg class="${fav ? 'cheio' : ''}"`)}</button>
    </div>
  </div>
  <article class="pagina-local ${fundo}" data-id="${esc(l.id)}">
    <div class="miolo">
      ${faixaDemo(l.dados)}
      <header class="heroi">
        <h1>${esc(l.nome)}</h1>
        <span class="temp" aria-label="Temperatura ${Math.round(l.condicao.temperatura)} graus">${Math.round(l.condicao.temperatura)}°</span>
        <span class="cond">${esc(textoAr(a.categoriaAr))}</span>
        <span class="sens">Sensação de ${Math.round(a.indiceCalor)}°</span>
      </header>

      <section class="cartao-escuro" aria-label="Recomendação agora">
        <span class="selo-solido n${minha.avaliacao.nivel}">${l.aberto ? esc(minha.avaliacao.rotulo) : 'Fechado agora'}</span>
        <p class="recomendacao">${esc(fraseRecomendacao(l))}</p>
      </section>

      <section class="cartao-escuro">
        <h2>${icones.pessoa}Por atividade</h2>
        ${l.porAtividade.map((x) => `
          <div class="linha-escura"><span class="corpo"><span class="titulo">${esc(x.nome)}</span>
            <span class="sub">Melhor ${esc(textoJanela(x.melhorHorario))}</span></span>
            <span class="selo-solido n${x.avaliacao.nivel}" style="font-size:.8125rem;padding:4px 10px">${esc(x.avaliacao.curto)}</span></div>`).join('')}
        ${l.perfil.grupoSensivel ? '<p class="nota">Considerando que você é de grupo sensível.</p>' : ''}
      </section>

      <section class="cartao-escuro">
        <h2>${icones.relogio}Próximas horas · melhor ${esc(textoJanela(minha.melhorHorario))}</h2>
        <div class="horas" role="list">
          ${l.horas.map((h, i) => `<div role="listitem" class="${melhores.has(h.hora) ? 'melhor' : ''}" aria-label="${hora(h.hora)}: nível ${h.nivel}, ${Math.round(h.temperatura)} graus">
            <span class="h">${i === 0 ? 'Agora' : hora(h.hora)}</span>
            <span class="barra n${h.nivel}" style="height:${10 + h.nivel * 13}px" aria-hidden="true"></span>
            <span class="t">${Math.round(h.temperatura)}°</span></div>`).join('')}
        </div>
        <p class="nota">Barra menor e verde = menos fumaça e calor${l.aberto ? '' : '. Horários fora do funcionamento não são recomendados'}.</p>
      </section>

      <div class="dupla">
        <section class="cartao-escuro indicador">
          <h2>${icones.vento}Qualidade do ar</h2>
          <span class="grande">${a.iqar}</span><span class="cat">${esc(a.categoriaAr)}</span>
          <span class="regua ar" aria-hidden="true"><i style="left:${Math.min(100, (a.iqar / 250) * 100)}%"></i></span>
          <span class="nota" style="margin:0">PM2,5: ${l.condicao.pm25} µg/m³</span>
        </section>
        <section class="cartao-escuro indicador">
          <h2>${icones.termometro}Índice de calor</h2>
          <span class="grande">${Math.round(a.indiceCalor)}°</span><span class="cat">${esc(a.categoriaCalor)}</span>
          <span class="regua calor" aria-hidden="true"><i style="left:${Math.max(0, Math.min(100, ((a.indiceCalor - 20) / 30) * 100))}%"></i></span>
          <span class="nota" style="margin:0">Umidade ${Math.round(l.condicao.umidade)}%</span>
        </section>
      </div>

      ${cartaoQueimadas(l.queimadas, a)}

      <section class="cartao-escuro" style="display:flex;flex-direction:column;gap:12px">
        <h2 style="margin:0">${icones.camera}Fotos de quem está lá</h2>
        ${l.fotos.length ? `<div class="mosaico">${l.fotos.slice(0, 3).map((f) => `
          <figure><img src="${esc(f.url)}" alt="Foto enviada por ${esc(f.autor)}${f.etiquetas.length ? ': ' + esc(f.etiquetas.join(', ')) : ''}" loading="lazy">
          <figcaption><span>${esc(f.etiquetas[0] ? f.etiquetas[0] + ' · ' : '')}${haQuanto(f.criadaEm)}</span></figcaption></figure>`).join('')}</div>
          <p class="nota" style="margin:0">Só aceitas de quem estava no local, com confirmação de localização.</p>`
          : '<p class="vazio-fotos">Nenhuma foto nas últimas 6 horas. Está aí agora? Mostre como está o parque.</p>'}
        <a class="botao cheio tocavel" href="/local/${esc(l.id)}/foto" data-link>${icones.camera.replace('<svg', '<svg style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2"')}Estou aqui, enviar foto</a>
      </section>

      <section class="cartao-escuro">
        <h2>${icones.arvore}Estrutura do local</h2>
        ${[['Sombra', l.estrutura.sombra], ['Bebedouros', l.estrutura.bebedouros], ['Banheiros', l.estrutura.banheiros], ['Pista', l.estrutura.pista], ['Horário', l.estrutura.horario]]
          .map(([k, v]) => `<div class="linha-escura" style="min-height:44px"><span class="corpo"><span>${k}</span></span><span style="font-weight:600;text-align:right">${valor(v)}</span></div>`).join('')}
      </section>

      <p class="fontes">${esc(l.descricao)} Fonte dos dados: ${esc(textoFonteLocal(l))}.</p>
    </div>
  </article>`;

  // Ações do topo
  app.querySelector('[data-acao="voltar"]').addEventListener('click', () => (history.length > 1 ? history.back() : navegar('/locais')));
  app.querySelector('[data-acao="compartilhar"]').addEventListener('click', async () => {
    const dados = { title: `${l.nome} · ArManaus`, text: `${l.nome}: ${minha.avaliacao.rotulo}`, url: location.origin + '/local/' + l.id };
    if (navigator.share) navigator.share(dados).catch(() => {});
    else { await navigator.clipboard?.writeText(dados.url); avisar('Link copiado'); }
  });
  app.querySelector('[data-acao="favoritar"]').addEventListener('click', async (e) => {
    if (!estado.usuario) { avisar('Entre na sua conta para favoritar'); return navegar('/perfil?voltar=' + encodeURIComponent(location.pathname)); }
    const botao = e.currentTarget;
    const agora = botao.getAttribute('aria-pressed') !== 'true';
    botao.setAttribute('aria-pressed', String(agora));
    botao.querySelector('svg').classList.toggle('cheio', agora);
    try {
      estado.usuario = (await api.favoritar(l.id, agora)).usuario;
      avisar(agora ? 'Adicionado aos favoritos' : 'Removido dos favoritos');
      // Pede permissão de notificação no momento em que faz sentido
      if (agora && estado.usuario.avisoFavorito && 'Notification' in window && Notification.permission === 'default') {
        if (confirm(`Quer ser avisado quando ${l.nome} mudar de nível? As notificações chegam enquanto o ArManaus estiver aberto ou instalado.`)) {
          Notification.requestPermission();
        }
      }
    } catch (err) { avisar(err.message); }
  });
}

// ---------------------------------------------------------------------------
// Folha: enviar foto com confirmação de localização
// ---------------------------------------------------------------------------
function abrirFolhaFoto(local) {
  const veu = document.createElement('div');
  veu.className = 'veu';
  const folha = document.createElement('section');
  folha.className = 'folha-modal';
  folha.setAttribute('role', 'dialog');
  folha.setAttribute('aria-modal', 'true');
  folha.setAttribute('aria-label', 'Nova foto');
  document.body.append(veu, folha);
  const fechar = () => navegar(`/local/${local.id}`, { substituir: true });
  veu.addEventListener('click', fechar);
  const estadoFoto = { posicao: null, arquivo: null, etiquetas: new Set() };

  const cabeca = (direita = '') => `<div class="cabeca">
      <button type="button" class="botao-redondo vidro tocavel" data-acao="fechar" aria-label="Cancelar">${icones.fechar}</button>
      <h2>Nova foto</h2>${direita || '<span style="width:44px"></span>'}</div>`;

  function passoEntrar() {
    folha.innerHTML = `${cabeca()}<div class="rolagem"><div class="vazio"><h2>Entre para enviar fotos</h2>
      <p>As fotos passam por moderação, por isso precisamos saber quem enviou.</p>
      <a class="botao" href="/perfil?voltar=${encodeURIComponent(`/local/${local.id}/foto`)}" data-link>Entrar ou criar conta</a></div></div>`;
    folha.querySelector('[data-acao="fechar"]').addEventListener('click', fechar);
  }

  function passoPermissao(erro = '') {
    folha.innerHTML = `${cabeca()}<div class="rolagem">
      <div class="vazio" style="padding:24px 8px">
        <h2>Confirmar que você está em ${esc(local.nome)}</h2>
        <p>Só aceitamos fotos de quem está no local, para que mostrem a situação real. Usamos sua localização apenas agora, para essa conferência, e ela não fica salva com a foto.</p>
      </div>
      ${erro ? `<p class="erro-texto" role="alert" style="margin:0 8px 8px;text-align:center">${esc(erro)}</p>` : ''}
      <button type="button" class="botao cheio tocavel" data-acao="localizar">Confirmar localização</button>
    </div>`;
    folha.querySelector('[data-acao="fechar"]').addEventListener('click', fechar);
    folha.querySelector('[data-acao="localizar"]').addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Localizando…';
      if (!navigator.geolocation) return passoPermissao('Seu navegador não oferece localização.');
      navigator.geolocation.getCurrentPosition(async (p) => {
        const posicao = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy };
        try {
          const r = await api.verificarPresenca(local.id, posicao);
          if (!r.dentro) return passoPermissao(`Você parece estar a ${r.distanciaM >= 1000 ? (r.distanciaM / 1000).toFixed(1) + ' km' : r.distanciaM + ' m'} do local. A foto só pode ser enviada de dentro dele.`);
          estadoFoto.posicao = posicao;
          passoFormulario();
        } catch (err) { passoPermissao(err.message); }
      }, (err) => passoPermissao(err.code === 1
        ? 'A localização está bloqueada. Libere em Ajustes > Privacidade > Serviços de Localização (ou nas permissões do navegador) e tente de novo.'
        : 'Não foi possível obter sua localização. Tente de novo ao ar livre.'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  function passoFormulario() {
    const etiquetas = ['Céu limpo', 'Sombra boa', 'Fumaça visível', 'Pouca gente', 'Lotado', 'Chuva'];
    folha.innerHTML = `${cabeca('<button type="button" class="botao tocavel" data-acao="publicar" disabled>Publicar</button>')}
    <div class="rolagem">
      <div class="grupo status-local"><span class="icone" style="background:var(--n1)">${icones.check}</span>
        <span class="corpo" style="display:flex;flex-direction:column"><span style="font-weight:600">${esc(local.nome)}</span>
        <span class="sub" style="font-size:.8125rem;color:var(--texto-2)">Você está dentro da área do local</span></span></div>
      <label class="previa tocavel" for="arquivo-foto">
        <span id="previa-conteudo" style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--texto-2);font-weight:600">
          ${icones.camera.replace('<svg', '<svg style="width:36px;height:36px;fill:none;stroke:currentColor;stroke-width:1.8"')}Tirar ou escolher foto</span>
        <input type="file" id="arquivo-foto" accept="image/*" capture="environment" class="oculto-visual">
      </label>
      <h3 class="cabecalho-secao" style="margin-top:10px">O que dá para ver?</h3>
      <div class="etiquetas">${etiquetas.map((t) => `<button type="button" aria-pressed="false" data-etiqueta="${esc(t)}" class="tocavel">${esc(t)}</button>`).join('')}</div>
      <label class="grupo" style="margin-top:10px;display:block"><span class="oculto-visual">Comentário opcional</span>
        <input type="text" id="comentario" maxlength="140" placeholder="Comentário (opcional)" style="min-height:50px;padding:0 16px;border:0;background:transparent;width:100%;font-size:1.0625rem;outline:none"></label>
      <p class="rodape-secao" style="margin-top:4px">Evite fotografar rostos. A foto passa por moderação e fica visível por até 6 horas. Dados de localização gravados no arquivo da foto são removidos antes do envio.</p>
    </div>`;
    folha.querySelector('[data-acao="fechar"]').addEventListener('click', fechar);
    const publicar = folha.querySelector('[data-acao="publicar"]');
    folha.querySelector('#arquivo-foto').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      estadoFoto.arquivo = f;
      const url = URL.createObjectURL(f);
      folha.querySelector('#previa-conteudo').outerHTML = `<img src="${url}" alt="Prévia da foto">`;
      publicar.disabled = false;
    });
    folha.querySelectorAll('[data-etiqueta]').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.etiqueta;
      const ativo = !estadoFoto.etiquetas.has(t);
      if (ativo) estadoFoto.etiquetas.add(t); else estadoFoto.etiquetas.delete(t);
      b.setAttribute('aria-pressed', String(ativo));
    }));
    publicar.addEventListener('click', async () => {
      publicar.disabled = true;
      publicar.textContent = 'Enviando…';
      try {
        const imagem = await reduzirImagem(estadoFoto.arquivo);
        const form = new FormData();
        form.append('foto', imagem, 'foto.jpg');
        form.append('local_id', local.id);
        form.append('lat', estadoFoto.posicao.lat);
        form.append('lng', estadoFoto.posicao.lng);
        form.append('precisao', estadoFoto.posicao.precisao);
        form.append('etiquetas', JSON.stringify([...estadoFoto.etiquetas]));
        form.append('comentario', folha.querySelector('#comentario').value);
        await api.enviarFoto(form);
        avisar('Foto enviada. Ela aparece depois da moderação.');
        fechar();
      } catch (err) {
        avisar(err.message);
        publicar.disabled = false;
        publicar.textContent = 'Publicar';
      }
    });
  }

  if (!estado.usuario) passoEntrar(); else passoPermissao();
}

/**
 * Reduz a foto para no máximo 1600 px e regrava em JPEG pelo canvas.
 * Isso deixa o envio leve e remove os metadados EXIF (inclusive GPS).
 */
function reduzirImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível processar a foto.'))), 'image/jpeg', 0.82);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('Formato de foto não suportado. Use JPG ou PNG.'));
    img.src = URL.createObjectURL(arquivo);
  });
}

// ---------------------------------------------------------------------------
// Tela: perfil (entrar/criar conta, preferências, favoritos, avisos)
// ---------------------------------------------------------------------------
async function telaPerfil() {
  window.scrollTo(0, 0);
  const voltar = new URLSearchParams(location.search).get('voltar');
  if (!estado.usuario) return telaEntrar(voltar);
  const u = estado.usuario;
  const iniciais = u.nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  app.innerHTML = `<div class="tela">
    <div class="barra-topo" style="margin-top:44px"><h1 class="titulo-grande" style="margin:0 4px">Perfil</h1><span class="avatar" aria-hidden="true">${esc(iniciais)}</span></div>
    <p style="margin:2px 4px 14px;color:var(--texto-2)">${esc(u.nome)} · ${esc(u.email)}</p>
    <div class="grupo numeros">
      <div><b>${u.fotosEnviadas}</b><span>fotos enviadas</span></div>
      <div><b class="destaque">${u.fotosAprovadas}</b><span>aprovadas</span></div>
      <div><b>${u.favoritos.length}</b><span>favoritos</span></div>
    </div>

    <h2 class="cabecalho-secao">Atividade principal</h2>
    <div class="segmentado" role="radiogroup" aria-label="Atividade principal">
      ${['caminhada', 'corrida', 'ciclismo'].map((a) => `<button type="button" role="radio" aria-checked="${u.atividade === a}" data-atividade="${a}">${{ caminhada: 'Caminhada', corrida: 'Corrida', ciclismo: 'Ciclismo' }[a]}</button>`).join('')}
    </div>

    <h2 class="cabecalho-secao">Saúde</h2>
    <div class="grupo"><label class="linha"><span class="corpo"><span class="titulo">Faço parte de um grupo sensível</span></span>
      <span class="interruptor"><input type="checkbox" data-campo="grupoSensivel" ${u.grupoSensivel ? 'checked' : ''}><span></span></span></label></div>
    <p class="rodape-secao">Asma, doença cardíaca, gestação ou 60 anos ou mais. Os alertas ficam mais rígidos.</p>

    <h2 class="cabecalho-secao">Favoritos</h2>
    <div class="grupo" id="favoritos"><div class="linha"><span class="corpo"><span class="sub">Carregando…</span></span></div></div>

    <h2 class="cabecalho-secao">Avisos</h2>
    <div class="grupo">
      <label class="linha"><span class="corpo"><span class="titulo">Favorito mudou de nível</span></span>
        <span class="interruptor"><input type="checkbox" data-campo="avisoFavorito" ${u.avisoFavorito ? 'checked' : ''}><span></span></span></label>
      <label class="linha"><span class="corpo"><span class="titulo">Melhor horário do dia</span></span>
        <span class="interruptor"><input type="checkbox" data-campo="avisoMelhorHorario" ${u.avisoMelhorHorario ? 'checked' : ''}><span></span></span></label>
    </div>
    <p class="rodape-secao">Os avisos chegam como notificação. Com o app instalado na tela inicial e a permissão de notificações liberada, chegam também com o site fechado; sem isso, só enquanto ele estiver aberto.</p>

    <h2 class="cabecalho-secao">Acesso rápido</h2>
    <div class="grupo">
      <button type="button" class="linha tocavel" data-acao="instalar" style="--recuo:58px"><span class="icone-linha" style="background:var(--destaque)">${icones.mais}</span>
        <span class="corpo"><span class="titulo">${instalado() ? 'Já está na Tela de Início' : 'Adicionar à Tela de Início'}</span></span>${icones.chevron}</button>
      <a class="linha tocavel" href="/api/dados/leituras.csv" download style="--recuo:58px"><span class="icone-linha" style="background:#4F7FB8">${icones.download}</span>
        <span class="corpo"><span class="titulo">Baixar dados abertos (CSV)</span></span>${icones.chevron}</a>
      ${u.papel === 'moderador' ? `<a class="linha tocavel" href="/moderacao" data-link style="--recuo:58px"><span class="icone-linha" style="background:#3A6BA5">${icones.escudo}</span>
        <span class="corpo"><span class="titulo">Moderação</span></span>${icones.chevron}</a>` : ''}
    </div>

    <div class="grupo" style="margin-top:28px"><button type="button" class="linha tocavel" data-acao="sair" style="justify-content:center;color:var(--n4-texto);font-size:1.0625rem">Sair da conta</button></div>
  </div>`;

  // Atividade (controle segmentado)
  app.querySelectorAll('[data-atividade]').forEach((b) => b.addEventListener('click', async () => {
    app.querySelectorAll('[data-atividade]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    estado.usuario = (await api.atualizarPerfil({ atividade: b.dataset.atividade })).usuario;
    avisar('Alertas ajustados para ' + b.textContent.toLowerCase());
  }));
  // Interruptores
  app.querySelectorAll('[data-campo]').forEach((input) => input.addEventListener('change', async () => {
    if (input.checked && input.dataset.campo.startsWith('aviso') && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    try {
      estado.usuario = (await api.atualizarPerfil({ [input.dataset.campo]: input.checked })).usuario;
      if (input.dataset.campo === 'avisoFavorito') {
        if (input.checked) {
          if (await ativarPush().catch(() => false)) avisar('Avisos no celular ligados, mesmo com o site fechado.');
        } else await desativarPush().catch(() => {});
      }
    } catch (e) { input.checked = !input.checked; avisar(e.message); }
  }));
  app.querySelector('[data-acao="instalar"]').addEventListener('click', instalarApp);
  app.querySelector('[data-acao="sair"]').addEventListener('click', async () => {
    await desativarPush().catch(() => {});
    await api.sair();
    estado.usuario = null;
    avisar('Você saiu da conta');
    telaPerfil();
  });
  // Favoritos com o nível atual
  try {
    const locais = estado.locais || (await carregarLocais());
    const favs = locais.filter((l) => u.favoritos.includes(l.id));
    app.querySelector('#favoritos').innerHTML = favs.length
      ? favs.map((l) => linhaLocal(l, `<span class="selo n${l.avaliacao.nivel}">${esc(l.avaliacao.curto)}</span>`)).join('')
      : '<div class="linha"><span class="corpo"><span class="sub">Toque na estrela de um local para acompanhá-lo aqui.</span></span></div>';
  } catch { /* sem conexão: mantém a mensagem */ }
}

function telaEntrar(voltar) {
  const p = perfilAtual();
  app.innerHTML = `<div class="tela">
    <h1 class="titulo-grande" style="margin-top:48px">Perfil</h1>
    <p style="margin:0 4px 6px;color:var(--texto-2)">Entre para favoritar locais, receber avisos e enviar fotos. O mapa e as recomendações funcionam sem conta.</p>
    <form id="form-entrar" novalidate>
      <h2 class="cabecalho-secao" id="titulo-form">Entrar</h2>
      <div class="grupo">
        <label class="linha campo" id="campo-nome" hidden><span class="oculto-visual">Nome</span><input name="nome" autocomplete="name" placeholder="Nome"></label>
        <label class="linha campo"><span class="oculto-visual">E-mail</span><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="E-mail" required></label>
        <label class="linha campo"><span class="oculto-visual">Senha</span><input name="senha" type="password" autocomplete="current-password" placeholder="Senha" required></label>
      </div>
      <p class="erro-texto" id="erro" role="alert" hidden></p>
      <button class="botao cheio tocavel" type="submit" style="margin-top:14px" id="enviar">Entrar</button>
      <button class="botao texto cheio" type="button" id="alternar" style="margin-top:4px">Criar conta</button>
    </form>

    <h2 class="cabecalho-secao">Contas de demonstração</h2>
    <div class="grupo">
      ${[['ana@armanaus.app', 'Ana Lima', 'Usuária · corrida · grupo sensível'], ['julia@armanaus.app', 'Julia de Brito Cohen', 'Moderação'], ['carlos@armanaus.app', 'Carlos Souza', 'Usuário · caminhada']]
        .map(([email, nome, papel]) => `<button type="button" class="linha tocavel" data-demo="${email}"><span class="corpo"><span class="titulo">${nome}</span><span class="sub">${papel}</span></span>${icones.chevron}</button>`).join('')}
    </div>
    <p class="rodape-secao">Senha de todas as contas de teste: ArManaus2026.</p>

    <h2 class="cabecalho-secao">Sem conta</h2>
    <div class="segmentado" role="radiogroup" aria-label="Atividade principal">
      ${['caminhada', 'corrida', 'ciclismo'].map((a) => `<button type="button" role="radio" aria-checked="${p.atividade === a}" data-atividade="${a}">${{ caminhada: 'Caminhada', corrida: 'Corrida', ciclismo: 'Ciclismo' }[a]}</button>`).join('')}
    </div>
    <div class="grupo" style="margin-top:8px"><label class="linha"><span class="corpo"><span class="titulo">Faço parte de um grupo sensível</span></span>
      <span class="interruptor"><input type="checkbox" id="sensivel-local" ${p.grupoSensivel ? 'checked' : ''}><span></span></span></label></div>
    <p class="rodape-secao">Sem conta, essas preferências ficam salvas só neste aparelho.</p>
  </div>`;

  const form = app.querySelector('#form-entrar');
  let criando = false;
  app.querySelector('#alternar').addEventListener('click', () => {
    criando = !criando;
    app.querySelector('#campo-nome').hidden = !criando;
    app.querySelector('#titulo-form').textContent = criando ? 'Criar conta' : 'Entrar';
    app.querySelector('#enviar').textContent = criando ? 'Criar conta' : 'Entrar';
    app.querySelector('#alternar').textContent = criando ? 'Já tenho conta' : 'Criar conta';
    form.senha.setAttribute('autocomplete', criando ? 'new-password' : 'current-password');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = app.querySelector('#erro');
    erro.hidden = true;
    try {
      const r = criando
        ? await api.cadastrar({ nome: form.nome.value, email: form.email.value, senha: form.senha.value, ...perfilAtual() })
        : await api.entrar(form.email.value, form.senha.value);
      estado.usuario = r.usuario;
      avisar(`Olá, ${r.usuario.nome.split(' ')[0]}!`);
      navegar(voltar || '/perfil', { substituir: true });
    } catch (err) { erro.textContent = err.message; erro.hidden = false; }
  });
  app.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    form.email.value = b.dataset.demo;
    form.senha.value = 'ArManaus2026';
    form.requestSubmit();
  }));
  app.querySelectorAll('[data-atividade]').forEach((b) => b.addEventListener('click', () => {
    app.querySelectorAll('[data-atividade]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    salvarPerfilLocal({ atividade: b.dataset.atividade });
  }));
  app.querySelector('#sensivel-local').addEventListener('change', (e) => salvarPerfilLocal({ grupoSensivel: e.target.checked }));
}

// ---------------------------------------------------------------------------
// Instalação na tela inicial (PWA)
// ---------------------------------------------------------------------------
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); estado.pedidoInstalacao = e; });

async function instalarApp() {
  if (instalado()) return avisar('O ArManaus já está na sua Tela de Início');
  if (estado.pedidoInstalacao) {
    estado.pedidoInstalacao.prompt();
    await estado.pedidoInstalacao.userChoice;
    estado.pedidoInstalacao = null;
    return;
  }
  // iPhone (Safari) e navegadores sem o pedido automático: instruções
  const veu = document.createElement('div');
  veu.className = 'veu';
  const folha = document.createElement('section');
  folha.className = 'folha-modal';
  folha.style.top = 'auto';
  folha.setAttribute('role', 'dialog');
  folha.setAttribute('aria-label', 'Adicionar à Tela de Início');
  folha.innerHTML = `<div class="cabeca"><button type="button" class="botao-redondo vidro" aria-label="Fechar">${icones.fechar}</button><h2>Adicionar à Tela de Início</h2><span style="width:44px"></span></div>
    <div class="rolagem"><div class="grupo">
      ${(ehIOS
        ? ['Toque em Compartilhar (o quadrado com a seta para cima) na barra do Safari.', 'Role e toque em "Adicionar à Tela de Início".', 'Toque em "Adicionar". O ArManaus abre em tela cheia, como um app.']
        : ['Abra o menu do navegador (⋮).', 'Toque em "Instalar app" ou "Adicionar à tela inicial".', 'Confirme. O ArManaus abre em tela cheia, como um app.'])
        .map((t, i) => `<div class="linha" style="--recuo:52px"><span class="avatar" style="width:28px;height:28px;font-size:.875rem">${i + 1}</span><span class="corpo"><span>${t}</span></span></div>`).join('')}
    </div></div>`;
  document.body.append(veu, folha);
  const fechar = () => { veu.remove(); folha.remove(); };
  veu.addEventListener('click', fechar);
  folha.querySelector('button').addEventListener('click', fechar);
}

// ---------------------------------------------------------------------------
// Tela: moderação (fotos pendentes e cadastro dos locais)
// ---------------------------------------------------------------------------
async function telaModeracao() {
  if (estado.usuario?.papel !== 'moderador') {
    app.innerHTML = '<div class="tela"><div class="vazio"><h2>Acesso restrito</h2><p>Entre com uma conta de moderação.</p><a href="/perfil" data-link>Ir para o Perfil</a></div></div>';
    return;
  }
  app.innerHTML = `<div class="tela">
    <div class="barra-topo"><a class="botao-redondo vidro tocavel" href="/perfil" data-link aria-label="Voltar ao Perfil">${icones.voltar}</a></div>
    <h1 class="titulo-grande">Moderação</h1>
    <h2 class="cabecalho-secao">Fotos aguardando</h2>
    <div class="grupo" id="pendentes"><div class="carregando">Carregando…</div></div>
    <h2 class="cabecalho-secao">Locais e placas QR</h2>
    <p class="rodape-secao" style="margin-top:0;margin-bottom:8px">Ajuste as coordenadas e o raio aceito para fotos. Locais marcados como aproximados precisam ser conferidos na visita de campo.</p>
    <div id="locais-mod"><div class="carregando">Carregando…</div></div>
  </div>`;
  window.scrollTo(0, 0);

  // Fotos pendentes
  const pendentes = app.querySelector('#pendentes');
  const desenharPendentes = async () => {
    const { fotos } = await api.fotosPendentes();
    pendentes.innerHTML = fotos.length ? fotos.map((f) => `
      <div class="cartao-foto" data-id="${f.id}" style="border-bottom:.5px solid var(--separador)">
        <img src="${esc(f.url)}" alt="Foto enviada para ${esc(f.localNome)}">
        <div><strong>${esc(f.localNome)}</strong>
          <div style="font-size:.8125rem;color:var(--texto-2)">${esc(f.autor || 'Usuário')} · ${haQuanto(f.criadaEm)}${f.etiquetas.length ? ' · ' + esc(f.etiquetas.join(', ')) : ''}</div>
          ${f.comentario ? `<div style="font-size:.9375rem;margin-top:4px">"${esc(f.comentario)}"</div>` : ''}
          <div class="acoes"><button type="button" class="botao tocavel" data-moderar="aprovar">Aprovar</button>
          <button type="button" class="botao perigo tocavel" data-moderar="recusar">Recusar</button></div></div>
      </div>`).join('') : '<div class="vazio" style="padding:24px"><h2 style="font-size:1.0625rem">Nada pendente</h2><p>Novas fotos aparecem aqui.</p></div>';
    pendentes.querySelectorAll('[data-moderar]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-id]').dataset.id;
      try {
        await api.moderar(id, b.dataset.moderar);
        avisar(b.dataset.moderar === 'aprovar' ? 'Foto aprovada e publicada' : 'Foto recusada e apagada');
        desenharPendentes();
      } catch (e) { avisar(e.message); }
    }));
  };
  desenharPendentes().catch((e) => { pendentes.innerHTML = `<p class="erro-texto">${esc(e.message)}</p>`; });

  // Locais (coordenadas, raio e QR)
  const { locais } = await api.locaisModeracao();
  await carregarBibliotecaQR();
  app.querySelector('#locais-mod').innerHTML = locais.map((l) => `
    <form class="grupo" data-local="${esc(l.id)}" style="margin-bottom:10px">
      <div class="linha" style="align-items:flex-start">
        <span class="corpo"><span class="titulo">${esc(l.nome)}</span>
        <span class="sub">${l.coordenadas_verificadas ? 'Coordenadas conferidas' : 'Coordenadas aproximadas · conferir em campo'}</span>
        <a href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=17/${l.lat}/${l.lng}" target="_blank" rel="noopener" style="font-size:.8125rem">Ver no OpenStreetMap</a></span>
        <span class="qr" data-qr="${esc(location.origin + '/local/' + l.id)}" role="img" aria-label="Código QR da página de ${esc(l.nome)}"></span>
      </div>
      <div class="form-local">
        <label>Latitude<input name="lat" inputmode="decimal" value="${l.lat}"></label>
        <label>Longitude<input name="lng" inputmode="decimal" value="${l.lng}"></label>
        <label>Raio (m)<input name="raio_m" inputmode="numeric" value="${l.raio_m}"></label>
        <label style="grid-column:span 3;flex-direction:row;align-items:center;gap:8px;color:var(--texto)"><input type="checkbox" name="coordenadasVerificadas" ${l.coordenadas_verificadas ? 'checked' : ''} style="width:20px;min-height:20px"> Coordenadas conferidas em campo</label>
        <button class="botao tocavel" type="submit" style="grid-column:span 3;min-height:44px">Salvar</button>
      </div>
    </form>`).join('');
  // Desenha os códigos QR para as placas dos parques
  app.querySelectorAll('[data-qr]').forEach((el) => {
    if (!window.qrcode) { el.textContent = 'QR'; return; }
    const qr = window.qrcode(0, 'M');
    qr.addData(el.dataset.qr);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
    el.querySelector('svg').setAttribute('width', '88');
    el.querySelector('svg').setAttribute('height', '88');
  });
  app.querySelectorAll('[data-local]').forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.salvarLocal(form.dataset.local, {
        lat: form.lat.value, lng: form.lng.value, raio_m: form.raio_m.value,
        coordenadasVerificadas: form.coordenadasVerificadas.checked,
      });
      avisar('Local atualizado');
    } catch (err) { avisar(err.message); }
  }));
}

/** Carrega a biblioteca de QR code só quando a moderação abre */
function carregarBibliotecaQR() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = '/vendor/qrcode.js';
    s.onload = resolve;
    s.onerror = resolve; // sem internet: mostra só o texto "QR"
    document.head.append(s);
  });
}

// ---------------------------------------------------------------------------
// Push (avisos com o site fechado): inscreve este navegador no servidor
// ---------------------------------------------------------------------------
function pushSuportado() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function chaveParaBytes(base64Url) {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const bruto = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bruto, (c) => c.charCodeAt(0));
}

/** Liga o push neste aparelho. Devolve false se o servidor ou o navegador não permitirem. */
async function ativarPush() {
  if (!pushSuportado()) return false;
  const { ativo, chavePublica } = await api.pushChave().catch(() => ({}));
  if (!ativo || !chavePublica) return false;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) });
  await api.pushInscrever(sub.toJSON());
  return true;
}

async function desativarPush() {
  if (!pushSuportado()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api.pushCancelar(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// ---------------------------------------------------------------------------
// Avisos: compara o nível dos favoritos com a última verificação
// (funciona enquanto o app estiver aberto; veja o README para push no servidor)
// ---------------------------------------------------------------------------
async function verificarAvisos() {
  const u = estado.usuario;
  if (!u?.avisoFavorito || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    // Com push ligado, quem avisa é o servidor (evita notificação duplicada)
    const regPush = await navigator.serviceWorker?.ready;
    if (regPush && await regPush.pushManager?.getSubscription()) return;
    const locais = await carregarLocais();
    let anteriores = {};
    try { anteriores = JSON.parse(localStorage.getItem('armanaus_niveis') || '{}'); } catch { /* ignora */ }
    const reg = await navigator.serviceWorker?.ready;
    for (const l of locais.filter((x) => u.favoritos.includes(x.id))) {
      const antes = anteriores[l.id];
      if (antes && antes !== l.avaliacao.nivel && l.aberto) {
        const titulo = `${l.nome}: ${l.avaliacao.curto}`;
        const corpo = l.avaliacao.nivel < antes ? 'As condições melhoraram.' : 'As condições pioraram.';
        if (reg) reg.showNotification(titulo, { body: corpo, icon: '/icons/icon-192.png', data: { url: '/local/' + l.id } });
      }
      anteriores[l.id] = l.avaliacao.nivel;
    }
    localStorage.setItem('armanaus_niveis', JSON.stringify(anteriores));
  } catch { /* sem conexão: tenta na próxima */ }
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { estado.usuario = (await api.eu()).usuario; } catch { /* offline */ }
  // Mantém a inscrição de push em dia (só se o usuário já liberou as notificações)
  if (estado.usuario?.avisoFavorito && pushSuportado() && Notification.permission === 'granted') ativarPush().catch(() => {});
  await rotear();
  verificarAvisos();
  setInterval(verificarAvisos, 10 * 60000);
}
iniciar();
