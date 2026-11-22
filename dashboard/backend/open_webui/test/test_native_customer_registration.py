from contextlib import contextmanager
from types import SimpleNamespace as NS
import uuid
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from open_webui.routers import auths as router
from open_webui.models import auths as auth_model,users as user_model
from open_webui.internal.db import Base

@pytest.fixture
def registration(tmp_path,monkeypatch):
    engine=create_engine("sqlite:///"+str(tmp_path/"registration.sqlite"))
    Base.metadata.create_all(engine)
    session=sessionmaker(bind=engine,expire_on_commit=False)
    @contextmanager
    def database():
        db=session()
        try:yield db
        finally:db.close()
    monkeypatch.setattr(auth_model,"get_db",database)
    monkeypatch.setattr(user_model,"get_db",database)
    monkeypatch.setattr(router,"DATA_DIR",tmp_path/"rate")
    monkeypatch.setattr(router,"WEBUI_AUTH",True)
    monkeypatch.setattr(router,"WEBUI_AUTH_TRUSTED_EMAIL_HEADER",None)
    monkeypatch.setattr(router,"get_permissions",lambda *args:{})
    config=NS(ENABLE_SIGNUP=True,ENABLE_LOGIN_FORM=True,DEFAULT_USER_ROLE="admin",JWT_EXPIRES_IN="1h",WEBHOOK_URL=None,USER_PERMISSIONS={})
    app=FastAPI();app.include_router(router.router);app.state.config=config;app.state.WEBUI_NAME="Test"
    yield TestClient(app),config
    engine.dispose()

def owner():return user_model.Users.insert_new_user(uuid.uuid4().hex,"Owner","owner@example.com","/user.png","admin")
def body(**extra):return {"name":" Customer ","email":"Customer@Example.com","password":"customer-password-123",**extra}

def test_empty_install_requires_operator_bootstrap(registration):
    client,config=registration
    response=client.post("/signup",json=body())
    assert response.status_code==503 and "bootstrap" in response.json()["detail"]
    assert user_model.Users.get_num_users()==0 and config.ENABLE_SIGNUP is True

def test_signup_never_honors_admin_default_and_can_sign_in(registration):
    client,config=registration;owner()
    response=client.post("/signup",json=body(profile_image_url="data:image/svg+xml;base64,PHN2Zy8+"))
    assert response.status_code==200,response.text
    data=response.json();assert data["role"]=="user" and data["name"]=="Customer"
    assert data["email"]=="customer@example.com" and data["profile_image_url"]=="/user.png"
    assert "httponly" in response.headers["set-cookie"].lower()
    stored=user_model.Users.get_user_by_id(data["id"])
    assert stored.role=="user" and getattr(stored,"oauth_sub",None) is None
    assert config.DEFAULT_USER_ROLE=="admin" and config.ENABLE_SIGNUP is True
    assert client.post("/signin",json={"email":"customer@example.com","password":"customer-password-123"}).json()["role"]=="user"
    assert client.post("/signin",json={"email":"customer@example.com","password":"wrong-password"}).status_code==400

@pytest.mark.parametrize("field,value",[("role","admin"),("user_id","owner"),("id","owner"),("source_admin",True),("permissions",{"admin":True})])
def test_signup_rejects_authority_body_fields(registration,field,value):
    client,_=registration;owner()
    assert client.post("/signup",json=body(**{field:value})).status_code==422
    assert user_model.Users.get_num_users()==1

@pytest.mark.parametrize("field,value",[("name",""),("name","x"*121),("name","bad\nname"),("email","x"*255),("password","short"),("password","x"*73),("password","é"*37)])
def test_signup_bounds(field,value):
    with pytest.raises(ValidationError):auth_model.SignupForm(**body(**{field:value}))

def test_signup_disabled_and_no_auth_fail_closed(registration,monkeypatch):
    client,config=registration;owner();config.ENABLE_SIGNUP=False
    assert client.post("/signup",json=body()).status_code==403
    config.ENABLE_SIGNUP=True;monkeypatch.setattr(router,"WEBUI_AUTH",False)
    assert client.post("/signup",json=body()).status_code==403

def test_duplicate_rejection_and_peer_limit_shared_file(registration):
    client,_=registration;owner()
    assert client.post("/signup",json=body()).status_code==200
    for _ in range(4):assert client.post("/signup",json=body()).status_code==400
    response=client.post("/signup",json=body())
    assert response.status_code==429 and response.headers["retry-after"]=="900"
    # A fresh ASGI client uses the same worker-independent rate database.
    assert TestClient(client.app).post("/signup",json=body()).status_code==429
    assert user_model.Users.get_num_users()==2
