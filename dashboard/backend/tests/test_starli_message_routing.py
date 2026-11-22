"""Regression: owner-scoped direct messages cannot use an unrelated chat sender."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from open_webui.routers import starli_v3_native as native, starli_pi_master
from open_webui.utils.auth import get_verified_user


@pytest.fixture
def fixture(monkeypatch, tmp_path):
    monkeypatch.setattr(native, '_path', lambda: tmp_path / 'agents.sqlite')
    monkeypatch.setattr(native, '_ready', lambda user: None)
    calls = []

    async def fake_tool(user, operation, payload, key):
        calls.append((user, operation, payload))
        return {'delivered': True, 'reply': 'ACK'}

    monkeypatch.setattr(starli_pi_master, '_tool', fake_tool)
    with native._db() as db:
        native._boss(db, 'alice')
        native._boss(db, 'bob')
        now = native._utc()
        db.execute(
            "INSERT INTO agents(id, owner, kind, name, role, instructions, status, version, created_at, updated_at) "
            "VALUES(?,?,'persistent','AGENT1','Developer','','IDLE',1,?,?)",
            ('agent:alice', 'alice', now, now)
        )
        db.executemany(
            "INSERT INTO agent_conversations(owner,agent_id,chat_id,created_at,updated_at) VALUES(?,?,?,?,?)",
            [
                ('alice', 'boss:alice', 'boss-chat-0001', now, now),
                ('bob', 'boss:bob', 'boss-chat-0002', now, now),
            ]
        )
        db.commit()
    app = FastAPI()
    app.include_router(native.router, prefix='/api')
    app.dependency_overrides[get_verified_user] = lambda: {'id': 'alice', 'role': 'admin'}
    with TestClient(app) as client:
        client.headers.update({'Authorization': 'Bearer test-only-placeholder'})
        yield client, calls


def test_bound_sender_is_used(fixture):
    client, calls = fixture
    response = client.post('/api/agents/agent:alice/messages',
                           json={'message': 'Ping', 'fromChatId': 'boss-chat-0001'})
    assert response.status_code == 200, response.text
    assert calls[0][2]['fromAgentId'] == 'boss:alice'
    assert calls[0][2]['agentId'] == 'agent:alice'


def test_foreign_chat_cannot_be_used_as_sender(fixture):
    client, calls = fixture
    response = client.post('/api/agents/agent:alice/messages',
                           json={'message': 'Ping', 'fromChatId': 'boss-chat-0002'})
    assert response.status_code == 404
    assert calls == []


def test_conflicting_sender_is_rejected(fixture):
    client, calls = fixture
    response = client.post('/api/agents/agent:alice/messages',
                           json={'message': 'Ping', 'fromChatId': 'boss-chat-0001',
                                 'fromAgentId': 'agent:alice'})
    assert response.status_code == 409
    assert calls == []
