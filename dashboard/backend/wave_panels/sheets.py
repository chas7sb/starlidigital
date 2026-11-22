"""starli.company-sheets.v1: transactional snapshots with native company authority."""
import contextlib
import hashlib
import json
import math
import re
import sqlite3
import time
import uuid
from types import SimpleNamespace

class Denied(Exception): pass
class Conflict(Exception): pass

def validate(snapshot):
    # Accept only declarative JSON data. Never evaluate imported code or macros.
    if not isinstance(snapshot,dict) or not isinstance(snapshot.get('name'),str) or not 0<len(snapshot['name'])<=240:
        raise ValueError('invalid workbook name')
    raw=json.dumps(snapshot,allow_nan=False,separators=(',',':'))
    if len(raw.encode())>8*1024*1024: raise ValueError('snapshot exceeds 8 MiB')
    order=snapshot.get('sheetOrder'); sheets=snapshot.get('sheets')
    if not isinstance(order,list) or not 0<len(order)<=32 or len(set(order))!=len(order) or not isinstance(sheets,dict) or set(order)!=set(sheets):
        raise ValueError('invalid sheets')
    count=0
    for sid in order:
        s=sheets[sid]
        if s.get('id')!=sid or not isinstance(s.get('name'),str) or not 0<len(s['name'])<=31: raise ValueError('invalid sheet')
        if not 1<=s.get('rowCount',100)<=10000 or not 1<=s.get('columnCount',26)<=256: raise ValueError('sheet dimensions exceeded')
        for r,row in s.get('cellData',{}).items():
            if not str(r).isdigit() or not 0<=int(r)<10000 or not isinstance(row,dict): raise ValueError('invalid row')
            for col,cell in row.items():
                count+=1
                if count>100000 or not str(col).isdigit() or not 0<=int(col)<256: raise ValueError('cell limit exceeded')
                if cell is None: continue
                if not isinstance(cell,dict): raise ValueError('invalid cell')
                f=cell.get('f','')
                if not isinstance(f,str) or len(f)>8192 or re.search(r'\[|\]|\||https?://|\b(?:WEBSERVICE|HYPERLINK|IMPORTXML|IMPORTDATA|RTD|CALL|REGISTER|EXEC)\s*\(',f,re.I):
                    raise ValueError('external or executable formula unsupported')
    return raw

