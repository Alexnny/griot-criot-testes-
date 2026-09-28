# Análise e validação — Griot + Criot

## O ZIP recebido

- Servidor Node.js, interface HTML/CSS/JavaScript e integração Gemini textual/Live.
- Armazenamento original em JSON local, com PostgreSQL opcional via DATABASE_URL.
- Não havia arquivo .env nem chave Gemini real identificada nos arquivos textuais;
  havia configuração GEMINI_API_KEY e placeholder. A chave pode existir no Render,
  cujo ambiente não foi consultado neste trabalho.
- Modelos herdados: gemini-3.8-flash e gemini-3.8-live. Não validados com o Google.
- Os 18 testes existentes passaram com um servidor Gemini simulado.

## Alterações

- FastAPI + SQLAlchemy + SQLite adicionados em criot/.
- Histórico do laboratório separado das conversas originais, com owner_id e
  acesso filtrado por usuário. Cabeçalho de proprietário definido pelo Node.
- Laboratório para celular: criar conversa, enviar texto, ler histórico,
  executar teste completo e exportar JSON.
- Inicialização supervisionada Node + Python, usando uma única porta pública.
- Docker com instalação de dependências Node e Python; package-lock.json incluído.
- Blueprint de um serviço gratuito de testes, sem chave Gemini obrigatória.
- Nenhum deploy realizado e nenhuma chamada real ao Gemini/Ollama executada.

## Resultados executados neste ambiente

| Grupo | Resultado |
|---|---|
| Testes Node existentes, após integração | 18 aprovados |
| Testes FastAPI/SQLite e adaptador Ollama simulado | 6 aprovados |
| Teste integrado com processos Node e Python reais | 1 aprovado |
| Sintaxe dos novos scripts JavaScript | Aprovada |

O teste integrado cobre autenticação, criação de conversa, envio e recuperação
no SQLite, rejeição de prompt vazio, isolamento entre dois usuários (incluindo
cabeçalho de proprietário forjado), arquivos web, reinício de ambos os processos,
continuidade do histórico no mesmo disco e encerramento do Python pelo supervisor.

A persistência verificada é a do arquivo local entre processos. Não implica
persistência no Render gratuito, que elimina arquivos em reinícios/redeploys
ou suspensão. Ver https://render.com/docs/free.

## Limites da validação

- Não executei o build Docker: este ambiente não tem Docker instalado.
- Não publiquei nem testei o serviço no Render.
- Não executei um modelo Ollama, voz Gemini real ou teste em um telefone físico.
- A interface móvel foi preparada, e seus arquivos foram servidos no teste HTTP;
  não houve teste visual em navegador nesta validação.
- O laboratório usa simulação por padrão; salvar histórico não treina uma IA.
- O histórico original não foi migrado para SQLite.

O guia COMECE-AQUI-CELULAR.md contém os próximos passos para validar no seu Render.
