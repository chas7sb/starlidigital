"""Authenticated Starli platform reads. Source database is always opened read-only."""
import json, os, sqlite3
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from open_webui.utils.auth import get_verified_user

router=APIRouter()
from open_webui.routers.starli_state import source_database, bindings_path
DATABASE=source_database()
BINDINGS=bindings_path()
CATALOG=Path(__file__).with_name('starli_capabilities.json')

def principal(user):
    uid=user.get('id') if isinstance(user,dict) else getattr(user,'id',None)
    role=user.get('role') if isinstance(user,dict) else getattr(user,'role',None)
    if not uid: raise HTTPException(401,'Authentication required')
    if not BINDINGS: raise HTTPException(503,'Company membership source unavailable')
    try:
        binding=json.loads(Path(BINDINGS).read_text()).get('memberships',{}).get(uid)
    except (OSError, ValueError, TypeError, AttributeError):
        raise HTTPException(503,'Company membership source unavailable') from None
    if not binding: raise HTTPException(403,'Company membership required')
    with connection() as db:
        row=db.execute('SELECT payload FROM users WHERE id=?',(binding['v2UserId'],)).fetchone()
    source=json.loads(row[0]) if row else {}
    if source.get('disabled') or source.get('role')!='ADMIN' or role!='admin':
        raise HTTPException(403,'Platform administrator required')
    return uid,binding

def customer_principal(user):
    uid=user.get('id') if isinstance(user,dict) else getattr(user,'id',None)
    role=user.get('role') if isinstance(user,dict) else getattr(user,'role',None)
    if not uid or role not in ('user','admin'):raise HTTPException(403,'Active customer account required')
    subject=user.get('oauth_sub') if isinstance(user,dict) else getattr(user,'oauth_sub',None)
    if isinstance(subject,str) and subject.startswith('starli-node:'):
        from open_webui.routers.starli_v3_native import _owner
        _owner(user)
        return uid,{'v2UserId':subject[len('starli-node:'):],'customer':True}
    if role=='admin':
        try:
            _,binding=principal(user)
            return uid,{**binding,'customer':True}
        except HTTPException:
            pass
    from open_webui.routers.starli_customer_identity import ensure_native_customer
    return uid,ensure_native_customer(user)

def connection():
    return sqlite3.connect('file:'+DATABASE+'?mode=ro',uri=True,timeout=3)

def records(db,collection):
    return [json.loads(r[0]) for r in db.execute('SELECT payload FROM records WHERE collection=?',(collection,))]

def public_company(c):
    fields=('id','name','domain','industry','email','phone','website','locality','country','version','updatedAt')
    return {**{k:c.get(k) for k in fields},'status':c.get('qualificationStatus','UNKNOWN')}

@router.get('/crm')
def crm(q:str=Query('',max_length=200),limit:int=Query(50,ge=1,le=200),offset:int=Query(0,ge=0),user=Depends(get_verified_user)):
    principal(user)
    with connection() as db: companies=records(db,'crm_companies')
    companies=[c for c in companies if q.casefold() in ' '.join(str(c.get(k,'')) for k in ('name','email','industry','locality')).casefold()]
    companies.sort(key=lambda c:str(c.get('name','')).casefold())
    return {'items':[public_company(c) for c in companies[offset:offset+limit]],'total':len(companies),'limit':limit,'offset':offset,'readOnly':True}

@router.get('/crm/{company_id}')
def company(company_id:str,user=Depends(get_verified_user)):
    principal(user)
    with connection() as db:
        row=db.execute("SELECT payload FROM records WHERE collection='crm_companies' AND id=?",(company_id,)).fetchone()
        if not row: raise HTTPException(404,'Company not found')
        c=json.loads(row[0])
        activities=[a for a in records(db,'crm_activities') if a.get('companyId')==company_id]
    return {'company':public_company(c),'contacts':[{'email':c.get('email'),'phone':c.get('phone')}],
            'tasks':[{'id':a.get('id'),'title':a.get('title'),'status':a.get('status'),'dueAt':a.get('dueAt')} for a in activities if a.get('type')=='TASK'][:100],
            'interactions':[{'id':a.get('id'),'type':a.get('type'),'title':a.get('title'),'createdAt':a.get('createdAt')} for a in activities[-100:]],'readOnly':True}

@router.get('/capabilities')
def capabilities(user=Depends(get_verified_user)):
    principal(user)
    return {'items':json.loads(CATALOG.read_text()),'execution':'Catalog only; runtime authorization determines executable tools.'}

@router.get('/admin')
def admin(user=Depends(get_verified_user)):
    principal(user)
    with connection() as db:
        counts=dict(db.execute('SELECT collection,count(*) FROM records GROUP BY collection').fetchall())
        users=db.execute('SELECT count(*) FROM users').fetchone()[0]
    return {'platform':{'name':'StarliDigital V2','frontend':'OpenWebUI 0.6.5 fork','mode':'private preview','membership':'operator-configured private preview binding'},
            'services':{'sourceDatabase':'read-only connected','runtime':'See runtime capabilities','browser':'Session API available when Playwright installed'},
            'counts':{**counts,'users':users},'capabilities':json.loads(CATALOG.read_text()),
            'limitations':['Production frontend is unchanged.','CRM reads require a verified platform administrator.','General customer membership and credit-funded tool execution remain release gates.','Native users, models, connections and settings are managed in /admin.','Catalog presence does not establish live execution.']}
