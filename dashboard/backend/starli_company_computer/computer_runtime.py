"""One read-only authenticated Computer tool in the native channel Pi loop."""
import hashlib,json,re
from dataclasses import dataclass
from bridge import NativeRuntime
from company_messaging.authority import require
from company_messaging.internal_send import NativeToolScope
from company_bot_runtime.router import mount


@dataclass(frozen=True)
class ComputerCall:
    native_scope:NativeToolScope
    operation_id:str
    tool_name:str='computer.status'


class ComputerRuntime(NativeRuntime):
    def __init__(self,*args,computer_status=None,computer_display_note=None,**kwargs):
        self.computer_status=computer_status
        self.computer_display_note=computer_display_note
        super().__init__(*args,**kwargs)
        with self.store.db()as db:
            db.execute('CREATE TABLE IF NOT EXISTS cr_computer_calls(run TEXT,call TEXT,operation TEXT UNIQUE,fingerprint TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT,PRIMARY KEY(run,call))')

    def computer_fence(self,session,ctx,selection,turn,control=False):
        require(self.authorize_run(session,ctx.company_id,ctx.bot_id,ctx.room_id,turn),403,'NATIVE_COMPUTER_RUN_DENIED')
        self.authority.require_member(ctx.actor_id,ctx.company_id,permission='computer.view')
        self.authority.require_member(ctx.bot_id,ctx.company_id,permission='computer.view')
        if control:
            require(ctx.visibility=='public',403,'SHARED_COMPUTER_PUBLIC_AUDIENCE_REQUIRED')
            self.authority.require_member(ctx.actor_id,ctx.company_id,permission='computer.control')
            self.authority.require_member(ctx.bot_id,ctx.company_id,permission='computer.control')
        return True

    def computer_local(self,db,ctx,control=False):
        self.local_fence(db,ctx)
        authority=object.__new__(type(self.authority));authority.db=db
        authority.require_member(ctx.actor_id,ctx.company_id,permission='computer.view')
        authority.require_member(ctx.bot_id,ctx.company_id,permission='computer.view')
        if control:
            require(ctx.visibility=='public',403,'SHARED_COMPUTER_PUBLIC_AUDIENCE_REQUIRED')
            authority.require_member(ctx.actor_id,ctx.company_id,permission='computer.control')
            authority.require_member(ctx.bot_id,ctx.company_id,permission='computer.control')

    async def tool_catalogue(self,session,ctx,selection,turn):
        tools=[]
        try:
            self.computer_fence(session,ctx,selection,turn)
            if self.computer_status:tools.append({'name':'computer.status','description':'Read the enrolled company Computer status using current authenticated company/run authority. No input, provisioning or control.',
                 'parameters':{'type':'object','properties':{},'additionalProperties':False},'effect':'read'})
            if self.computer_display_note:
                self.computer_fence(session,ctx,selection,turn,True)
                tools.append({'name':'computer.display_note','description':'Display a plain-text note in the company guest desktop fixed note window. Literal text only, no shell or typing into other apps. Requires the current authorized bot control lease; never takes over human control. Returns a verified frame receipt.',
                    'parameters':{'type':'object','properties':{'text':{'type':'string','minLength':1,'maxLength':500}},'required':['text'],'additionalProperties':False},'effect':'write'})
        except Exception:pass
        return tools

    async def execute_tool(self,session,ctx,selection,turn,value):
        require(isinstance(value,dict)and set(value)=={'toolCallId','name','args'}and value['name']in ('computer.status','computer.display_note'),403,'COMPUTER_TOOL_ARGUMENTS_DENIED')
        control=value['name']=='computer.display_note';args=value['args']
        if control:
            require(self.computer_display_note is not None and isinstance(args,dict)and set(args)=={'text'}and isinstance(args['text'],str)and 1<=len(args['text'])<=500 and not any((ord(c)<32 and c not in '\n\t')or ord(c)==127 for c in args['text']),403,'COMPUTER_NOTE_ARGUMENTS_DENIED')
        else:require(self.computer_status is not None and args=={},403,'COMPUTER_TOOL_ARGUMENTS_DENIED')
        call=value['toolCallId'];require(isinstance(call,str)and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',call),422,'INVALID_TOOL_CALL_ID')
        self.computer_fence(session,ctx,selection,turn,control)
        operation=hashlib.sha256(json.dumps([ctx.company_id,turn,call]).encode()).hexdigest()
        fingerprint=hashlib.sha256(json.dumps([value['name'],args],sort_keys=True).encode()).hexdigest()
        with self.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
            self.computer_local(db,ctx,control)
            old=db.execute('SELECT state,receipt,fingerprint FROM cr_computer_calls WHERE run=? AND call=?',(turn,call)).fetchone()
            if old:
                require(old['fingerprint']==fingerprint,409,'COMPUTER_OPERATION_COLLISION')
                require(old['state']=='COMPLETED',409,'COMPUTER_CALL_UNCERTAIN_NO_RETRY')
                return self.result(json.loads(old['receipt']))
            row=db.execute('SELECT message FROM cr_turns WHERE id=?',(turn,)).fetchone()
            native=NativeToolScope(ctx.company_id,ctx.room_id,ctx.bot_id,turn,call,ctx.actor_id,ctx.actor_binding,ctx,row['message'])
            require(self.authorize_native(db,native),403,'COMPUTER_NATIVE_BINDING_DENIED')
            db.execute('INSERT INTO cr_computer_calls VALUES(?,?,?,?,?,NULL)',(turn,call,operation,fingerprint,'INTENT'))
        async def authorize():return self.computer_fence(session,ctx,selection,turn,control)
        try:
            bound=ComputerCall(native,operation,value['name'])
            receipt=await self.computer_display_note(bound,args['text'],authorize)if control else await self.computer_status(bound,authorize)
            await authorize()
            required={'companyId','actorUserId','runId','assistantMessageId','operationId','computerId','state','memoryBytes','receiptSha256'}
            if control:required|={'viewerId','epoch','noteSha256','frameSha256'}
            require(isinstance(receipt,dict)and set(receipt)==required,503,'COMPUTER_RECEIPT_INVALID')
            require((receipt['companyId'],receipt['actorUserId'],receipt['runId'],receipt['assistantMessageId'],receipt['operationId'])==(ctx.company_id,ctx.actor_id,turn,native.assistant_message_id,operation),503,'COMPUTER_RECEIPT_BINDING_MISMATCH')
            require(receipt['memoryBytes']==1073741824 and isinstance(receipt['computerId'],str)and len(receipt['computerId'])<=128 and receipt['state']in (('DISPLAYED',)if control else ('RUNNING','STOPPED','STARTING','STOPPING'))and re.fullmatch('[a-f0-9]{64}',receipt['receiptSha256']),503,'COMPUTER_RECEIPT_INVALID')
            if control:
                require(isinstance(receipt['viewerId'],str)and 1<=len(receipt['viewerId'])<=180 and type(receipt['epoch'])is int and receipt['epoch']>=0 and receipt['noteSha256']==hashlib.sha256(args['text'].encode()).hexdigest()and re.fullmatch('[a-f0-9]{64}',receipt['frameSha256']),503,'COMPUTER_DISPLAY_RECEIPT_INVALID')
            with self.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
                self.computer_local(db,ctx,control)
                require(self.authorize_native(db,native),403,'COMPUTER_NATIVE_BINDING_DENIED')
                db.execute('UPDATE cr_computer_calls SET state=?,receipt=? WHERE run=? AND call=?',('COMPLETED',json.dumps(receipt),turn,call))
            return self.result(receipt)
        except BaseException:
            with self.store.db()as db:db.execute("UPDATE cr_computer_calls SET state='UNKNOWN' WHERE run=? AND call=? AND state='INTENT'",(turn,call))
            raise

    def result(self,receipt):
        return {'outcome':'settled','result':{'content':[{'type':'text','text':json.dumps({'status':'COMPLETED','computer':receipt})}]}}

    def tool_event(self,session,ctx,selection,turn,value):
        control=value.get('name')=='computer.display_note'
        self.computer_fence(session,ctx,selection,turn,control)
        require(value.get('name')in ('computer.status','computer.display_note')and value.get('status')in ('started','succeeded','failed','uncertain'),403,'COMPUTER_EVENT_INVALID')
        with self.store.access(session,ctx.company_id,ctx.room_id)as(db,_,_):
            self.computer_local(db,ctx,control)
            if value['status']=='succeeded':
                row=db.execute('SELECT state FROM cr_computer_calls WHERE run=? AND call=?',(turn,value['toolCallId'])).fetchone()
                require(row is not None and row['state']=='COMPLETED',503,'COMPUTER_SUCCESS_WITHOUT_RECEIPT')
            require(isinstance(value.get('toolCallId'),str)and re.fullmatch(r'[A-Za-z0-9_.:-]{1,180}',value['toolCallId']),422,'INVALID_TOOL_CALL_ID')
            safe={'version':'starli.tool.v1','toolCallId':value['toolCallId'],'publicToolName':value['name'],
                  'status':{'started':'RUNNING','succeeded':'COMPLETED','failed':'FAILED','uncertain':'UNCERTAIN'}[value['status']]}
            db.execute("INSERT INTO cr_events(turn,type,state)VALUES(?,'tool.lifecycle',?)",(turn,json.dumps(safe)))


def install(app,providers,bots,authority,memory_factory,runner,computer_status=None,computer_display_note=None):
    store=getattr(app.state,'company_messaging',None);session=getattr(app.state,'company_messaging_session',None)
    require(store is not None and callable(session),503,'AGENT7_NATIVE_MOUNT_REQUIRED')
    require(not hasattr(app.state,'company_messaging_start_turn'),409,'NATIVE_INGRESS_ALREADY_INSTALLED')
    runtime=ComputerRuntime(store,providers,bots,authority,memory_factory,runner,computer_status=computer_status,computer_display_note=computer_display_note)
    app.state.company_messaging_start_turn=runtime.start_turn
    app.state.company_messaging_authorize_run=runtime.authorize_native
    mount(app,runtime,session);app.add_event_handler('startup',runtime.startup)
    return runtime
