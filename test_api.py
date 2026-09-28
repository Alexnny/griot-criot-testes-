import asyncio
from concurrent.futures import ThreadPoolExecutor
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.ai import MockProvider, OllamaProvider, ProviderError

def test_persistence_and_validation(tmp_path):
    path = tmp_path / 'test.db'
    with TestClient(create_app(path, MockProvider())) as client:
        assert client.post('/conversas', json={'titulo': '  '}).status_code == 422
        created = client.post('/conversas', json={'titulo': 'Teste'})
        assert created.status_code == 201
        cid = created.json()['id']
        assert client.get(f'/conversas/{cid}/historico').json() == []
        assert client.post('/chat', json={'conversa_id': cid, 'prompt': ' '}).status_code == 422
        assert client.post('/chat', json={'conversa_id': 999, 'prompt': 'Oi'}).status_code == 404
        assert client.get('/conversas/999/historico').status_code == 404
        for prompt in ['Olá', 'Tudo bem?']:
            result = client.post('/chat', json={'conversa_id': cid, 'prompt': prompt})
            assert result.status_code == 200
            assert result.json()['provedor'] == 'mock'
        assert 'número 2' in result.json()['resposta']
    with TestClient(create_app(path, MockProvider())) as client:
        history = client.get(f'/conversas/{cid}/historico').json()
        assert [m['papel'] for m in history] == ['user', 'criot', 'user', 'criot']
        assert history[0]['conteudo'] == 'Olá'
        assert history[0]['timestamp'].endswith('Z')

def test_failure_does_not_save_partial_turn(tmp_path):
    class Broken:
        name = 'broken'
        async def responder(self, history):
            raise ProviderError('Falha de teste', 503)
    with TestClient(create_app(tmp_path / 'test.db', Broken())) as client:
        cid = client.post('/conversas', json={}).json()['id']
        assert client.post('/chat', json={'conversa_id': cid, 'prompt': 'Oi'}).status_code == 503
        assert client.get(f'/conversas/{cid}/historico').json() == []

def test_parallel_turns_receive_ordered_history(tmp_path):
    class Slow(MockProvider):
        async def responder(self, history):
            await asyncio.sleep(0.02)
            return await super().responder(history)
    with TestClient(create_app(tmp_path / 'test.db', Slow())) as client:
        cid = client.post('/conversas', json={}).json()['id']
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(lambda p: client.post('/chat', json={
                'conversa_id': cid, 'prompt': p}), ['Primeiro', 'Segundo']))
        assert all(r.status_code == 200 for r in responses)
        history = client.get(f'/conversas/{cid}/historico').json()
        assert 'número 1' in history[1]['conteudo']
        assert 'número 2' in history[3]['conteudo']

@pytest.mark.parametrize('mode,expected', [('ok', None), ('timeout', 504), ('invalid', 502)])
def test_ollama_adapter(monkeypatch, mode, expected):
    async def fake_post(self, url, json):
        assert url.endswith('/api/chat')
        assert json['stream'] is False
        assert json['messages'][-1] == {'role': 'user', 'content': 'Oi'}
        if mode == 'timeout':
            raise httpx.ReadTimeout('Timeout')
        return httpx.Response(200, json={'message': {'content': 'Olá'}} if mode == 'ok' else {},
                              request=httpx.Request('POST', url))
    monkeypatch.setattr(httpx.AsyncClient, 'post', fake_post)
    call = OllamaProvider().responder([{'role': 'user', 'content': 'Oi'}])
    if expected:
        with pytest.raises(ProviderError) as exc:
            asyncio.run(call)
        assert exc.value.status_code == expected
    else:
        assert asyncio.run(call) == 'Olá'
