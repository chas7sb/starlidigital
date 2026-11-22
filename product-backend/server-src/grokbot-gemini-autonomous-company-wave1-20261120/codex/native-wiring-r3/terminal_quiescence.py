"""Read-only completed-job quiescence proof; never sends a signal or app request."""
import hashlib,hmac,json,os,sqlite3
from pathlib import Path
def identity_exited(identity):
    pid=identity.get('pid');start=identity.get('startTicks')
    if not isinstance(pid,int) or isinstance(pid,bool) or pid<=0 or not isinstance(start,str) or not start.isdigit():return None
    try:
        raw=(Path('/proc')/str(pid)/'stat').read_text()
        current=raw[raw.rfind(')')+2:].split()[19]
        if current==start:return None
        return {'pid':pid,'startTicks':start,'confirmedExited':True,'observation':'PID_REUSED','signalRequested':None}
    except FileNotFoundError:return {'pid':pid,'startTicks':start,'confirmedExited':True,'observation':'ABSENT','signalRequested':None}
    except (OSError,IndexError):return None
def payload(receipt):
    fields=['issuerId','graphId','companyId','projectId','requestId','roomId','callId','taskId','childRunId','authorizationRevision','generation','artifactDigest','executionClass','agencyReceiptId','executionRequestId','issuedAt','expiresAt']
    return '|'.join(['TRUSTED_EXECUTOR_RECEIPT_V2']+[str(receipt.get(k,'')) for k in fields]).encode()
