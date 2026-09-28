from datetime import datetime, timezone
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Titulo = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Prompt = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16000)]

class ConversaEntrada(BaseModel):
    titulo: Titulo = 'Nova conversa'

class ChatEntrada(BaseModel):
    conversa_id: int = Field(gt=0)
    prompt: Prompt

class Saida(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_validator('data_criacao', 'timestamp', check_fields=False)
    @classmethod
    def add_utc(cls, value):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

class ConversaSaida(Saida):
    id: int
    titulo: str
    data_criacao: datetime

class MensagemSaida(Saida):
    id: int
    conversa_id: int
    papel: Literal['user', 'criot']
    conteudo: str
    timestamp: datetime

class ChatSaida(BaseModel):
    conversa_id: int
    resposta: str
    provedor: str
    mensagem: MensagemSaida
