"""Isolated native claim -> human command -> canonical native worker admission.
Install explicitly; no production mount, no identity or token minting.
"""
from __future__ import annotations
import asyncio, contextlib, hashlib, json, re, sqlite3, uuid
from pathlib import Path
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictStr
class BuildCommand(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    command: StrictStr
def install_native_worker_routes(app, svc, dispatcher, *, allowed_origins):
    from grokbot1_routes import _token
    from grokbot1_claim import ClaimError, connect
    router=APIRouter()
    root=Path(svc.p.root).resolve()
    if not str(root).startswith('/tmp/grokbot1-w1-'): raise RuntimeError('DISPOSABLE_NATIVE_ROOT_REQUIRED')
    dbpath=root/'native-worker-admission.sqlite'
    with sqlite3.connect(dbpath) as db:
        db.execute('CREATE TABLE IF NOT EXISTS builds (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, admission TEXT NOT NULL, result TEXT)')
    def fresh(token,intent_id):
        session,uid=svc.native_session(token)
        nav=svc.owner_navigation(token,intent_id)
        if nav.get('stage')!='ROOM_READY' or nav.get('verifiedBy')!='native-store-readback':raise ClaimError(409,'NATIVE_CLAIM_NOT_READY')
        with contextlib.closing(connect(svc.p.intake)) as db:
            journal=db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND state='COMMITTED' ORDER BY updated DESC LIMIT 1",(intent_id,uid)).fetchone()
            issued=db.execute('SELECT receipt FROM guest_intents WHERE intent_id=?',(intent_id,)).fetchone()
        if journal is None or issued is None:raise ClaimError(404,'CLAIM_UNAVAILABLE')
        a=svc.ns.RbacAuthority(str(svc.p.authority))
        try:
            scope=a.require_member(uid,journal['company_id'],permission='bots.run')
            if scope['kind']!='person' or scope['role']!='owner':raise ClaimError(403,'CURRENT_NATIVE_OWNER_REQUIRED')
        finally:a.db.close()
        if session.revalidate() is not True:raise ClaimError(401,'NATIVE_SESSION_REVOKED')
        return session,uid,nav,dict(journal),json.loads(issued['receipt']),scope
    def validate_admission(admission,token,candidate=None):
        session,uid,nav,j,issued,scope=fresh(token,admission['intentId'])
        if uid!=admission['actor']['userId'] or j['txn']!=admission['claimId'] or nav['companyId']!=admission['companyId'] or nav['projectId']!=admission['projectId'] or scope['membership_revision']!=admission['authorizationRevision']:return False
        if candidate and (candidate.get('actor')!=admission['actor'] or any(candidate.get(k)!=admission[k] for k in ('companyId','projectId','requestId','sourceMessageId','originalPromptMessageId'))):return False
        rooms={r['id'] for r in svc.store.rooms(session,admission['companyId'])['rooms']}
        if admission['parentRoomId'] not in rooms or not all(w['roomId'] in rooms for w in admission['workers']):return False
        a=svc.ns.RbacAuthority(str(svc.p.authority))
        try:
            for w in admission['workers']:
                member=a.db.execute("SELECT active,kind FROM members WHERE company_id=? AND user_id=?",(admission['companyId'],w['botId'])).fetchone()
                bot=a.db.execute("SELECT active,owner,kind FROM bots WHERE id=?",(w['botId'],)).fetchone()
                if not member or member[0]!=1 or member[1]!='bot' or not bot or bot[0]!=1 or bot[1]!=admission['companyId'] or bot[2]!='company':return False
        finally:a.db.close()
        return True
    async def execute_queued(admission,token):
        def revalidate(candidate=None):return validate_admission(admission,token,candidate)
        if not revalidate():raise ClaimError(403,'NATIVE_BUILD_AUTHORITY_REVOKED')
        result=await dispatcher(admission,revalidate)
        if not revalidate():raise ClaimError(403,'NATIVE_BUILD_AUTHORITY_REVOKED')
        if result.get('stopped') is True and result.get('stop',{}).get('confirmedStopped') is True:return result
        if len(result.get('outputs',[]))!=2:raise ClaimError(503,'ACTUAL_NATIVE_EXECUTION_RECEIPTS_REQUIRED')
        return result
    from native_build_queue import NativeBuildQueue
    queue=NativeBuildQueue(root/'native-worker-jobs.sqlite',execute_queued)
    app.state.native_build_queue=queue
    app.add_event_handler('startup',queue.start)
    app.add_event_handler('shutdown',queue.close)
    @router.post('/api/v1/starli/grokbot1/claims/{intent_id}/execute')
    async def execute(intent_id:str,body:BuildCommand,request:Request):
        origins=request.headers.getlist('origin')
        if len(origins)!=1 or origins[0] not in allowed_origins or request.headers.get('sec-fetch-site','same-origin') not in ('same-origin','same-site','none'):raise ClaimError(403,'ORIGIN_DENIED')
        if request.headers.get('content-type','').split(';')[0]!='application/json':raise ClaimError(415,'JSON_REQUIRED')
        keys=request.headers.getlist('idempotency-key')
        if len(keys)!=1 or not re.fullmatch(r'[A-Za-z0-9_.:-]{8,160}',keys[0]):raise ClaimError(422,'IDEMPOTENCY_KEY_REQUIRED')
        if body.command!='Start building':raise ClaimError(422,'EXPLICIT_HUMAN_BUILD_COMMAND_REQUIRED')
        token=_token(request)
        session,uid,nav,j,issued,scope=fresh(token,intent_id)
        receipts=json.loads(j['receipts']);company=j['company_id'];room=receipts['doglovRoomId']
        key=keys[0];buildid=hashlib.sha256((intent_id+'|'+uid+'|'+key).encode()).hexdigest()
        fingerprint=hashlib.sha256(json.dumps({'command':body.command,'claimId':j['txn'],'claimRevision':nav['claimRevision']},sort_keys=True).encode()).hexdigest()
        # Serialize exact request retries without holding a transaction over worker I/O.
        import fcntl
        with open(root/('worker-'+buildid+'.lock'),'a') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise ClaimError(409,'BUILD_ADMISSION_IN_PROGRESS')
            with sqlite3.connect(dbpath) as db:
                old=db.execute('SELECT fingerprint,admission,result FROM builds WHERE id=?',(buildid,)).fetchone()
            if old and old[0]!=fingerprint:raise ClaimError(409,'BUILD_IDEMPOTENCY_CONFLICT')
            if old and old[2]:
                fresh(token,intent_id)
                if not validate_admission(json.loads(old[1]),token):raise ClaimError(403,'NATIVE_BUILD_AUTHORITY_REVOKED')
                queue.enqueue(buildid,json.loads(old[1]),token)
                return JSONResponse(json.loads(old[2]),status_code=202,headers={'Cache-Control':'no-store'})
            if old:admission=json.loads(old[1])
            else:
                workers=[]
                a=svc.ns.RbacAuthority(str(svc.p.authority))
                try:
                    for kind in ('FRONTEND','BACKEND'):
                        bot=str(uuid.uuid5(uuid.NAMESPACE_URL,'starli-native-worker:'+j['txn']+':'+kind))
                        def register(db,bot=bot,kind=kind):
                            db.execute("INSERT OR IGNORE INTO bots(id,kind,owner,name,purpose) VALUES(?,'company',?,?,?)",(bot,company,'DogLove '+kind.title()+' Worker','native-deterministic-'+kind.lower()))
                            db.execute("INSERT OR IGNORE INTO members VALUES(?,?,?,1,1,?,?)",(company,bot,'member','DogLove '+kind.title()+' Worker','bot'))
                            db.execute('INSERT INTO audit(company_id,actor,action,target,at) VALUES(?,?,?,?,?)',(company,uid,'native.worker.register',bot,svc.now()))
                        a.commit_authorized(uid,company,scope['membership_revision'],'bots.run',register)
                        child=svc.store.create(session,company,'nw-'+j['txn']+'-'+kind.lower(),'dm','private','DogLove '+kind.title()+' Worker',[],[bot])
                        workers.append({'botId':bot,'roomId':child['id'],'kind':kind,'companyId':company,'providerKind':'DETERMINISTIC_LOCAL'})
                finally:a.db.close()
                sent=svc.store.send(session,company,room,'nw-build-'+buildid,body.command,dispatch=[])
                message=sent['message']
                if message['speaker']!={'kind':'human','id':uid} or message['id']==receipts['originalPromptMessageId']:raise ClaimError(503,'NATIVE_HUMAN_MESSAGE_PROVENANCE')
                admission={'actor':{'userId':uid,'workspaceTenantId':company,'role':'CUSTOMER'},'companyId':company,'projectId':receipts['projectId'],'requestId':issued['requestId'],'intentId':intent_id,'claimId':j['txn'],'claimRevision':nav['claimRevision'],'sourceMessageId':message['id'],'originalPromptMessageId':receipts['originalPromptMessageId'],'parentRunId':'native-parent:'+buildid[:32],'parentRoomId':room,'authorizationRevision':scope['membership_revision'],'generation':1,'objective':svc._prompt(j),'idempotencyKey':key,'workers':workers}
                with sqlite3.connect(dbpath) as db:db.execute('INSERT INTO builds VALUES(?,?,?,NULL)',(buildid,fingerprint,json.dumps(admission)))
            def revalidate(candidate=None):return validate_admission(admission,token,candidate)
            if not revalidate():raise ClaimError(403,'NATIVE_BUILD_AUTHORITY_REVOKED')
            try:prepared=await dispatcher.prepare(admission,revalidate)
            except Exception as error:raise ClaimError(503,'NATIVE_GRAPH_ADMISSION_FAILED') from error
            if not prepared.get('graph',{}).get('graphId') or not prepared.get('machineryRunId'):raise ClaimError(503,'DURABLE_CANONICAL_GRAPH_REQUIRED')
            response={k:admission[k] for k in ('intentId','companyId','projectId','requestId','originalPromptMessageId','sourceMessageId','claimRevision')}
            response.update(roomId=room,channelRoomId=room,executionSourceMessageId=admission['sourceMessageId'],graphId=prepared['graph']['graphId'],machineryRunId=prepared['machineryRunId'],status='BUILD_ADMITTED',nativeExecutionCompleted=False,queueState='QUEUED',provider='DETERMINISTIC_LOCAL',modelCalls=0,executionClass='NATIVE_NONPRODUCTION')
            # Durable job insertion precedes 202. Replay repairs an admission/job crash window.
            queue.enqueue(buildid,admission,token)
            with sqlite3.connect(dbpath) as db:db.execute('UPDATE builds SET result=? WHERE id=?',(json.dumps(response),buildid))
            return JSONResponse(response,status_code=202,headers={'Cache-Control':'no-store'})

    @router.get('/api/v1/starli/orchestration/graphs/{graph_id}/progress')
    async def progress(graph_id:str,request:Request):
        token=_token(request)
        # Lookup returns no data to the caller until native claim/session authorization succeeds.
        with sqlite3.connect(dbpath) as db:
            found=db.execute("SELECT admission FROM builds WHERE json_extract(result,'$.graphId')=?",(graph_id,)).fetchone()
        if not found:raise ClaimError(404,'GRAPH_UNAVAILABLE')
        admission=json.loads(found[0])
        def revalidate(candidate=None):return validate_admission(admission,token,candidate)
        if not revalidate():raise ClaimError(403,'NATIVE_GRAPH_AUTHORITY_REVOKED')
        result=await dispatcher.progress(admission,revalidate,graph_id)
        buildid=hashlib.sha256((admission['intentId']+'|'+admission['actor']['userId']+'|'+admission['idempotencyKey']).encode()).hexdigest()
        result['nativeQueue']=queue.state(buildid)
        if queue.confirmed_stop(buildid):result['stopState']='STOPPED'
        terminal=queue.confirmed_quiescence(buildid)
        if terminal:result['stopState']='ALREADY_COMPLETED';result['terminalQuiescence']=terminal
        return JSONResponse(result,headers={'Cache-Control':'no-store'})
    @router.post('/api/v1/starli/orchestration/graphs/{graph_id}/stop')
    async def stop_graph(graph_id:str,request:Request):
        origins=request.headers.getlist('origin')
        if len(origins)!=1 or origins[0] not in allowed_origins or request.headers.get('sec-fetch-site','same-origin') not in ('same-origin','same-site','none'):raise ClaimError(403,'ORIGIN_DENIED')
        if request.headers.get('content-type','').split(';')[0]!='application/json':raise ClaimError(415,'JSON_REQUIRED')
        raw=await request.body()
        if len(raw)>4096:raise ClaimError(413,'STOP_BODY_TOO_LARGE')
        try:body=json.loads(raw or b'{}')
        except ValueError:raise ClaimError(422,'INVALID_STOP_BODY')
        if not isinstance(body,dict) or set(body)-{'reason','runId','machineryRunId'}:raise ClaimError(422,'INVALID_STOP_BODY')
        token=_token(request)
        with sqlite3.connect(dbpath) as db:
            found=db.execute("SELECT id,admission,result FROM builds WHERE json_extract(result,'$.graphId')=?",(graph_id,)).fetchone()
        if not found:raise ClaimError(404,'GRAPH_UNAVAILABLE')
        job_id,admission_text,accepted=found;admission=json.loads(admission_text);accepted=json.loads(accepted)
        # Native owner/tenant/claim validation happens BEFORE any cancellation control effect.
        def revalidate(candidate=None):return validate_admission(admission,token,candidate)
        if not revalidate():raise ClaimError(403,'NATIVE_GRAPH_AUTHORITY_REVOKED')
        for key in ('runId','machineryRunId'):
            if key in body and body[key]!=accepted['machineryRunId']:raise ClaimError(409,'RUN_ID_MISMATCH')
        state=queue.state(job_id)
        if state and state['state']=='STOPPED':
            return JSONResponse({'ok':True,'graphId':graph_id,'confirmedStopped':True,'disposition':'TERMINAL','stopState':'STOPPED'},headers={'Cache-Control':'no-store'})
        if state and state['state']=='SUCCEEDED':
            completed=queue.completed_result(job_id)
            terminal=await dispatcher.completed_quiescence(admission,revalidate,graph_id,completed) if completed else None
            if terminal and queue.record_quiescence(job_id,completed,terminal):
                return JSONResponse(terminal,status_code=200,headers={'Cache-Control':'no-store'})
            return JSONResponse({'ok':True,'graphId':graph_id,'confirmedStopped':False,'quiescent':False,'disposition':'STOP_PENDING','stopState':'STOP_PENDING','detail':'Completed job exit identities or canonical receipts remain unverified.'},status_code=202,headers={'Cache-Control':'no-store'})
        try:
            if (state and state['state']=='STOP_REQUESTED') or queue.reserve_queued_stop(job_id):
                result=await dispatcher.stop_queued(admission,revalidate,graph_id)
            else:
                result=await dispatcher.stop(admission,revalidate,graph_id)
        except (RuntimeError,asyncio.TimeoutError):
            result={'confirmedStopped':False,'disposition':'STOP_PENDING','detail':'Native cancellation confirmation unavailable.'}
        if result.get('confirmedStopped') is True:
            queue.confirm_stop(job_id,result)
            return JSONResponse({'ok':True,'graphId':graph_id,'stopState':'STOPPED',**result},status_code=200,headers={'Cache-Control':'no-store'})
        return JSONResponse({'ok':True,'graphId':graph_id,'stopState':'STOP_PENDING','confirmedStopped':False,'disposition':'STOP_PENDING','detail':result.get('detail','Awaiting actual native process exit confirmation.')},status_code=202,headers={'Cache-Control':'no-store'})
    app.include_router(router)
    return {'path':'/api/v1/starli/grokbot1/claims/{intentId}/execute','database':str(dbpath)}