async def verify_completed_quiescence(dispatcher,admission,revalidate,graph_id,completed):
    try:
        if completed['admission']!=admission:return None
        result=completed['result']
        if result.get('graphId')!=graph_id or result.get('stopped') or result.get('executionClass')!='NATIVE_NONPRODUCTION' or len(result.get('outputs',[]))!=2:return None
        executor=result.get('_executorExit',{})
        if executor.get('operation')!='execute' or executor.get('graphId')!=graph_id or executor.get('companyId')!=admission['companyId'] or executor.get('requestId')!=admission['requestId'] or executor.get('exitCode')!=0 or executor.get('waitConfirmed') is not True:return None
        executor_exit=identity_exited(executor)
        if not executor_exit:return None
        runtime=Path(dispatcher.root)/'native-worker-runtime';artifact_root=(runtime/'artifacts').resolve()
        key=(runtime/'.receipt-key').read_bytes()
        if len(key)<32:return None
        workers=[];output_by_package={}
        worker_hash=hashlib.sha256(Path(__file__).with_name('deterministic-native-worker.mjs').read_bytes()).hexdigest()
        for output in result['outputs']:
            artifact=Path(output['artifactPath']).resolve()
            if artifact_root not in artifact.parents:return None
            data=artifact.read_bytes();digest=hashlib.sha256(data).hexdigest();native=json.loads(data)
            receipt=output['receipt']
            if output['artifactDigest']!=digest or receipt.get('artifactDigest')!=digest or native!=output['result']:return None
            if receipt.get('executionClass')!='NATIVE_NONPRODUCTION' or not hmac.compare_digest(hmac.new(key,payload(receipt),hashlib.sha256).hexdigest(),receipt.get('hmac','')):return None
            for field,wanted in [('companyId',admission['companyId']),('projectId',admission['projectId']),('requestId',admission['requestId']),('graphId',graph_id)]:
                if receipt.get(field)!=wanted or native.get('scope',{}).get(field)!=wanted:return None
            execution=native.get('nativeExecution',{})
            if execution.get('workerSourceHash')!=worker_hash or execution.get('processExitCode')!=0 or execution.get('executionClass')!='NATIVE_NONPRODUCTION':return None
            worker_exit=identity_exited(execution.get('processIdentity',{}))
            if not worker_exit or native['worker']['pid']!=worker_exit['pid']:return None
            worker_exit.update(exitCode=0,kind='WORKER',botId=native['worker']['botId'])
            workers.append(worker_exit)
            package=native['scope']['workPackageId']
            if package in output_by_package:return None
            output_by_package[package]=(output,native,receipt,digest)
        if len({w['pid'] for w in workers})!=2:return None
        if not revalidate():return None
        canonical=await dispatcher.request(admission,revalidate,operation='terminalInspect',graph_id=graph_id)
        graph=canonical['graph'];run=canonical['run'];plan=canonical['plan']
        if canonical['snapshot']['state']!='COMPLETED' or plan['status']!='SUCCEEDED' or plan['id']!=graph_id or plan['tenantId']!=admission['companyId'] or plan['ownerId']!=admission['actor']['userId']:return None
        if run['id']!=result['machineryRunId'] or run['id']!=graph['machinery_run_id'] or run['ownerId']!=admission['actor']['userId'] or run['tenantId']!=admission['companyId']:return None
        if len(run['selections'])!=1 or run['selections'][0]['orchestrationPlanId']!=graph_id or set(run['selections'][0]['workPackageIds'])!=set(output_by_package):return None
        links={link['task_id']:link for link in canonical['links']}
        if set(links)!=set(output_by_package) or len(canonical['packages'])!=2:return None
        with sqlite3.connect('file:'+str(runtime/'canonical.sqlite')+'?mode=ro',uri=True) as db:
            for bound in canonical['packages']:
                pkg,request,agency=bound['pkg'],bound['request'],bound['receipt'];entry=output_by_package.get(pkg['id'])
                if not entry:return None
                output,native,receipt,digest=entry;link=links[pkg['id']]
                if pkg['status']!='SUCCEEDED' or request['state']!='SUCCEEDED' or agency['state']!='SUCCEEDED':return None
                if request['tenantId']!=admission['companyId'] or request['projectId']!=admission['projectId'] or request['requestedBy']!=admission['actor']['userId']:return None
                if pkg['executionRequestId']!=request['id'] or agency['executionRequestId']!=request['id'] or receipt['executionRequestId']!=request['id'] or pkg['lastExecutionReceiptId']!=agency['id'] or receipt['agencyReceiptId']!=agency['id']:return None
                if agency.get('capabilityResultHash')!=digest or (agency.get('attempt',0)!=request.get('attempt',0)):return None
                if not link['server_provenance_verified'] or link['artifact_digest']!=digest or receipt['callId']!=link['call_id'] or receipt['childRunId']!=link['child_run_id']:return None
                if link['child_company_id']!=admission['companyId'] or link['bot_id']!=native['worker']['botId'] or link['child_room_id']!=native['worker']['roomId']:return None
                row=db.execute("SELECT payload FROM records WHERE collection='customer-capability-audits' AND id=? AND owner=?",(agency['capabilityReceiptId'],admission['companyId'])).fetchone()
                if not row:return None
                audit=json.loads(row[0])
                if audit['status']!='SUCCEEDED' or audit['resultHash']!=digest or audit['requestId']!=request['id'] or audit['projectId']!=admission['projectId']:return None
            controlrow=db.execute("SELECT payload FROM records WHERE collection='native-live-controls' AND id=? AND owner=?",(graph_id,admission['companyId'])).fetchone()
        if not controlrow:return None
        control=json.loads(controlrow[0])
        if control['phase']!='CLOSED' or control['nodePid']!=executor['pid'] or str(control['startTicks'])!=executor['startTicks'] or control['requestId']!=admission['requestId'] or control['ownerId']!=admission['actor']['userId']:return None
        # Recheck identities and current authority after all awaited source reads.
        if not revalidate() or not identity_exited(executor) or any(not identity_exited(w) for w in workers):return None
        executor_exit.update(exitCode=0,kind='EXECUTOR')
        return {'ok':True,'graphId':graph_id,'machineryRunId':run['id'],'disposition':'TERMINAL','outcome':'ALREADY_COMPLETED','stopState':'ALREADY_COMPLETED','confirmedStopped':False,'quiescent':True,'confirmedQuiescent':True,'processOutcomes':workers+[executor_exit],'canonicalState':'COMPLETED','queueState':'SUCCEEDED','signalRequested':None,'jobResultHash':completed['resultHash'],'generatedAppTouched':False,'vmOrQuotaReleaseClaimed':False}
    except Exception:return None
