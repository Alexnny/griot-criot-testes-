"""Configuração local; variáveis de ambiente têm prioridade sobre .env."""
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / '.env')
DB_PATH = Path(os.getenv('CRIOT_DB_PATH', str(ROOT / 'data' / 'criot.db')))
PROVIDER = os.getenv('AI_PROVIDER', 'mock').lower()
OLLAMA_URL = os.getenv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434').rstrip('/')
OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'llama3.2:3b')
OLLAMA_TIMEOUT = float(os.getenv('OLLAMA_TIMEOUT', '120'))
