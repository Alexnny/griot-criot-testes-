# Griot — protótipo integrado

Este pacote combina a interface do arquivo `Nova-AI-Prototipo.zip` enviado por Igor com o backend Griot existente, mantendo as rotas de conversas, preferências, memória e token temporário do Gemini Live.

## O que está incluído

- Interface responsiva do protótipo: barra lateral, histórico, novo chat, campo de texto, ditado e botão separado para Live Voice.
- Chat conectado à rota `/api/chat`, com transição de digitação na exibição da resposta.
- Anexos de imagem, PDF e texto (até dois arquivos de 2 MB por mensagem), enviados ao backend.
- Tela Live separada com orb CSS continuamente animado, intensidade visual vinculada à amplitude do áudio reproduzido e transcrição com desvanecimento do texto anterior.
- Seletor visual de vozes Kore e Aoede (femininas), Puck, Charon e Fenrir (masculinas). Se a voz for alterada durante uma sessão Live, a sessão é reconectada com a nova voz.
- Memórias explícitas, histórico de conversas e introdução pessoal do criador, Igor, 23 anos.

- Atalhos opcionais para YouTube, WhatsApp, Maps, Spotify e Gmail, com consentimento revogável e confirmação individual antes de abrir. Em navegadores Android, os links podem abrir o app instalado ou a versão web. **Não há controle irrestrito do telefone**, instalação de aplicativos ou permissão de acessibilidade.

## Implantação no Render existente

O arquivo ZIP de publicação deve ficar na **raiz do repositório GitHub**, com o nome `nova-live-web-deploy.zip`, e conter a pasta interna `nova-live-web/`. O serviço Render existente usa:

- Build: `unzip -q -o nova-live-web-deploy.zip -d . && test -f nova-live-web/package.json && echo 'NOVA Live source extracted'`
- Start: `cd nova-live-web && npm start`

Substitua o ZIP antigo no GitHub e confirme o commit. Com Auto Deploy habilitado, o Render deverá criar um novo deploy. Não é necessário modificar a chave `GEMINI_API_KEY` ou os demais parâmetros existentes.

**Segurança:** nunca publique `.env`, `.data/`, `.session-secret` ou `node_modules`.

## Testes e limites

Execute `npm test` dentro de `nova-live-web/`. Os testes do backend usam simulações da API do Gemini; uma chamada de voz real deve ser validada no navegador após a publicação. A memória também é armazenada no navegador, mas o armazenamento do servidor em arquivo local não é permanente no Render gratuito. Para sincronização confiável entre dispositivos, use banco de dados persistente e autenticação própria.

O protótipo é HTML/CSS/JavaScript puro. O orb visual existente não exige React nem Three.js. A funcionalidade Live continua dependente da API do Gemini e da disponibilidade do modelo configurado no seu projeto Google.


## Pesquisa pública sem Gemini
O chat muda automaticamente para pesquisa na Wikipédia se o endpoint Gemini de texto retornar cota excedida (429), ou pode ser alternado no menu. São resultados documentais com links, não respostas geradas por IA. Não pesquisa toda a internet. A Live API permanece separada.

## Limites Android e abertura de apps
O site tenta Android intents para apps conhecidos, mas o navegador pode bloquear intents disparados após transcrição assíncrona. A opção de autorização do site não é uma permissão do Android. Para garantir abrir apps por voz e Live contínuo com a tela bloqueada ou em segundo plano, será necessário criar um aplicativo Android nativo com Foreground Service do tipo microphone, permissão RECORD_AUDIO, notificação persistente e integração de intents Android. Este ZIP é a versão web; não promete esses recursos nativos.

## Interrupção
O cliente corta a fila de áudio imediatamente ao receber `serverContent.interrupted`, e tem detecção local conservadora de fala sustentada para reduzir latência. Testar com alto-falante e fone no aparelho real; ruído e eco podem produzir falsos positivos.


## Versão: busca multissite, interrupção e persistência

- Pesquisa pública: tenta consultar Bing RSS (sites variados) e Wikipédia em paralelo, organiza fontes separadamente. Se Bing bloquear a requisição, poderá retornar apenas Wikipédia. Não é um modelo generativo; cumprimentos simples têm respostas locais. Para conversa aberta quando a cota Gemini acaba, configure outro modelo/provedor em uma próxima integração.
- Live Voice: corte local de áudio mais rápido, ignora áudio antigo durante a interrupção, e recupera trechos recentes de chats e transcrições salvos. A eficácia do VAD depende de microfone, eco e modelo; teste no Android.
- Persistência real no Render: crie um PostgreSQL externo ou Render Postgres, configure `DATABASE_URL` e um `SESSION_SECRET` estável nas variáveis de ambiente. O pacote usa `pg` instalado via npm. Sem essas variáveis, o plano Free pode perder os dados em reinícios. O histórico já perdido no disco efêmero não pode ser recuperado automaticamente. Não armazene a senha do banco no GitHub.
- A opção **Exportar histórico e memórias** gera backup JSON do usuário autenticado. Não garante transcrições de áudio que o Gemini não tenha fornecido.
- Render Build Command: `unzip -q -o nova-live-web-deploy.zip -d . && cd nova-live-web && npm install --omit=dev`
- Render Start Command: `cd nova-live-web && npm start`
- Se o ZIP no GitHub tiver outro nome, adapte o nome no Build Command.
