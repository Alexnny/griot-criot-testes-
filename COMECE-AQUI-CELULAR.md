# Testar a API Criot dentro da Griot pelo telefone

Esta é uma cópia de teste do seu projeto. A tela original continua ligada ao
Gemini; o botão **Testar API Criot** abre um laboratório próprio com FastAPI,
SQLite e respostas simuladas, sem chave Gemini. Não ativa voz na API nova.

## Caminho pelo GitHub e Render

1. Baixe e extraia este ZIP usando o gerenciador de arquivos do Android.
2. Crie um repositório separado no GitHub para este teste. Envie **o conteúdo**
   da pasta `GRIOT-Criot-Testes`, preservando as subpastas `public` e `criot`.
   `Dockerfile`, `server.js`, `start.js` e `package.json` devem estar na raiz.
   Não envie somente o ZIP: o Render precisa dos arquivos extraídos.
3. No Render, crie **New → Web Service**, conecte o repositório de teste e
   selecione **Language: Docker** e **Instance Type: Free**.
4. Deixe Root Directory vazio se os arquivos estiverem na raiz. Dockerfile
   Path: `./Dockerfile`. Deixe Docker Command vazio para usar o comando do projeto.
   Esta variante precisa de Node e Python; use Docker, não o runtime Node antigo.
5. O Docker já configura `CRIOT_ENABLED=true` e `AI_PROVIDER=mock`. Não precisa
   de chave Gemini para os testes. Configure `SESSION_SECRET` com um valor
   aleatório privado de pelo menos 32 caracteres; não publique esse valor no GitHub.
6. Faça o deploy e espere aparecer **Live**. Abra a URL HTTPS que o Render fornecer.
7. Toque em **Testar API Criot** no topo. Ou acrescente `/laboratorio.html` à URL.
8. Toque em **Executar teste completo**. A página cria uma conversa, envia uma
   mensagem e consulta novamente o histórico. Três confirmações devem aparecer.
9. Atualize a página; a conversa deve ser recuperada enquanto os dados daquele
   serviço ainda existirem. Você também pode digitar mensagens e baixar o JSON.

Se usar a criação via Blueprint, o `render.yaml` faz a mesma configuração e
gera o segredo de sessão. Não é necessário criar dois serviços.

## O que você está testando

| Parte | Como funciona |
|---|---|
| Interface atual | Node.js e arquivos originais em `public` |
| Laboratório | `/laboratorio.html`, adaptado para telefone |
| API nova | FastAPI com um único worker, em porta interna 8001 |
| Banco novo | SQLite em `.data/criot.db` |
| Sessão | O Node identifica o usuário e encaminha seu ID ao Python |
| Isolamento | Cada usuário consulta somente suas conversas do laboratório |
| Respostas | `mock`: simulação explícita, sem chamada ao Gemini |
| Inicialização | `start.js` supervisiona Python e Node; falha de um encerra ambos |

O navegador usa `/api/criot/conversas`, `/api/criot/chat` e
`/api/criot/conversas/{id}/historico`. O Node encaminha para `/conversas`,
`/chat` e `/conversas/{id}/historico` no FastAPI privado. O Python aceita
`X-Criot-Owner` apenas porque fica atrás do Node em loopback: não exponha sua
porta diretamente, pois esse cabeçalho sozinho não é autenticação.

No computador, se iniciar a API Python separadamente para desenvolvimento,
o Swagger estará em `http://127.0.0.1:8001/docs`. No Render, use o laboratório;
o Swagger e a porta Python não são expostos publicamente.

## Limites que afetam este teste

**Render gratuito não mantém arquivos locais permanentemente.** O SQLite e o
armazenamento JSON original podem ser apagados ao redeploy, reinício ou suspensão.
Para histórico durável, uma próxima etapa deve usar armazenamento persistente
ou um banco externo. O banco PostgreSQL opcional do app antigo não salva as
conversas SQLite do laboratório. Use o botão de exportação para guardar o teste.

O modelo simulado apenas confirma o texto e conta os turnos. Não aprende, não
pesquisa e não substitui o raciocínio do Gemini. Para usar Ollama, é preciso um
servidor com modelo instalado e acessível; o Docker deste projeto não instala
nem baixa um modelo. `localhost` no Render se refere ao próprio Render.

Esta etapa não importa conversas antigas para o SQLite. A voz continua usando
a integração Gemini original. Para testá-la neste serviço separado, configure
suas variáveis Gemini pelo painel do Render; a chave não vai para o GitHub.
Os identificadores de modelos herdados do ZIP não foram validados no Google.

Não há uma IA nova treinada neste pacote: há uma API própria e um banco de
conversas, preparados para trocar o provedor de respostas posteriormente.

## Executar em ambiente de desenvolvimento

Requer Node 22 e Python 3.11+ (ou Docker):

```bash
npm ci
python3 -m venv .venv
.venv/bin/pip install -r criot/requirements-dev.txt
CRIOT_ENABLED=true AI_PROVIDER=mock PYTHON_BIN="$PWD/.venv/bin/python" npm start
```

Abra `http://localhost:3000/laboratorio.html`.

Testes:

```bash
npm test
cd criot
../.venv/bin/python -m pytest -q
```

O teste integrado adicional na pasta `integration` exige `PYTHON_BIN` apontando
para o ambiente com as dependências Python instaladas:

```bash
PYTHON_BIN="$PWD/.venv/bin/python" node --test integration/criot.test.js
```

Referências: https://render.com/docs/free e https://render.com/docs/docker
