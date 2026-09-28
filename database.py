"""SQLite persistente com chaves estrangeiras habilitadas."""
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

def make_database(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(URL.create('sqlite', database=str(path)),
                           connect_args={'check_same_thread': False, 'timeout': 30})

    @event.listens_for(engine, 'connect')
    def configure_sqlite(connection, _):
        cursor = connection.cursor()
        cursor.execute('PRAGMA foreign_keys=ON')
        cursor.execute('PRAGMA journal_mode=WAL')
        cursor.close()

    return engine, sessionmaker(bind=engine, expire_on_commit=False)
