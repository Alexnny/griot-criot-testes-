# Criot — Backend, etapa 1

API textual em Python 3.11+ com FastAPI, SQLAlchemy e SQLite. Inclui código
comentado, documentação Swagger, modo simulado e adaptador Ollama.
Não exige chave de API. O modo mock apenas simula; não é um modelo inteligente.

## Estrutura

```text
Criot-Backend/
  app/
    __init__.py
    config.py       # .env e variáveis de ambiente
    database.py     # engine e sessões SQLAlchemy
    models.py       # tabelas conversas e mensagens
    schemas.py      # validação e respostas JSON
    ai.py           # mock e Ollama, ponto de extensão
    main.py         # aplicação e endpoints
  tests/test_api.py
  .env.example
  .gitignore
  requirements.txt
  requirements-dev.txt
  README.md
  data/criot.db     # criado automaticamente ao executar
```

## Instalar e iniciar

Extraia o ZIP. Abra um terminal dentro de `Criot-Backend` e execute:

```bash
python -m venv .venv
```

Ative o ambiente no Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

Ou no Linux/macOS:

```bash
source .venv/bin/activate
```

Depois, em qualquer sistema:

```bash
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Abra http://127.0.0.1:8000/docs no navegador da máquina que executa o servidor.
Sem `.env`, já funciona em modo simulado. Não precisa criar o banco manualmente.
O Swagger permite testar cada endpoint usando **Try it out** e **Execute**.

## Testar pelo Swagger

1. Execute `POST /conversas` com:

```json
{"titulo": "Minha primeira conversa"}
```

2. Copie o `id` retornado e use como `conversa_id` em `POST /chat`:

```json
{"conversa_id": 1, "prompt": "Olá, Criot! Meu nome é Igor."}
```

3. Execute `GET /conversas/1/historico` usando o ID verdadeiro da conversa.
Repita o chat com o mesmo ID para continuar. Reiniciar preserva o histórico.

O retorno do chat contém `conversa_id`, `resposta`, `provedor` e `mensagem`
(com ID, papel `criot`, conteúdo e timestamp UTC). No banco, cada turno inclui
uma mensagem `user` e outra `criot`. Para Ollama, `criot` vira `assistant`.

| Endpoint | Resultado |
|---|---|
| POST /conversas | 201, sessão criada |
| POST /chat | 200, resposta e mensagens salvas |
| GET /conversas/{id}/historico | 200, histórico em ordem de inserção |
| GET /health | Processo ativo e provedor configurado; não testa Ollama |

Conversa ausente: 404. Entrada vazia ou inválida: 422. Erro do Ollama: 502,
503 ou 504. Se a IA falhar, nenhuma das duas mensagens daquele turno é gravada;
o histórico anterior permanece. O cliente pode reenviar o prompt.

## Ativar respostas reais com Ollama

Instale o Ollama em https://ollama.com/download em um computador compatível.
Baixe um modelo local (exemplo):

```bash
ollama pull llama3.2:3b
```

Mantenha o Ollama executando. Se o serviço não estiver iniciado, rode
`ollama serve` em outro terminal. Copie `.env.example` para `.env`, altere
`AI_PROVIDER=ollama` e reinicie o FastAPI. O modelo configurado em
`OLLAMA_MODEL` precisa estar instalado. Hardware e tamanho do contexto
determinam a velocidade e o consumo de memória.

O adaptador envia o histórico via `POST /api/chat`, com `stream=false`.
Documentação oficial: https://docs.ollama.com/api/chat
Referência FastAPI/SQLite: https://fastapi.tiangolo.com/tutorial/sql-databases/

Para adicionar Google AI Studio no futuro, crie outro provedor com `name`
e `async responder(historico) -> str`, registre em `make_provider()` e mantenha
credenciais no ambiente. Essa integração futura não está implementada.

## Escopo e limites desta etapa

- Salvar e reenviar histórico é memória de conversa, não treinamento automático.
- Não inclui voz ao vivo, transcrição, síntese, pesquisa na internet ou frontend.
- SQLite é gratuito; Ollama local não cobra por tokens, mas exige computador,
  armazenamento, memória e energia. O mock funciona sem Ollama.
- API local para um usuário, sem autenticação ou separação por contas.
  Não publique diretamente na internet como serviço multiusuário.
- Use um único processo/worker. Turnos simultâneos da mesma conversa são
  serializados dentro do processo; múltiplos workers exigem coordenação externa.
- Todo o histórico é enviado; conversas muito longas podem ultrapassar o contexto
  do modelo. Resumo/truncamento deve ser implementado numa próxima etapa.
- Não há idempotência: reenviar após perder a resposta pode duplicar um turno.
- O banco está em `data/criot.db`. Em hospedagem, é necessário armazenamento
  persistente; um disco temporário não garante o histórico após reinícios.
  Um Ollama no seu computador não estará em `localhost` de um servidor remoto.
- Faça backup com o servidor parado, preservando a pasta `data` completa.

## Testes

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Testes usam SQLite temporário: persistência após reinício, validação, 404,
ordem dos turnos concorrentes, ausência de gravação parcial e contrato/erros
do adaptador Ollama por HTTP simulado. Não baixam nem executam um modelo real.
