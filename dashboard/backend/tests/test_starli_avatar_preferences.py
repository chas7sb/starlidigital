import types
import pytest
from pydantic import ValidationError
from fastapi import HTTPException
from open_webui.routers import starli_v3_native as native

@pytest.fixture
def registry(tmp_path,monkeypatch):
    monkeypatch.setattr(native,"_path",lambda:tmp_path/"agents.sqlite")
    monkeypatch.setattr(native,"_ready",lambda user:None)
    return types.SimpleNamespace(id="avatar-test-alice",role="user",oauth_sub=None)

def test_avatar_preferences_persist_and_clone(registry):
    agent=native.create_agent(native.CreateAgent(name="AGENT1",role="Engineer",avatarColor="#0f766e",avatarShape="✦"),user=registry)
    assert agent["avatarColor"]=="#0f766e"
    assert agent["avatarShape"]=="✦"
    saved=native.update_agent(agent["id"],native.UpdateAgent(avatarColor="#be185d",avatarShape="◆",expectedVersion=agent["version"]),user=registry)
    assert saved["avatarColor"]=="#be185d"
    assert saved["avatarShape"]=="◆"
    assert native.get_agent(agent["id"],user=registry)["avatarColor"]=="#be185d"
    clone=native.clone_agent(agent["id"],native.CloneAgent(name="AGENT copy",expectedVersion=saved["version"]),user=registry)
    assert clone["avatarColor"]=="#be185d"
    assert clone["avatarShape"]=="◆"

def test_avatar_schema_rejects_css_and_excessive_content():
    with pytest.raises(ValidationError):
        native.CreateAgent(name="AGENT1",role="Engineer",avatarColor="url(evil)")
    with pytest.raises(ValidationError):
        native.UpdateAgent(expectedVersion=1,avatarShape="arbitrary-html")

def test_other_account_cannot_read_avatar(registry):
    agent=native.create_agent(native.CreateAgent(name="AGENT1",role="Engineer",avatarColor="#0f766e"),user=registry)
    with pytest.raises(HTTPException) as error:
        native.get_agent(agent["id"],user=types.SimpleNamespace(id="avatar-test-bob",role="user",oauth_sub=None))
    assert error.value.status_code==404
