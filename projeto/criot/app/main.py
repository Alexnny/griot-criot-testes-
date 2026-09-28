"""Execute com um worker: os bloqueios de conversa são locais ao processo."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from weakref import WeakValueDictionary
from fastapi import FastAPI, HTTPException, Header
from sqlalchemy import select
from . import config
from .ai import ProviderError, make_provider
from .database import Base, make_database
from .models import Conversa, Mensagem
from .schemas import ConversaEntrada, ConversaSaida, ChatEntrada, ChatSaida, MensagemSaida

def create_app(db_path=None, provider=None):
    engine, sessions = make_database(Path(db_path or config.DB_PATH))
    ai = provider if provider is not None else make_provider()
    # Serializa turnos da mesma conversa sem bloquear conversas diferentes.
    locks = WeakValueDictionary()

    @asynccontextmanager
    async def lifespan(app):
        Base.metadata.create_all(engine)
        yield
        engine.dispose()

    app = FastAPI(title='Criot API', version='1.0.0', lifespan=lifespan,
                  description='Etapa 1: chat textual e histórico persistente em SQLite.')

    @app.get('/health')
    def health():
        return {'status': 'ok', 'provedor': ai.name}

    @app.get('/conversas', response_model=list[ConversaSaida])
    def listar_conversas(x_criot_owner: str = Header(default='local')):
        with sessions() as db:
            rows = db.scalars(select(Conversa).where(Conversa.owner_id == x_criot_owner)
                              .order_by(Conversa.id.desc())).all()
            return [ConversaSaida.model_validate(row) for row in rows]

    @app.post('/conversas', response_model=ConversaSaida, status_code=201)
    def criar_conversa(body: ConversaEntrada, x_criot_owner: str = Header(default='local')):
        with sessions.begin() as db:
            conversa = Conversa(titulo=body.titulo, owner_id=x_criot_owner)
            db.add(conversa)
            db.flush()
            result = ConversaSaida.model_validate(conversa)
        return result

    @app.get('/conversas/{conversa_id}/historico', response_model=list[MensagemSaida])
    def historico(conversa_id: int, x_criot_owner: str = Header(default='local')):
        with sessions() as db:
            if db.scalar(select(Conversa).where(Conversa.id == conversa_id, Conversa.owner_id == x_criot_owner)) is None:
                raise HTTPException(404, 'Conversa não encontrada.')
            rows = db.scalars(select(Mensagem).where(Mensagem.conversa_id == conversa_id)
                              .order_by(Mensagem.id)).all()
            return [MensagemSaida.model_validate(row) for row in rows]

    @app.post('/chat', response_model=ChatSaida)
    async def chat(body: ChatEntrada, x_criot_owner: str = Header(default='local')):
        lock = locks.setdefault(body.conversa_id, asyncio.Lock())
        async with lock:
            # Fecha a leitura antes de esperar pela IA; não prende escrita do SQLite.
            with sessions() as db:
                if db.scalar(select(Conversa).where(Conversa.id == body.conversa_id, Conversa.owner_id == x_criot_owner)) is None:
                    raise HTTPException(404, 'Conversa não encontrada.')
                rows = db.scalars(select(Mensagem).where(Mensagem.conversa_id == body.conversa_id)
                                  .order_by(Mensagem.id)).all()
                history = [{'role': 'assistant' if m.papel == 'criot' else 'user',
                            'content': m.conteudo} for m in rows]
            history.append({'role': 'user', 'content': body.prompt})
            try:
                answer = await ai.responder(history)
            except ProviderError as exc:
                raise HTTPException(exc.status_code, str(exc)) from exc
            # Grava o par atomicamente: falha do modelo não deixa turno incompleto.
            with sessions.begin() as db:
                db.add(Mensagem(conversa_id=body.conversa_id, papel='user', conteudo=body.prompt))
                db.flush()
                message = Mensagem(conversa_id=body.conversa_id, papel='criot', conteudo=answer)
                db.add(message)
                db.flush()
                result = ChatSaida(conversa_id=body.conversa_id, resposta=answer,
                                   provedor=ai.name, mensagem=MensagemSaida.model_validate(message))
            return result

    return app

app = create_app()
