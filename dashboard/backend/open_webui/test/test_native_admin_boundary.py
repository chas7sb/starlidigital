import importlib,re
from types import SimpleNamespace as NS
from fastapi import FastAPI,Depends
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from open_webui.utils.auth import get_current_user,get_admin_user,create_token,Users

MODULES=("configs","users","auths","functions","tools","models","retrieval","ollama","openai","images","audio","tasks","utils","evaluations")

def admin_dependency(dependant):
    return dependant.call is get_admin_user or any(admin_dependency(child) for child in dependant.dependencies)

def admin_app():
    app=FastAPI()
    for name in MODULES:
        router=importlib.import_module("open_webui.routers."+name).router
        app.include_router(router,prefix="/audit/"+name)
    return app

def test_native_admin_endpoints_deny_guests_and_customers():
    app=admin_app();client=TestClient(app);checked=[]
    for route in app.routes:
        if not isinstance(route,APIRoute) or not admin_dependency(route.dependant):continue
        path=re.sub(r"\{[^}]+\}","0",route.path)
        method=next(iter(route.methods))
        response=client.request(method,path,json={})
        assert response.status_code in (401,403),(method,path,response.status_code)
        app.dependency_overrides[get_current_user]=lambda:NS(id="customer",role="user")
        response=client.request(method,path,json={})
        assert response.status_code in (401,403),(method,path,response.status_code)
        app.dependency_overrides.clear();checked.append(path)
    assert len(checked)>=80
    assert "/audit/auths/admin/details" in checked
    assert "/audit/configs/export" in checked
    assert "/audit/users/update/role" in checked

def test_every_native_auths_admin_path_requires_admin():
    from open_webui.routers import auths
    for route in auths.router.routes:
        if isinstance(route,APIRoute) and route.path.startswith("/admin/"):
            assert admin_dependency(route.dependant),route.path

def test_current_persisted_role_controls_admin_even_with_stale_jwt(monkeypatch):
    row=NS(id="role-user",role="admin")
    monkeypatch.setattr(Users,"get_user_by_id",lambda uid:row)
    monkeypatch.setattr(Users,"update_user_last_active_by_id",lambda uid:None)
    app=FastAPI()
    @app.get("/admin-probe")
    def probe(user=Depends(get_admin_user)):return {"role":user.role}
    client=TestClient(app)
    token=create_token({"id":"role-user","role":"admin"})
    headers={"Authorization":"Bearer "+token}
    assert client.get("/admin-probe").status_code in (401,403)
    assert client.get("/admin-probe",headers=headers).status_code==200
    row.role="user"
    assert client.get("/admin-probe",headers=headers).status_code in (401,403)
    row.role="pending"
    assert client.get("/admin-probe",headers=headers).status_code in (401,403)
