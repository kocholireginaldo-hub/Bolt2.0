# BOLT — Computador de bordo inteligente

BOLT é um **copiloto automotivo** que roda no navegador (HTML5, CSS3 e JavaScript moderno, sem frameworks e sem etapa de build). Ele lê dados do veículo por **OBD2 (somente leitura)**, mostra um painel de instrumentos, registra viagens, interpreta falhas (DTC), acompanha a manutenção e conversa por texto e voz por meio de um assistente com mascote próprio.

Também inclui um **Laboratório** (simulador completo) para testar tudo sem carro, sempre identificado como **SIMULAÇÃO**.

> **Estado de validação (leia antes de usar no carro):** a lógica (protocolo ELM327/SAE J1979, reconexão, motor de dados, simulador, alertas, diagnóstico, manutenção, viagens, backup, IA/privacidade, servidor e ponte Wi-Fi) é coberta por testes automatizados com adaptadores **emulados**, e a interface foi verificada em navegador. **O app ainda não foi testado com adaptadores OBD2 reais, com chaves reais de IA nem em um veículo.** Valide primeiro com o Laboratório e, depois, com o carro parado.

---

## Sumário

1. [O que o BOLT faz](#1-o-que-o-bolt-faz)
2. [Como executar](#2-como-executar)
3. [O que funciona sem backend e o que precisa dele](#3-o-que-funciona-sem-backend-e-o-que-precisa-dele)
4. [Configuração](#4-configuração)
5. [Variáveis de ambiente](#5-variáveis-de-ambiente)
6. [Configurando a IA](#6-configurando-a-ia)
7. [Adaptadores OBD2 suportados](#7-adaptadores-obd2-suportados)
8. [Permissões do navegador](#8-permissões-do-navegador)
9. [Limitações dos navegadores](#9-limitações-dos-navegadores)
10. [Publicando no GitHub](#10-publicando-no-github)
11. [Privacidade e segurança](#11-privacidade-e-segurança)
12. [Estrutura dos arquivos](#12-estrutura-dos-arquivos)
13. [Testes](#13-testes)
14. [Ponte nativa (app Android/iOS futuro)](#14-ponte-nativa-app-androidios-futuro)

---

## 1. O que o BOLT faz

| Módulo | Resumo |
| --- | --- |
| **Painel** | Cockpit **BOLT PERFORMANCE**: velocímetro e conta-giros esportivos, palco central para a imagem do veículo, temperatura, ar de admissão, carga, bateria, combustível, consumo **estimado**, viagem atual, estado do OBD2, internet, alertas e assistente. Cada valor mostra se está válido, desatualizado, inválido ou indisponível — nunca inventa dados. |
| **Garagem** | Vários veículos, dados técnicos separados da aparência (silhueta e cor), limites de alerta por veículo, histórico e quilometragem. |
| **Viagens** | Gravação automática ou manual, distância, tempo, velocidade, consumo estimado e rota (GPS opcional). Exportação em GPX/CSV. |
| **Diagnóstico** | Leitura de códigos atuais, pendentes e permanentes, freeze frame, monitores de prontidão e histórico com reincidência. A limpeza de códigos exige confirmação e **registra os dados antes** de apagar. |
| **Manutenção** | Agenda por km e/ou meses, serviços realizados, custos, indicador de nível (ok/atenção/crítico). |
| **Assistente** | Janela flutuante (expansível para tela cheia), texto e voz, personalidades *amigável / profissional / divertida*, controles independentes de assistente, microfone e voz, modo de escuta contínua por nome. Sem IA ou sem internet, responde localmente com os dados que existem. |
| **Laboratório** | Simulador com marchas, torque, carga, temperatura, bateria, combustível, cenários, injeção de falhas e perda de enlace/internet. Usa o mesmo contrato de dados do OBD2 real. |
| **Configurações** | Tema (escuro/claro/automático), cor de destaque, orientação (automática/horizontal/vertical), assistente, IA e privacidade, OBD2, alertas, manutenção, segurança em movimento, backup/restauração. |

Princípios: OBD2 **somente leitura** (sem programar ECU, sem comandos não documentados); alertas locais **independentes** de IA e internet; dados reais e simulados **nunca se misturam**.

## 2. Como executar

### Opção A — com o servidor incluído (recomendada)

Requer [Node.js 18+](https://nodejs.org). Não há dependências para instalar.

```bash
node server.js
# abra http://localhost:8787
```

Opcionalmente copie `.env.example` para `.env` e preencha (veja a seção 5). Também funcionam `npm start` e `npm test`.

### Opção B — somente arquivos estáticos

Qualquer servidor estático serve (ex.: `python3 -m http.server 8000` dentro da pasta) ou hospedagem como GitHub Pages. **Não abra `index.html` com duplo clique (`file://`)**: módulos ES, Service Worker, Web Bluetooth e IndexedDB exigem `http://localhost` ou HTTPS.

Neste modo valem as limitações da seção 3.

### Instalar como app (PWA)

Em HTTPS ou localhost, o navegador oferece "Instalar app". Depois da primeira visita o app abre offline.

## 3. O que funciona sem backend e o que precisa dele

| Recurso | Só `index.html` (estático) | Precisa do backend (`server.js`) |
| --- | :---: | :---: |
| Painel, Garagem, Viagens, Manutenção, Configurações, backup | ✅ | — |
| Laboratório/simulador, alertas locais, assistente **local** | ✅ | — |
| OBD2 por **Bluetooth LE** (Web Bluetooth; Chrome/Edge, HTTPS ou localhost) | ✅ | — |
| Voz (texto→fala e fala→texto) | ✅ (depende do navegador) | — |
| PWA offline | ✅ (HTTPS/localhost) | — |
| **Assistente com IA** (perguntas livres) | ❌ | ✅ — a chave fica no servidor |
| OBD2 por **Wi-Fi (ELM327 TCP)** | ❌ | ✅ — navegadores não abrem sockets TCP; a ponte `/api/obd/wifi/*` faz isso |
| OBD2 por **Bluetooth clássico (SPP)** | ❌ | ❌ — exige app nativo (seção 14) |

O BOLT **não finge** que essas funções funcionam sem backend: quando ele não existe, o app informa o motivo e continua com o que é possível (por exemplo, o assistente responde com dados locais).

## 4. Configuração

Tudo é salvo automaticamente no próprio dispositivo (IndexedDB). Abra a engrenagem no cabeçalho.

- **Motorista**: nome opcional (nunca enviado à IA).
- **Aparência**: tema e cor de destaque.
- **Tela e navegação**: orientação automática/horizontal/vertical, barra inferior recolhível, unidade de consumo (km/L ou L/100 km), escala do velocímetro.
- **Assistente**: ligar/desligar, nome (também é a palavra de ativação), personalidade, nível de comunicação, voz (voz, velocidade, tom, volume), microfone e modo de escuta (toque para falar ou contínuo por nome). Assistente, microfone e voz são controlados **de forma independente**. Desligar o assistente **não** desliga o monitoramento nem os alertas.
- **IA e privacidade**: URL do backend, teste de conexão e quatro opções do que pode ser enviado, com o botão **"Ver exatamente o que é enviado"**.
- **OBD2**: adaptador preferido, parâmetros Wi-Fi, reconexão automática.
- **Segurança ao dirigir**: bloqueia formulários e configurações acima de uma velocidade (padrão 8 km/h). A voz continua disponível.
- **Dados e backup**: exportar/restaurar (mesclar ou substituir) e apagar tudo. O backup **não inclui** o token da ponte Wi-Fi.

Cadastre o veículo na **Garagem** (cilindrada, combustível, rotação máxima, tanque). Esses dados definem limites de alerta e a estimativa de consumo. Os limites sugeridos são apenas ponto de partida — ajuste conforme o manual do veículo.

## 5. Variáveis de ambiente

Lidas **somente por `server.js`** (nunca chegam ao navegador). Veja `.env.example`.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `8787` | Porta HTTP. |
| `HOST` | `127.0.0.1` | Endereço de escuta. Use `0.0.0.0` para acessar de outro aparelho da rede. |
| `AI_PROVIDER` | `anthropic` | `anthropic` ou `openai` (qualquer API compatível com `/chat/completions`). |
| `AI_API_KEY` | — | Chave do provedor. **Sem ela o assistente usa só respostas locais.** |
| `AI_MODEL` | `claude-haiku-5-5` (anthropic) | Obrigatório para `openai`. |
| `AI_BASE_URL` | oficial do provedor | Para provedores compatíveis/locais, ex.: `http://localhost:11434/v1`. |
| `AI_RATE_LIMIT_PER_MIN` | `20` | Limite de perguntas por IP por minuto. |
| `ALLOWED_ORIGINS` | vazio | Origens autorizadas por CORS (app estático em outro domínio). |
| `ENABLE_WIFI_BRIDGE` | `1` | `0` desliga a ponte Wi-Fi. |
| `BRIDGE_TOKEN` | — | Token Bearer da ponte. **Obrigatório** quando `HOST` não é localhost; a ponte não liga sem ele. |

## 6. Configurando a IA

1. Obtenha uma chave no provedor escolhido.
2. Defina no servidor (arquivo `.env` local **ou** variáveis do provedor de hospedagem):
   ```env
   AI_PROVIDER=anthropic
   AI_API_KEY=cole-sua-chave-aqui
   ```
   Para outro provedor compatível: `AI_PROVIDER=openai`, `AI_MODEL=...`, `AI_BASE_URL=...`.
3. Inicie `node server.js` — o console informa se a IA está ativa.
4. No app: **Configurações → IA e privacidade → Testar conexão**. Se o app estiver em outro domínio, preencha **URL do backend** e adicione esse domínio em `ALLOWED_ORIGINS`.

O servidor monta um *prompt* com regras de segurança (usar só os dados do contexto, avisar quando algo é indisponível, tratar consumo como estimativa, não incentivar apagar códigos sem registrar, etc.). Perguntas sem internet/IA caem automaticamente para o modo local, e a resposta é rotulada como "Resposta local".

## 7. Adaptadores OBD2 suportados

Protocolo: **ELM327** (AT/OBD), SAE J1979 — modos 01, 02, 03, 07, 09, 0A em leitura; modo 04 (limpar códigos) apenas com confirmação explícita. Não há escrita/codificação de ECU.

| Tipo | Como conecta | Observações |
| --- | --- | --- |
| **ELM327 Bluetooth LE** | Web Bluetooth | Reconhece os perfis comuns de serviço (`FFF0`, `FFE0`, `18F0`). Chrome/Edge (Android, Windows, macOS, Linux, ChromeOS). **Não funciona** em Safari/iOS nem Firefox. |
| **ELM327 Wi-Fi** | Ponte do `server.js` (HTTP + SSE → TCP) ou endpoint WebSocket | Padrão típico do adaptador: `192.168.0.10:35000`. O dispositivo que roda `server.js` precisa estar na rede Wi-Fi do adaptador. A ponte aceita **apenas IPs de rede privada**. |
| **ELM327 Bluetooth clássico (SPP)** | Ponte nativa `window.BoltNative` | Exige app Android (WebView/Capacitor). Navegadores não oferecem SPP. |

Clones ELM327 baratos variam muito em qualidade; o app tolera respostas lentas e lida com timeouts/reconexão, mas **não foi testado com adaptadores reais**.

## 8. Permissões do navegador

Nenhuma permissão é pedida ao abrir o app. Cada uma só aparece quando você usa o recurso:

- **Bluetooth** — ao tocar em *Conectar* com o adaptador BLE.
- **Microfone** — ao tocar para falar ou ligar a escuta contínua.
- **Localização** — somente se você ativar GPS nas viagens.
- **Notificações/sons** — alertas sonoros usam Web Audio (sem permissão), exigem um toque prévio na página em alguns navegadores.

## 9. Limitações dos navegadores

- **HTTPS ou localhost** são obrigatórios para Web Bluetooth, Service Worker e microfone.
- **Web Bluetooth**: Chrome/Edge apenas; exige gesto do usuário a cada nova seleção do adaptador.
- **Reconhecimento de voz (Web Speech API)**: no Chrome usa serviço online do navegador e pode não estar disponível em todos os navegadores; a escuta contínua por nome é **experimental**, consome bateria e pode ser interrompida pelo sistema. O modo "toque para falar" é o mais confiável.
- **Síntese de voz**: as vozes disponíveis dependem do sistema; sem voz em português, usa a padrão.
- **Segundo plano**: navegadores suspendem páginas em segundo plano; para monitorar de forma contínua mantenha o app aberto e a tela ligada (o BOLT não impede o bloqueio da tela).
- **Travar orientação**: só é possível em alguns navegadores (geralmente em tela cheia/PWA instalado); por isso o BOLT também reorganiza o layout.
- **Armazenamento**: em navegação privada o armazenamento pode ser temporário; o app avisa e oferece exportar backup.
- **Consumo de combustível** é sempre **estimado** (a partir de MAF, taxa informada pela ECU ou carga do motor) e é rotulado assim.

## 10. Publicando no GitHub

1. Crie um repositório e envie **todos os arquivos da raiz** (o projeto não usa subpastas):
   ```bash
   git init && git add . && git commit -m "BOLT 1.0"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/bolt.git
   git push -u origin main
   ```
   O `.gitignore` já impede o envio de `.env`, logs e ZIPs.
2. **GitHub Pages** (recursos estáticos): *Settings → Pages → Deploy from a branch → `main` / root*. O arquivo `.nojekyll` já está incluído. O app ficará em `https://SEU_USUARIO.github.io/bolt/` com HTTPS (Bluetooth LE e PWA funcionam).
3. **Backend** (IA e ponte Wi-Fi) **não roda no GitHub Pages**. Hospede `server.js` em um serviço com Node (Render, Railway, Fly.io, VPS…) ou use o `Dockerfile`. Configure as variáveis de ambiente **no painel do serviço**, nunca no repositório. No app, preencha *URL do backend* e inclua `https://SEU_USUARIO.github.io` em `ALLOWED_ORIGINS`.
4. **Ponte Wi-Fi com Pages**: uma página HTTPS não pode chamar uma ponte `http://` local (bloqueio de conteúdo misto). Para Wi-Fi, rode o app **pelo próprio `server.js`** na rede local (`http://IP:8787`) ou use um endpoint WebSocket `wss://`.
5. **Nunca** faça *commit* de `.env`, chaves ou tokens. Se uma chave vazar, revogue-a no provedor.

Docker (opcional):
```bash
docker build -t bolt .
docker run -p 8787:8787 -e AI_API_KEY=... -e BRIDGE_TOKEN=... bolt
```

## 11. Privacidade e segurança

- Tudo (veículos, viagens, falhas, manutenção, conversas e configurações) fica **somente neste dispositivo**.
- **Chaves de API nunca ficam no navegador**; só o servidor as lê.
- Ao usar IA, é enviado apenas o contexto que você permitir (perfil do veículo, dados ao vivo, DTCs, manutenção) mais sua pergunta. **Placa, VIN, nome, localização e histórico de viagens jamais são enviados.** O botão *Ver exatamente o que é enviado* mostra o conteúdo real.
- O servidor só entrega arquivos públicos da raiz (nunca `server.js`, `.env` ou testes), limita corpo e taxa de requisições, e a ponte Wi-Fi só alcança IPs de rede privada, exige token fora de localhost e aceita apenas texto ASCII curto.
- OBD2 é somente leitura. Limpar códigos exige confirmação digitada e salva um registro antes.
- Com o veículo em movimento, telas complexas ficam bloqueadas (configurável).
- O app é uma **ferramenta de apoio**: não substitui o painel original, a oficina nem o manual do veículo. Não interaja com a tela dirigindo.

## 12. Estrutura dos arquivos

Todos os arquivos ficam na raiz (sem subpastas).

- **Cockpit (tela Painel)**: `cockpit.css`, `cockpit-gauge.js`, `cockpit-stage.js`, `vehicle-catalog.js`, `view-dashboard.js` e as imagens dos veículos (`saveiro_prata.png` etc.)
- **Entrada**: `index.html`, `styles.css`, `app.js`, `manifest.json`, `service-worker.js`
- **Núcleo**: `config.js`, `utils.js`, `events.js`, `platform.js`, `database.js`, `settings.js`, `vehicle-engine.js`, `data-source.js`, `connectivity.js`
- **OBD2**: `obd-protocol.js`, `obd-transport.js`, `obd-ble.js`, `obd-wifi.js`, `obd-native.js`, `obd-manager.js`
- **Domínio**: `alerts.js`, `garage.js`, `trips.js`, `geo.js`, `maintenance.js`, `diagnostics.js`, `dtc-database.js`, `vehicle-simulator.js`
- **Assistente**: `assistant.js`, `assistant-local.js`, `ai-service.js`, `voice.js`
- **Interface**: `ui.js`, `icons.js`, `mascot.js`, `silhouettes.js`, `gauge.js`, `view-*.js`, `obd-dialog.js`
- **Servidor**: `server.js`
- **Testes e ferramentas**: `tests.mjs`, `tests-server.mjs`, `build-assets.mjs`
- **Ícones/marca**: `favicon.svg`, `bolt-*.svg`, `icon-*.svg`, `icon-*.png`, `apple-touch-icon.png`
- **Projeto**: `package.json`, `README.md`, `.env.example`, `.gitignore`, `.nojekyll`, `Dockerfile`, `.dockerignore`

### Cockpit: imagens dos veículos

O palco central do Painel exibe a imagem real do veículo ativo. **Todas as imagens ficam diretamente na raiz do projeto** (ao lado de `index.html`; nada de subpastas), preferencialmente **PNG com fundo transparente** (WebP também funciona se você trocar a extensão no catálogo).

Nomes esperados (24 arquivos): `saveiro_{prata,branco,preto,vermelho}.png` · `renegade_`, `civic2010_`, `ecosport2006_`, `jetta_` + `{prata,branco,preto,vermelho,azul}.png`. Sugestão de tamanho: ~1600 px de largura, proporção horizontal, carro de lado/3-4 frontal com pequena margem.

- O catálogo único está em `vehicle-catalog.js` (`BOLT_VEHICLE_IMAGES`: id → nome + cor → arquivo).
- O veículo da Garagem é reconhecido por marca/modelo (Civic só com ano 2010 e EcoSport só com 2006, como no catálogo; Saveiro, Renegade e Jetta aceitam qualquer ano — o ano continua sendo o do cadastro).
- A cor vem da escolha feita nas bolinhas do palco (salva por veículo) ou, se não houver, da cor de aparência do cadastro (vermelho/azul/branco/preto/prata reconhecidos; senão prata).
- Imagem ausente: o palco mostra só o nome do veículo e o arquivo esperado, sem ícone quebrado. O navegador pode registrar um 404 no console para o arquivo ausente; é inofensivo.
- **Novo veículo ou cor:** adicione a entrada em `BOLT_VEHICLE_IMAGES` e a regra correspondente em `BOLT_VEHICLE_MATCH`, e coloque o PNG na raiz. Para uma nova cor, inclua também o rótulo/amostra em `BOLT_COLOR_SWATCHES`.
- Depois de trocar uma imagem, recarregue a página (o app offline atualiza os arquivos em segundo plano).
- A faixa vermelha do conta-giros só aparece quando a **rotação máxima (linha vermelha)** estiver informada no cadastro do veículo.

## 13. Testes

```bash
npm test      # ou: node tests.mjs
```

Cobrem protocolo OBD2 (decodificação de PID/DTC, lista de comandos permitidos, montagem de quadros), sessão e reconexão, isolamento entre dados reais e simulados, simulador, alertas com histerese, diagnóstico e fluxo de limpeza, manutenção, viagens, garagem, backup, privacidade da IA, assistente, e o servidor (arquivos estáticos, *path traversal*, proxy de IA com provedor simulado, CORS, limite de taxa e ponte Wi-Fi com um adaptador TCP falso). Os testes **não** usam rede externa nem chaves reais.

## 14. Ponte nativa (app Android/iOS futuro)

Um app nativo (WebView, Capacitor, Tauri) pode injetar `window.BoltNative` e habilitar Bluetooth clássico (SPP):

```js
BoltNative.capabilities           // { bluetoothClassic, bluetoothLE, gps, microphone }
BoltNative.listDevices(mode)      // Promise<[{ name, address }]>   mode: 'spp' | 'ble' | 'usb' | 'wifi'
BoltNative.connect(mode, address) // Promise<void>
BoltNative.write(text)            // Promise<void>
BoltNative.disconnect()           // Promise<void>
BoltNative.setListener({ onData(text), onClose(reason) })
```

Sem essa ponte, os adaptadores *SPP* e *Ponte nativa* aparecem como indisponíveis — nada é simulado.
