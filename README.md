# ArManaus

Protótipo funcional do projeto **ArManaus: sistema de alerta de qualidade do ar e conforto térmico para espaços de atividade ao ar livre em Manaus** (AP2 – Homem, Sociedade e Meio Ambiente, EST/UEA).

Equipe: Davih, Julia Cohen e Pedro.

O ArManaus é um site (PWA) que mostra, no mapa real de Manaus, quais parques estão bons para caminhar, correr ou pedalar agora, considerando fumaça (PM2,5 → IQAr) e calor (índice de calor), e indica o melhor horário do dia. Pode ser adicionado à tela inicial do celular.

---

## 1. Rodar no seu computador

Requisito: **Node.js 22.13 ou mais novo** (https://nodejs.org). Não precisa instalar banco de dados: o SQLite já vem dentro do Node.

```bash
npm install
npm start
```

Abra http://localhost:3000. Na primeira execução o banco (`data/armanaus.db`) é criado sozinho, com os 9 locais, as contas de teste e fotos de demonstração.

Para apagar tudo e recomeçar do zero, pare o servidor e apague a pasta `data/`.

Testes do índice: `npm test`.

## 2. Contas já criadas

Senha de todas: **ArManaus2026**

| E-mail | Perfil | Para testar |
|---|---|---|
| julia@armanaus.app | Moderadora | Aprovar/recusar fotos, editar coordenadas, ver QR codes |
| davih@armanaus.app | Moderador | Igual à Julia |
| pedro@armanaus.app | Moderador | Igual à Julia |
| ana@armanaus.app | Usuária (corrida, grupo sensível) | Favoritos, alertas mais rígidos, envio de foto |
| carlos@armanaus.app | Usuário (caminhada) | Visão de um usuário comum |

Na tela **Perfil** há botões que entram direto nessas contas.

Para testar o envio de foto, é preciso estar dentro do parque (o site confere o GPS). No computador, dá para simular: Chrome → F12 → menu ⋮ → *More tools* → *Sensors* → *Location* e digite, por exemplo, Mindu: `-3.0809`, `-60.0036`.

## 3. Publicar na internet (passo a passo)

> **Por que não o GitHub Pages?** O GitHub Pages só hospeda arquivos estáticos (HTML/CSS/JS). O ArManaus tem servidor, banco de dados, login e envio de fotos, então precisa de um serviço que rode Node.js. O caminho mais simples e gratuito é: **código no GitHub + site no Render**.

### 3.1 Subir o código para o GitHub

1. Crie uma conta em https://github.com (se ainda não tiver).
2. Clique em **New repository** → nome `armanaus` → *Public* → **Create repository** (sem README, já temos um).
3. No terminal, dentro da pasta do projeto:

```bash
git init
git add .
git commit -m "ArManaus: primeira versão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/armanaus.git
git push -u origin main
```

(O `.gitignore` já impede que `node_modules/` e o banco `data/` subam.)

Sem terminal: na página do repositório vazio, clique em **uploading an existing file** e arraste todos os arquivos e pastas, **menos** `node_modules` e `data`.

### 3.2 Publicar no Render

1. Entre em https://render.com e faça login com a conta do GitHub.
2. **New +** → **Blueprint** → escolha o repositório `armanaus` → **Apply**. O arquivo `render.yaml` já configura tudo (Node 22, `npm install`, `npm start`, plano gratuito).
   - Alternativa manual: **New +** → **Web Service** → repositório → Build command `npm install`, Start command `npm start`, Instance type *Free*, variável de ambiente `NODE_VERSION = 22.13.0`.
3. Aguarde o deploy (2 a 4 minutos). O endereço fica parecido com `https://armanaus.onrender.com`.
4. Abra no celular e use **Compartilhar → Adicionar à Tela de Início** (iPhone) ou **⋮ → Instalar app** (Android).

Cada `git push` na branch `main` publica uma nova versão automaticamente.

### 3.2.1 Notificações push (opcional)

Com o push ligado, quem tem favoritos e a opção "Favorito mudou de nível" recebe a notificação mesmo com o site fechado (o servidor confere a cada 10 minutos). Para ativar:

1. No computador, na pasta do projeto: `npm install` (instala o `web-push`; commite também o `package-lock.json` atualizado) e depois `npx web-push generate-vapid-keys`.
2. No Render, em **Environment**, cadastre `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY` com os valores gerados (guarde a chave privada; nunca a coloque no GitHub) e, se quiser, ajuste `VAPID_SUBJECT` para um e-mail seu (`mailto:...`).
3. Faça o deploy. Em `/api/saude`, o campo `push` deve ficar `true`.
4. No celular, instale o site na Tela de Início, entre na conta e ligue "Favorito mudou de nível" em Perfil. No iPhone, as notificações web só funcionam com o app instalado na Tela de Início.

Sem as chaves, o push fica desligado e o app continua avisando enquanto estiver aberto.

### 3.3 Limitações do plano gratuito (importante para a apresentação)

- O site **"dorme" após 15 minutos sem acesso**; o primeiro acesso depois disso demora uns 50 segundos. Abra o link alguns minutos antes de apresentar.
- O disco do plano gratuito é temporário: quando o servidor reinicia, o banco é recriado do zero (com as contas e os dados de demonstração). Fotos e contas novas criadas no site somem nesse momento.
- Para guardar os dados de verdade: no Render, use um plano pago com **Disk** (montado em `/var/data`) e defina a variável `DATA_DIR=/var/data`.

## 4. Como funciona

| Parte | Arquivo |
|---|---|
| Índice de recomendação (IQAr, índice de calor, níveis 1–4, melhor horário, correção de umidade) | `src/indice.js` |
| Banco de dados SQLite, tabelas e dados iniciais | `src/db.js` |
| Coleta de previsões (Open-Meteo/Copernicus) a cada 30 min | `src/clima.js` |
| Focos de queimada do INPE (resumo por local, a cada hora) | `src/queimadas.js` |
| PM2,5 medido pelos sensores do Qualiar-Ufam | `src/qualiar.js` |
| Notificações push (avisos com o site fechado) | `src/push.js` e `public/sw.js` |
| API e servidor web | `src/server.js` |
| Site (telas, mapa, envio de fotos) | `public/` |

**Dados:** previsões horárias de temperatura, umidade e PM2,5 da Open-Meteo (gratuita, sem chave). Se o servidor não conseguir acessá-la, o site entra em **modo demonstração** com números simulados e avisa isso na tela.

**Qualiar-Ufam (PM2,5 medido):** a cada 30 minutos o servidor lê o arquivo `qualiar.json` que o painel QUALIAR-UFAM (CCA e PCU, Ufam) publica a cada hora com os sensores PurpleAir de Manaus, já com a correção da EPA. Para cada parque vale o sensor válido mais próximo, até 5 km; sem sensor perto, vale a mediana da cidade. A ordem de prioridade da condição atual é: sensor próprio ArManaus (até 30 min), Qualiar-Ufam (até 3 h) e modelo Open-Meteo. Temperatura e umidade continuam vindo do Open-Meteo. A tela mostra a origem do dado. **Não é uma API oficial documentada**: é o arquivo de um projeto em versão BETA, então o endereço (`QUALIAR_URL`) ou o formato podem mudar; nesse caso o app volta ao modelo sozinho (veja `qualiar` em `/api/saude`). Peça autorização ao CCA/PCU e mantenha o crédito na tela.

**Queimadas (INPE):** a cada hora o servidor baixa os arquivos diários de focos de calor do Programa Queimadas (dados abertos, `focos_diario_br_AAAAMMDD.csv`), filtra os das últimas 24 h em volta de Manaus e resume por parque. Focos a **menos de 10 km** sobem o nível de alerta em 1 (máximo 4); focos entre 10 e 50 km aparecem só como informação no cartão "Focos de queimada" da página do local. Se o INPE estiver fora do ar, o app continua funcionando sem o agravante (resumo com mais de 3 h é ignorado). O endereço pode ser trocado com a variável de ambiente `INPE_FOCOS_URL`, e os raios ficam no topo de `src/queimadas.js`. Estado da última coleta em `GET /api/saude`.

**Mapa:** OpenStreetMap com o estilo da CARTO (Leaflet), com um botão para trocar para **imagens de satélite** da Esri (sem custo e sem chave; o crédito aparece no canto do mapa). Os pinos redondos são os parques, coloridos pelo nível de alerta. Os **losangos** são os sensores PurpleAir do Qualiar-Ufam, coloridos pela classe do PM2,5 (verde = boa, até roxo = péssima); tocar em um losango mostra o nome, o valor e há quanto tempo foi medido. Há um botão para ligar e desligar essa camada, e as duas escolhas ficam salvas no aparelho. Os dados dos sensores vêm de `GET /api/qualiar/sensores`.

**Sensores (Etapa 3):** cada estação ESP32 envia leituras para a API:

```bash
curl -X POST https://SEU-SITE/api/sensores/leitura \
  -H "Content-Type: application/json" \
  -H "X-Chave-Sensor: demo-mindu" \
  -d '{"pm25_bruto": 40, "temperatura": 31, "umidade": 75}'
```

O servidor aplica a correção de umidade (fórmula da EPA) e a leitura passa a valer para o local. Chaves de teste: `demo-ponta-negra`, `demo-bilhares`, `demo-mindu`, `demo-jefferson-peres`, `demo-sumauma`.

**Dados abertos:** `GET /api/dados/leituras.csv` (também em Perfil → Baixar dados abertos).

**Privacidade (LGPD):** a localização é usada só para conferir se a pessoa está no parque e não é salva com a foto; a foto é reduzida no celular, o que remove os metadados de GPS; as fotos passam por moderação e só ficam visíveis por 6 horas.

## 5. Limitações conhecidas do protótipo

- Coordenadas de Bosque da Ciência, Musa, Campus da Ufam e Lagoa do Japiim são aproximadas e precisam ser conferidas na visita de campo (editáveis na tela de Moderação).
- Notificações push exigem as chaves VAPID (seção 3.2.1); sem elas, os avisos só funcionam com o site aberto ou instalado e ativo.
- INMET ainda não está integrado: a API do INMET exige um token pedido por e-mail ao próprio INMET. Landsat não será usado ao vivo (passa a cada 8 a 16 dias e há muita nuvem); o uso previsto é uma análise única de vegetação e temperatura da superfície de cada parque. O agravante de queimadas ainda não considera a direção do vento.
- Fotos de demonstração são ilustrações geradas, não fotos reais.
