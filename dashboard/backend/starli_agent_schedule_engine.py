"""Private constants-only Schedule Trigger -> native broker adapter."""
import hashlib,json,re,secrets,datetime,time,math,threading
from dataclasses import dataclass,asdict,fields
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from starli_n8n_mcp.client import McpClient,BridgeError,validate,OWNED_WORKFLOW_TOOLS

TOOLS=OWNED_WORKFLOW_TOOLS|{'publish_workflow','unpublish_workflow'}
PROXY='http://control:8080/starli-agent-events'
def fail(code):raise BridgeError(code)
def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def zone(value):
    if type(value)is not str or len(value)>100 or '/' not in value and value!='UTC':fail('schedule_timezone_invalid')
    try:ZoneInfo(value)
    except (ZoneInfoNotFoundError,ValueError):fail('schedule_timezone_invalid')
    return value
def settings(tz):return dict(executionOrder='v1',saveManualExecutions=True,saveExecutionProgress=False,saveDataSuccessExecution='all',saveDataErrorExecution='all',executionTimeout=20,callerPolicy='none',timezone=zone(tz))

class ScheduleClient(McpClient):
    def bounded_settings(self,workflow_id,tz):
        args={'workflowId':workflow_id,'operations':[{'type':'setWorkflowSettings','settings':settings(tz)}]}
        if 'update_workflow' not in self.allowed:fail('mcp_tool_not_allowed')
        validate(args,self.schemas['update_workflow'])
        result=self._post('tools/call',{'name':'update_workflow','arguments':args})
        if type(result)is not dict or result.get('isError'):fail('schedule_settings_rejected')
        return self.content(result)

@dataclass(frozen=True)
class OwnedSchedule:
    triggerId:str;version:int;workflowId:str;name:str;definitionHash:str;versionId:str;nodeIds:dict;timeZone:str

def build(trigger_id,version,daily_time,tz,token,nonce=None):
    if type(trigger_id)is not str or not re.fullmatch('[A-Za-z0-9_-]{1,128}',trigger_id) or type(version)is not int or version<1:fail('schedule_binding_invalid')
    if type(daily_time)is not str or not re.fullmatch('(?:[01][0-9]|2[0-3]):[0-5][0-9]',daily_time):fail('schedule_time_invalid')
    zone(tz)
    if type(token)is not str or not re.fullmatch('[A-Za-z0-9_-]{43}',token):fail('schedule_callback_token_invalid')
    nonce=nonce or secrets.token_hex(16)
    if not re.fullmatch('[a-f0-9]{32}',nonce):fail('schedule_nonce_invalid')
    hour,minute=map(int,daily_time.split(':'));name='starli-agent-trigger-'+nonce
    schedule={'rule':{'interval':[{'field':'days','daysInterval':1,'triggerAtHour':hour,'triggerAtMinute':minute}]}}
    callback={'method':'POST','url':PROXY,'sendHeaders':True,'headerParameters':{'parameters':[{'name':'Authorization','value':'Bearer '+token}]},'sendBody':True,'contentType':'json','specifyBody':'keypair','bodyParameters':{'parameters':[{'name':'triggerId','value':trigger_id},{'name':'version','value':version},{'name':'eventId','value':'={{$execution.id}}'}]},'options':{'redirect':{'redirect':{'followRedirects':False}},'timeout':10000}}
    # ONLY this expression is generated. No model code/URL/expression is accepted.
    config=json.dumps({'type':'n8n-nodes-base.httpRequest','version':4.4,'config':{'name':'Starli broker','parameters':callback}},separators=(',',':'))
    config=config.replace('"={{$execution.id}}"',"expr('{{$execution.id}}')")
    code="import {workflow,node,trigger,expr} from '@n8n/workflow-sdk';\nconst daily=trigger("+json.dumps({'type':'n8n-nodes-base.scheduleTrigger','version':1.3,'config':{'name':'Starli daily','parameters':schedule}},separators=(',',':'))+");\nconst broker=node("+config+");\nexport default workflow("+json.dumps(nonce)+','+json.dumps(name)+").add(daily).add(broker).add(daily.output(0).to(broker));"
    return code,name,[('Starli daily','n8n-nodes-base.scheduleTrigger',1.3,schedule),('Starli broker','n8n-nodes-base.httpRequest',4.4,callback)]

