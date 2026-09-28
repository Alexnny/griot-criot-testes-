from datetime import datetime, timezone
from sqlalchemy import CheckConstraint, ForeignKey, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base

def utcnow():
    # SQLite guarda UTC sem informação de fuso; os schemas recolocam UTC no JSON.
    return datetime.now(timezone.utc).replace(tzinfo=None)

class Conversa(Base):
    __tablename__ = 'conversas'
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(100), default='local', index=True)
    titulo: Mapped[str] = mapped_column(String(200))
    data_criacao: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class Mensagem(Base):
    __tablename__ = 'mensagens'
    __table_args__ = (CheckConstraint("papel IN ('user', 'criot')"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    conversa_id: Mapped[int] = mapped_column(ForeignKey('conversas.id'), index=True)
    papel: Mapped[str] = mapped_column(String(5))
    conteudo: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
