"""Adaptadores substituíveis: cada provedor implementa responder(historico)."""
import httpx
from . import config

class ProviderError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.status_code = status_code

class MockProvider:
    name = 'mock'

    async def responder(self, historico):
        turnos = sum(m['role'] == 'user' for m in historico)
        return (f'[SIMULAÇÃO — sem modelo de IA] Recebi: {historico[-1]["content"]}. '
                f'Esta é sua mensagem número {turnos} nesta conversa.')

class OllamaProvider:
    name = 'ollama'

    async def responder(self, historico):
        try:
            async with httpx.AsyncClient(timeout=config.OLLAMA_TIMEOUT) as client:
                response = await client.post(config.OLLAMA_URL + '/api/chat', json={
                    'model': config.OLLAMA_MODEL,
                    'messages': [{'role': 'system', 'content':
                                  'Você é Criot. Responda em português de forma clara e honesta.'}]
                                + historico,
                    'stream': False,
                })
                response.raise_for_status()
                answer = response.json()['message']['content']
                if not isinstance(answer, str) or not answer.strip():
                    raise ValueError('Resposta vazia')
                return answer.strip()
        except httpx.TimeoutException as exc:
            raise ProviderError('Ollama demorou demais para responder.', 504) from exc
        except httpx.ConnectError as exc:
            raise ProviderError('Ollama indisponível. Verifique o serviço e OLLAMA_BASE_URL.', 503) from exc
        except httpx.HTTPStatusError as exc:
            raise ProviderError('Ollama rejeitou a requisição. Verifique o modelo instalado.') from exc
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise ProviderError('Resposta inválida ou falha de comunicação com Ollama.') from exc

def make_provider():
    if config.PROVIDER == 'mock':
        return MockProvider()
    if config.PROVIDER == 'ollama':
        return OllamaProvider()
    raise ValueError('AI_PROVIDER deve ser mock ou ollama.')