class ScheduleEngine:
    def __init__(self,client,journal):self.client,self.journal=client,journal
    def call(self,name,args):return self.client.content(self.client.call(name,args))
    def prepare(self,trigger_id,version,dailyTime,timeZone,callbackToken):
        code,name,expected=build(trigger_id,version,dailyTime,timeZone,callbackToken)
        self.journal('CREATE_INTENT',{'triggerId':trigger_id,'version':version,'name':name})
        result=self.call('validate_workflow',{'code':code})
        if type(result)is not dict or result.get('valid')is not True:fail('schedule_validation_failed')
        created=self.call('create_workflow_from_code',{'code':code,'versionName':'Starli fixed native daily trigger'})
        wid=created.get('workflowId') if type(created)is dict else None
        if type(wid)is not str:fail('schedule_create_unknown')
        self.journal('ENGINE_CREATED',{'triggerId':trigger_id,'version':version,'workflowId':wid,'name':name})
        workflow=self.call('get_workflow_details',{'workflowId':wid}).get('workflow')
        self._initial(workflow,wid,name,expected)
        self.client.bounded_settings(wid,timeZone)
        workflow=self.call('get_workflow_details',{'workflowId':wid}).get('workflow')
        self._initial(workflow,wid,name,expected)
        if any(workflow['settings'].get(k)!=v for k,v in settings(timeZone).items()):fail('schedule_settings_changed')
        ref=OwnedSchedule(trigger_id,version,wid,name,self._fingerprint(workflow),workflow['versionId'],{n['name']:n['id'] for n in workflow['nodes']},timeZone)
        self.journal('PREPARED',asdict(ref));return ref
    @staticmethod
    def _fingerprint(w):return sha({k:w.get(k) for k in ('id','name','nodes','connections','settings','versionId')})
    @staticmethod
    def _initial(w,wid,name,expected):
        if type(w)is not dict or w.get('id')!=wid or w.get('name')!=name or w.get('active') is not False or w.get('activeVersionId') or w.get('isArchived')is not False:fail('schedule_ownership_changed')
        nodes=w.get('nodes');allowed={'id','name','type','typeVersion','parameters','position'}
        if type(nodes)is not list or len(nodes)!=2:fail('schedule_nodes_changed')
        for node,(label,typ,version,params) in zip(nodes,expected):
            if set(node)-allowed or (node.get('name'),node.get('type'),node.get('typeVersion'),node.get('parameters'))!=(label,typ,version,params):fail('schedule_node_changed')
        if w.get('connections')!={'Starli daily':{'main':[[{'node':'Starli broker','type':'main','index':0}]]}}:fail('schedule_topology_changed')
    def verify(self,ref,*,active=None):
        w=self.call('get_workflow_details',{'workflowId':ref.workflowId}).get('workflow')
        if type(w)is not dict or w.get('id')!=ref.workflowId or w.get('name')!=ref.name or w.get('isArchived')is not False or self._fingerprint(w)!=ref.definitionHash:fail('schedule_definition_changed')
        if {n['name']:n['id'] for n in w['nodes']}!=ref.nodeIds:fail('schedule_node_identity_changed')
        if active is not None and w.get('active') is not active:fail('schedule_activation_unconfirmed')
        if w.get('active') and w.get('activeVersionId')!=ref.versionId:fail('schedule_published_version_changed')
        return w
    def activate(self,ref):
        self.verify(ref,active=False);self.journal('PUBLISH_INTENT',asdict(ref))
        self.call('publish_workflow',{'workflowId':ref.workflowId,'versionId':ref.versionId})
        self.verify(ref,active=True);self.journal('ACTIVE',asdict(ref));return ref
    def pause(self,ref):
        self.verify(ref);self.journal('UNPUBLISH_INTENT',asdict(ref))
        self.call('unpublish_workflow',{'workflowId':ref.workflowId})
        self.verify(ref,active=False);self.journal('PAUSED',asdict(ref));return ref
    def run_test(self,ref):
        self.verify(ref)
        self.journal('TEST_INTENT',{'triggerId':ref.triggerId,'version':ref.version,'workflowId':ref.workflowId})
        result=self.call('execute_workflow',{'workflowId':ref.workflowId,'executionMode':'manual'})
        eid=result.get('executionId') if type(result)is dict else None
        if type(eid)is not str or not re.fullmatch('[A-Za-z0-9_-]{1,80}',eid):fail('schedule_test_execution_unknown')
        self.journal('TEST_STARTED',{'triggerId':ref.triggerId,'version':ref.version,'workflowId':ref.workflowId,'executionId':eid})
        return {'executionId':eid,'status':'STARTED'}
    def verify_event(self,ref,execution_id,*,approved_test_execution_id=None,minimum_started_at=None,max_age_seconds=300):
        if type(execution_id)is not str or not re.fullmatch('[A-Za-z0-9_-]{1,80}',execution_id):fail('schedule_execution_identity_invalid')
        self.verify(ref)
        result=self.call('get_workflow_execution',{'workflowId':ref.workflowId,'executionId':execution_id,'includeData':False})
        e=result.get('execution') if type(result)is dict else None
        if e is None:fail('schedule_execution_pending')
        if type(e)is not dict or str(e.get('id'))!=execution_id or e.get('workflowId')!=ref.workflowId:fail('schedule_execution_ownership_invalid')
        try:
            started=datetime.datetime.fromisoformat(e['startedAt'].replace('Z','+00:00'))
            if started.tzinfo is None:fail('schedule_execution_time_invalid')
            epoch=started.timestamp()
        except (KeyError,TypeError,ValueError,AttributeError):fail('schedule_execution_time_invalid')
        if minimum_started_at is not None:
            if type(minimum_started_at) not in (int,float) or not math.isfinite(minimum_started_at):fail('schedule_activation_time_invalid')
            if epoch<minimum_started_at:fail('schedule_execution_predates_activation')
        if epoch>time.time()+30:fail('schedule_execution_time_invalid')
        if max_age_seconds is not None:
            if type(max_age_seconds) not in (int,float) or not 0<max_age_seconds<=300:fail('schedule_execution_max_age_invalid')
            if time.time()-epoch>max_age_seconds:fail('schedule_execution_too_old')
        # Callback HTTP node may still be running. Receiver must defer until a
        # terminal success readback, never block HTTP response waiting on itself.
        allowed=e.get('mode')=='trigger' or e.get('mode')=='manual' and approved_test_execution_id==execution_id
        if not allowed:fail('schedule_execution_mode_not_approved')
        if e.get('status') in ('new','running','waiting','unknown'):fail('schedule_execution_pending')
        if e.get('status')!='success':fail('schedule_execution_failed')
        self.verify(ref)
        return {'workflowId':ref.workflowId,'executionId':execution_id,'triggerId':ref.triggerId,'version':ref.version,'verified':True}