class Sheets:
    def __init__(self,path,authority_class):
        self.db=sqlite3.connect(path,timeout=15)
        self.db.row_factory=sqlite3.Row
        self.authority_class=authority_class
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS sheets_books(id TEXT PRIMARY KEY,company TEXT NOT NULL,owner TEXT NOT NULL,binding TEXT NOT NULL,name TEXT NOT NULL,head INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sheets_revisions(book TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,created REAL NOT NULL,sha256 TEXT NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(book,revision));
        CREATE TABLE IF NOT EXISTS sheets_proposals(id TEXT PRIMARY KEY,company TEXT NOT NULL,book TEXT NOT NULL,actor TEXT NOT NULL,bot TEXT,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,base INTEGER NOT NULL,sheet TEXT NOT NULL,range TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,state TEXT NOT NULL,applied_revision INTEGER,actor_binding TEXT NOT NULL,UNIQUE(company,actor,request_key));
        ''')
        self.db.commit()

    def member(self,actor,company,write=False):
        try:
            authority=object.__new__(self.authority_class)
            authority.db=self.db
            authority.require_member(actor,company,permission='write' if write else 'read')
            epoch=self.db.execute("SELECT max(id) FROM audit WHERE company_id=? AND actor=? AND action IN ('create','accept')",(company,actor)).fetchone()[0]
            if epoch is None: raise Denied()
            return hashlib.sha256((company+'\0'+actor).encode()).hexdigest()+':'+str(epoch)
        except Exception as e: raise Denied('workbook unavailable') from e

    @contextlib.contextmanager
    def access(self,actor,company,write=False):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            binding=self.member(actor,company,write)
            yield binding
            if self.member(actor,company,write)!=binding: raise Denied('membership changed')
            self.db.commit()
        except BaseException:
            self.db.rollback(); raise

    def row(self,company,key):
        row=self.db.execute('SELECT * FROM sheets_books WHERE id=? AND company=?',(key,company)).fetchone()
        if not row: raise Denied('workbook unavailable')
        return row

    def listing(self,actor,company):
        with self.access(actor,company):
            return [dict(id=r['id'],name=r['name'],revision=r['head']) for r in self.db.execute('SELECT * FROM sheets_books WHERE company=? ORDER BY name,id',(company,))]

    def create(self,actor,company,snapshot):
        raw=validate(snapshot); key=str(uuid.uuid4())
        with self.access(actor,company,True) as binding:
            self.db.execute('INSERT INTO sheets_books VALUES(?,?,?,?,?,1)',(key,company,actor,binding,snapshot['name']))
            self.revision(key,1,actor,raw)
        return dict(id=key,revision=1,snapshot=snapshot,contract_version=1)

    def revision(self,key,revision,actor,raw):
        self.db.execute('INSERT INTO sheets_revisions VALUES(?,?,?,?,?,?)',(key,revision,actor,time.time(),hashlib.sha256(raw.encode()).hexdigest(),raw))

    def get(self,actor,company,key):
        with self.access(actor,company):
            row=self.row(company,key)
            rev=self.db.execute('SELECT * FROM sheets_revisions WHERE book=? AND revision=?',(key,row['head'])).fetchone()
            return dict(id=key,revision=row['head'],snapshot=json.loads(rev['snapshot']),sha256=rev['sha256'],contract_version=1)

    def save(self,actor,company,key,expected_revision,snapshot):
        raw=validate(snapshot)
        with self.access(actor,company,True):
            row=self.row(company,key)
            if type(expected_revision) is not int or row['head']!=expected_revision: raise Conflict('head revision changed; reload and review')
            head=row['head']+1
            self.revision(key,head,actor,raw)
            self.db.execute('UPDATE sheets_books SET head=?,name=? WHERE id=?',(head,snapshot['name'],key))
            return dict(id=key,revision=head,contract_version=1)

    def import_drive(self,actor,company,resource_id,version,drive,decode):
        # Drive owns file visibility. No raw keys, paths, URLs, or legacy personal IDs.
        result=drive.content(actor,company,resource_id,version)
        data=result['data'] if isinstance(result,dict) else result[0]
        snapshot=decode(data)
        # Recheck source access and company membership after parsing.
        drive.content(actor,company,resource_id,version)
        return self.create(actor,company,snapshot)

    @staticmethod
    def coordinates(a1,values,scalars=True):
        m=re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?',a1.upper())
        if not m: raise ValueError('invalid A1 range')
        def col(s):
            n=0
            for c in s:n=n*26+ord(c)-64
            return n-1
        c,r=col(m[1]),int(m[2])-1;endc,endr=col(m[3] or m[1]),int(m[4] or m[2])-1
        if r>endr or c>endc or endr>=10000 or endc>=256 or (endr-r+1)*(endc-c+1)>10000: raise ValueError('range limit exceeded')
        if not isinstance(values,list) or len(values)!=endr-r+1 or any(not isinstance(row,list) or len(row)!=endc-c+1 for row in values): raise ValueError('matrix dimensions do not match range')
        for row in values:
            for v in row:
                if scalars and v is not None and type(v) not in (str,int,float,bool): raise ValueError('scalar cell values required')
                if isinstance(v,float) and not math.isfinite(v): raise ValueError('finite values required')
        return r,c

    def bot_access(self,actor,company,bot):
        if bot:
            a=object.__new__(self.authority_class);a.db=self.db
            try:a.require_member(bot,company,permission='files.manage')
            except Exception as e:raise Denied('bot cannot edit company files') from e

    def propose_range(self,actor,company,resource_id,expected_revision,sheet_id,a1,values,idempotency_key,bot=None,final_authorize=None):
        """Runtime entry. Creates a durable preview; never silently commits a bot edit."""
        r,c=self.coordinates(a1,values)
        if not isinstance(idempotency_key,str) or not 1<=len(idempotency_key)<=200: raise ValueError('request key required')
        request_hash=hashlib.sha256(json.dumps([resource_id,expected_revision,sheet_id,a1,values,bot],sort_keys=True,allow_nan=False).encode()).hexdigest()
        with self.access(actor,company,True) as binding:
            self.bot_access(actor,company,bot)
            if bot and final_authorize is None:raise Denied('runtime commit fence required')
            def fence():
                if final_authorize is not None and final_authorize(self.db) is not True:raise Denied('runtime stopped or authorization changed')
            old=self.db.execute('SELECT * FROM sheets_proposals WHERE company=? AND actor=? AND request_key=?',(company,actor,idempotency_key)).fetchone()
            if old:
                if old['actor_binding']!=binding:raise Denied('proposal membership expired')
                if old['request_hash']!=request_hash:raise Conflict('request key already used for different edit')
                fence()
                return self.proposal_receipt(old)
            book=self.row(company,resource_id)
            if book['head']!=expected_revision:raise Conflict('head revision changed')
            snap=json.loads(self.db.execute('SELECT snapshot FROM sheets_revisions WHERE book=? AND revision=?',(resource_id,expected_revision)).fetchone()[0])
            if sheet_id not in snap['sheets']:raise ValueError('unknown sheet')
            cells=snap['sheets'][sheet_id].setdefault('cellData',{});before=[];after=[]
            for dy,row in enumerate(values):
                before_row=[];after_row=[]
                for dx,v in enumerate(row):
                    current=cells.get(str(r+dy),{}).get(str(c+dx));before_row.append(current)
                    new=dict(current or {});new.pop('f',None);new.pop('p',None);new.pop('si',None)
                    if isinstance(v,str) and v.startswith('='):new['f']=v;new.pop('v',None)
                    else:new['v']=v
                    after_row.append(new);cells.setdefault(str(r+dy),{})[str(c+dx)]=new
                before.append(before_row);after.append(after_row)
            validate(snap)
            pid=str(uuid.uuid4())
            fence()
            self.db.execute('INSERT INTO sheets_proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)',(pid,company,resource_id,actor,bot,idempotency_key,request_hash,expected_revision,sheet_id,a1,json.dumps(before),json.dumps(after),'pending',binding))
            return self.proposal_receipt(self.db.execute('SELECT * FROM sheets_proposals WHERE id=?',(pid,)).fetchone())

    @staticmethod
    def proposal_receipt(p):
        return dict(contract_version=1,proposal_id=p['id'],resource_id=p['book'],expected_revision=p['base'],sheet_id=p['sheet'],range=p['range'],before=json.loads(p['before_json']),after=json.loads(p['after_json']),state=p['state'],revision=p['applied_revision'],requires_human_apply=True)

    def proposals(self,actor,company,key):
        with self.access(actor,company) as binding:
            self.row(company,key)
            return [self.proposal_receipt(p) for p in self.db.execute("SELECT * FROM sheets_proposals WHERE company=? AND book=? AND actor=? AND actor_binding=? AND state='pending' ORDER BY rowid DESC LIMIT 100",(company,key,actor,binding))]

    # Agent6 domain adapter entry: retains preview/human apply semantics and fence.
    native_write_range=propose_range

    def apply_proposal(self,actor,company,proposal_id,undo=False):
        with self.access(actor,company,True) as binding:
            p=self.db.execute('SELECT * FROM sheets_proposals WHERE id=? AND company=? AND actor=?',(proposal_id,company,actor)).fetchone()
            if not p:raise Denied('proposal unavailable')
            if p['actor_binding']!=binding:raise Denied('proposal membership expired')
            # Human apply/undo only. Tool callers may propose, never approve themselves.
            a=object.__new__(self.authority_class);a.db=self.db
            scope=a.require_member(actor,company,permission='write')
            if scope.get('kind','person')!='person':raise Denied('human apply required')
            self.bot_access(actor,company,p['bot'])
            target='undone' if undo else 'applied'
            if p['state']==target:return self.proposal_receipt(p)
            if p['state']!=('applied' if undo else 'pending'):raise Conflict('proposal no longer applicable')
            book=self.row(company,p['book']);base=p['applied_revision'] if undo else p['base']
            if book['head']!=base:raise Conflict('head revision changed; review a new proposal')
            snap=json.loads(self.db.execute('SELECT snapshot FROM sheets_revisions WHERE book=? AND revision=?',(p['book'],base)).fetchone()[0])
            values=json.loads(p['before_json'] if undo else p['after_json']);r,c=self.coordinates(p['range'],values,scalars=False)
            cells=snap['sheets'][p['sheet']].setdefault('cellData',{})
            for dy,row in enumerate(values):
                for dx,v in enumerate(row):cells.setdefault(str(r+dy),{})[str(c+dx)]=v
            for sheet in snap['sheets'].values():
                for row in sheet.get('cellData',{}).values():
                    for cell in row.values():
                        if cell and cell.get('f'):cell.pop('v',None)
            raw=validate(snap);head=base+1;self.revision(p['book'],head,actor,raw)
            self.db.execute('UPDATE sheets_books SET head=? WHERE id=?',(head,p['book']))
            self.db.execute('UPDATE sheets_proposals SET state=?,applied_revision=? WHERE id=?',(target,head,proposal_id))
            receipt=self.proposal_receipt(self.db.execute('SELECT * FROM sheets_proposals WHERE id=?',(proposal_id,)).fetchone());receipt['recalculation_required']=True
            return receipt

def build_router(verified_user,db_path,authority_class):
    from fastapi import APIRouter,Depends,HTTPException,Response
    from pydantic import BaseModel,ConfigDict
    class Create(BaseModel):
        model_config=ConfigDict(extra='forbid')
        snapshot:dict
    class Save(Create):
        expected_revision:int
    class Proposal(BaseModel):
        model_config=ConfigDict(extra='forbid')
        expected_revision:int
        sheet_id:str
        range:str
        values:list
        idempotency_key:str
    router=APIRouter()
    def service():
        s=Sheets(db_path,authority_class)
        try: yield s
        finally: s.db.close()
    def call(response,fn):
        response.headers['Cache-Control']='no-store'
        try:return fn()
        except Denied:raise HTTPException(404,'workbook unavailable')
        except Conflict as e:raise HTTPException(409,str(e))
        except (ValueError,TypeError,KeyError) as e:raise HTTPException(400,str(e))
    @router.get('/{company}/sheets')
    def listing(company:str,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.listing(user.id,company))
    @router.post('/{company}/sheets')
    def create(company:str,f:Create,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.create(user.id,company,f.snapshot))
    @router.get('/{company}/sheets/{key}')
    def get(company:str,key:str,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.get(user.id,company,key))
    @router.put('/{company}/sheets/{key}')
    def save(company:str,key:str,f:Save,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.save(user.id,company,key,f.expected_revision,f.snapshot))
    @router.post('/{company}/sheets/{key}/proposals')
    def propose(company:str,key:str,f:Proposal,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.propose_range(user.id,company,key,f.expected_revision,f.sheet_id,f.range,f.values,f.idempotency_key))
    @router.get('/{company}/sheets/{key}/proposals')
    def proposals(company:str,key:str,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.proposals(user.id,company,key))
    @router.post('/{company}/sheets/proposals/{pid}/apply')
    def apply(company:str,pid:str,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.apply_proposal(user.id,company,pid))
    @router.post('/{company}/sheets/proposals/{pid}/undo')
    def undo(company:str,pid:str,response:Response,user=Depends(verified_user),s=Depends(service)):
        return call(response,lambda:s.apply_proposal(user.id,company,pid,undo=True))
    return router
