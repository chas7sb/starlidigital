"""Atomic admission around the existing canonical template installer."""
import hashlib
import json
import sqlite3
from contextlib import closing
from .agent_profiles import ProfileError
from .registry import BotRegistry
from .directory import BotDirectory


class AgentCreation:
    def __init__(self, profiles, catalog_path):
        self.profiles = profiles
        self.catalog = json.loads(catalog_path.read_text())['templates']

    def initialize(self):
        with closing(sqlite3.connect(self.profiles.path)) as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS company_bot_creations(actor TEXT,company TEXT,request_key TEXT,fingerprint TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(actor,company,request_key));
            CREATE TABLE IF NOT EXISTS template_installs(bot TEXT PRIMARY KEY,actor TEXT,install_key TEXT,request_hash TEXT,template TEXT,version INTEGER,base TEXT,config TEXT,UNIQUE(actor,install_key));
            ''')

    def create(self, actor, company, template, name, purpose, instructions, request_key, before_commit=lambda: None):
        if not isinstance(template, str) or not isinstance(name, str) or not 1 <= len(name.strip()) <= 100 or not isinstance(purpose, str) or len(purpose)>2000 or not isinstance(instructions, str) or len(instructions)>16000 or not isinstance(request_key,str) or not 1<=len(request_key)<=128:
            raise ProfileError(422,'AGENT_CREATE_INVALID')
        fingerprint=hashlib.sha256(json.dumps([template,name.strip(),purpose,instructions],ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
        with closing(sqlite3.connect(self.profiles.path,isolation_level=None)) as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                a=self.profiles._authority(db)
                a._admin(actor,company)
                old=db.execute('SELECT fingerprint,receipt FROM company_bot_creations WHERE actor=? AND company=? AND request_key=?',(actor,company,request_key)).fetchone()
                if old:
                    if old[0]!=fingerprint:raise ProfileError(409,'AGENT_CREATE_KEY_REUSED')
                    result=json.loads(old[1]);self.profiles._read(db,actor,company,result['botId']);before_commit();db.execute('COMMIT');return result
                # Reuse real installer logic and identity. Its transaction joins ours.
                registry=object.__new__(BotRegistry);registry.db=db;registry.require_member=a.require_member;registry._tx=lambda fn:fn()
                if template=='__scratch__':
                    # A real custom bot, not an invented catalog template/install.
                    value=registry.create_shared(actor,company,name.strip())
                    db.execute("UPDATE bots SET purpose='custom' WHERE id=?",(value['id'],))
                    instance={'bot':value,'config':{'name':name.strip(),'instructions':instructions}}
                else:
                    directory=object.__new__(BotDirectory);directory.registry=registry;directory.db=db;directory.catalog=self.catalog
                    instance=directory.install(actor,template,'company',company,request_key)
                bot=instance['bot']['id']
                if db.execute('SELECT 1 FROM members WHERE company_id=? AND user_id=?',(company,bot)).fetchone():raise ProfileError(409,'AGENT_IDENTITY_CONFLICT')
                db.execute("INSERT INTO members VALUES(?,?,?,1,1,?,'bot')",(company,bot,'member',name.strip()))
                db.execute('UPDATE bots SET name=? WHERE id=?',(name.strip(),bot))
                config=instance['config']|{'name':name.strip(),'instructions':instructions}
                if template!='__scratch__':
                    db.execute('UPDATE template_installs SET config=? WHERE bot=?',(json.dumps(config),bot))
                db.execute("INSERT INTO company_bot_profiles VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",(bot,company,purpose,instructions,actor))
                a.log(company,actor,'bot.register',bot)
                profile=self.profiles._read(db,actor,company,bot)
                result=dict(version='starli.company-agent-created.v1',companyId=company,botId=bot,templateId=template,creationMode='scratch' if template=='__scratch__' else 'template',profile=profile,setupRequired=['provider','permissions'])
                db.execute('INSERT INTO company_bot_creations VALUES(?,?,?,?,?)',(actor,company,request_key,fingerprint,json.dumps(result)))
                a._admin(actor,company);before_commit();db.execute('COMMIT');return result
            except BaseException:
                db.execute('ROLLBACK');raise


def build_creation_router(creation,verified_user,capture_fence,mutation_guard,forbidden_errors=()):
    from fastapi import APIRouter,Depends,Request,HTTPException
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel,ConfigDict,Field
    from .store import MemoryFault
    class Form(BaseModel):
        model_config=ConfigDict(extra='forbid',strict=True)
        templateId:str=Field(min_length=1,max_length=100)
        name:str=Field(min_length=1,max_length=100)
        purpose:str=Field(max_length=2000)
        instructions:str=Field(max_length=16000)
        requestKey:str=Field(min_length=1,max_length=128)
    router=APIRouter(prefix='/api/v1/companies')
    @router.post('/{company}/bots')
    def create(company:str,form:Form,request:Request,user=Depends(verified_user)):
        mutation_guard(request);fence=capture_fence(request,user);fence.check()
        try:result=creation.create(user.id,company,form.templateId,form.name,form.purpose,form.instructions,form.requestKey,before_commit=fence.check)
        except ProfileError as e:raise HTTPException(e.status,e.code) from None
        except MemoryFault as e:raise HTTPException(e.status,e.code) from None
        except forbidden_errors:raise HTTPException(403,'AGENT_CREATE_DENIED') from None
        fence.check();return JSONResponse(result,headers={'Cache-Control':'no-store'})
    return router