def restore_ref(value):
    if type(value)is not dict or set(value)!={f.name for f in fields(OwnedSchedule)}:fail('schedule_registry_ref_invalid')
    if not re.fullmatch('starli-agent-trigger-[a-f0-9]{32}',str(value.get('name',''))) or not re.fullmatch('[a-f0-9]{64}',str(value.get('definitionHash',''))) or type(value.get('nodeIds'))is not dict or set(value['nodeIds'])!={'Starli daily','Starli broker'} or type(value.get('version'))is not int or value['version']<1:fail('schedule_registry_ref_invalid')
    zone(value['timeZone']);return OwnedSchedule(**value)

class JsonScheduleEngine:
    """Private registry facade. JSON refs come from server storage, never tool JSON."""
    def __init__(self,private_file,catalog,journal,*,client_factory=None):
        self.private_file,self.catalog,self.journal=private_file,catalog,journal
        self.factory=client_factory;self.engine=None;self.lock=threading.RLock()
    def _engine(self):
        with self.lock:
            if self.engine is None:
                client=self.factory() if self.factory else ScheduleClient.from_private_file(self.private_file,self.catalog,allowed_tools=TOOLS)
                client.initialize();self.engine=ScheduleEngine(client,self.journal)
            return self.engine
    def prepare(self,trigger_id,version,dailyTime,timeZone,callbackToken):return asdict(self._engine().prepare(trigger_id,version,dailyTime,timeZone,callbackToken))
    def activate(self,ref):return asdict(self._engine().activate(restore_ref(ref)))
    def pause(self,ref):return asdict(self._engine().pause(restore_ref(ref)))
    def run_test(self,ref):return self._engine().run_test(restore_ref(ref))
    def verify_event(self,ref,execution_id,**policy):return self._engine().verify_event(restore_ref(ref),execution_id,**policy)
