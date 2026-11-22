from types import SimpleNamespace
import inspect
from open_webui.routers import starli_native_capabilities as mod

def _app(paths, **flags):
    routes = [SimpleNamespace(path=path) for path in paths]
    return SimpleNamespace(routes=routes, state=SimpleNamespace(config=SimpleNamespace(**flags)))

def test_mounted_route_is_presence_not_e2e():
    body = mod.inventory(_app(['/api/v1/images/generations'], ENABLE_IMAGE_GENERATION=True))
    item = next(f for f in body['features'] if f['id'] == 'image_generation')
    assert item['present'] is True
    assert item['configured'] is True
    assert item['verification'] == mod.CONFIGURED_ONLY
    assert 'not E2E verified' in item['verification']

def test_missing_route_clears_configured():
    body = mod.inventory(_app([], ENABLE_WEB_SEARCH=True))
    item = next(f for f in body['features'] if f['id'] == 'web_search')
    assert item['present'] is False
    assert item['configured'] is None
    assert item['verification'] == 'route not mounted'

def test_non_bool_flag_is_unverified():
    body = mod.inventory(_app(['/api/v1/images'], ENABLE_IMAGE_GENERATION='yes'))
    item = next(f for f in body['features'] if f['id'] == 'image_generation')
    assert item['present'] is True
    assert item['configured'] is None
    assert item['verification'] == mod.UNVERIFIED

def test_endpoint_calls_real_auth_guard_and_returns_safe_inventory(monkeypatch):
    from fastapi import HTTPException
    import pytest
    request=SimpleNamespace(app=_app(['/api/v1/images'],ENABLE_IMAGE_GENERATION=False,API_KEY='never-return-me'))
    seen=[]
    monkeypatch.setattr(mod,'principal',lambda user:seen.append(user['id']))
    body=mod.native_capabilities(request,user={'id':'verified'})
    assert seen==['verified'] and 'never-return-me' not in repr(body)
    def deny(user):raise HTTPException(403,'Denied')
    monkeypatch.setattr(mod,'principal',deny)
    with pytest.raises(HTTPException):mod.native_capabilities(request,user={'id':'foreign'})
