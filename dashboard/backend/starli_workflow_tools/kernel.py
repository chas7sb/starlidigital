import asyncio
import hashlib
import inspect
import json
import time
from dataclasses import dataclass, field as dataclass_field
from urllib.parse import urlsplit
import ipaddress

from . import data
from .data import WorkflowFault, need, bounded, MAX_BYTES


def obj(properties, required=None):
    return dict(type='object', properties=properties, required=list(properties) if required is None else required,
                additionalProperties=False)


STR = {'type':'string', 'maxLength':MAX_BYTES}
FIELD = {'type':'string', 'minLength':1, 'maxLength':160}
ROWS = {'type':'array', 'maxItems':1000, 'items':{'type':'object', 'additionalProperties':True}}
JSON = {}
CONDITION = obj({'field':FIELD, 'operator':{'type':'string','enum':['exists','eq','ne','gt','gte','lt','lte','contains','startsWith']},
                 'value':JSON}, ['field','operator'])


def valid(value, schema):
    if not schema: return True  # bounded() separately enforces JSON types and limits.
    if 'enum' in schema and value not in schema['enum']: return False
    kind = schema.get('type')
    if kind == 'object':
        properties = schema.get('properties', {})
        return (type(value) is dict and set(schema.get('required', [])) <= set(value)
                and (schema.get('additionalProperties', False) or set(value) <= set(properties))
                and all(valid(v, properties[k]) for k,v in value.items() if k in properties))
    if kind == 'array':
        return type(value) is list and schema.get('minItems',0) <= len(value) <= schema.get('maxItems',1000) and all(valid(v,schema['items']) for v in value)
    if kind == 'string': return type(value) is str and schema.get('minLength',0) <= len(value) <= schema.get('maxLength',MAX_BYTES)
    if kind == 'integer': return type(value) is int and schema.get('minimum',0) <= value <= schema.get('maximum',2**53-1)
    if kind == 'boolean': return type(value) is bool
    return False


@dataclass(frozen=True)
class Execution:
    company: str
    actor: str
    binding: str
    room: str
    bot: str
    run: str
    assistant: str
    call: str
    deadline: float
    native: object = dataclass_field(default=None, repr=False, compare=False)


@dataclass(frozen=True)
class Operation:
    name: str
    schema: dict
    handler: object = dataclass_field(repr=False)
    pure: bool = True
    effect: str = 'read'
    permission: str = 'tools.dispatch'
    description: str = ''


class Kernel:
    def __init__(self, authorize, publish, *, drive=None, public_http=None, scheduler=None, journal=None,
                 monotonic=time.monotonic):
        need(callable(authorize) and callable(publish), 'NATIVE_AUTHORIZATION_AND_EVENTS_REQUIRED')
        self.authorize, self.publish, self.clock = authorize, publish, monotonic
        self.drive, self.public_http, self.scheduler, self.journal = drive, public_http, scheduler, journal
        self.slots = asyncio.Semaphore(4)
        self.operations = {}
        self.unavailable = {'javascript.sandbox':'ISOLATED_WORKER_NOT_BOUND', 'python.sandbox':'ISOLATED_WORKER_NOT_BOUND',
                            'engine.raw_workflow':'RAW_WORKFLOW_AND_ADMIN_API_FORBIDDEN'}
        self._install()

    def add(self, name, schema, fn, **options):
        need(name not in self.operations, 'DUPLICATE_OPERATION')
        self.operations[name] = Operation(name, schema, fn, **options)

    def _install(self):
        self.add('json.parse', obj({'text':STR}), data.parse_json)
        self.add('json.stringify', obj({'value':JSON}), data.stringify_json)
        self.add('csv.parse', obj({'text':STR,'delimiter':{'type':'string','enum':[',',';','\t']}}, ['text']), data.parse_csv)
        self.add('csv.stringify', obj({'rows':ROWS,'fields':{'type':'array','minItems':1,'maxItems':100,'items':FIELD}}), data.stringify_csv)
        self.add('xml.parse', obj({'text':STR}), data.parse_xml)
        self.add('rows.transform', obj({'rows':ROWS,'select':{'type':'array','minItems':1,'maxItems':100,'items':FIELD},
                                      'rename':{'type':'object','additionalProperties':True},'set':{'type':'object','additionalProperties':True}}, ['rows']), data.transform)
        self.add('rows.filter', obj({'rows':ROWS,'conditions':{'type':'array','minItems':1,'maxItems':20,'items':CONDITION},
                                   'mode':{'type':'string','enum':['all','any']}}, ['rows','conditions']), data.filter_rows)
        self.add('rows.sort', obj({'rows':ROWS,'keys':{'type':'array','minItems':1,'maxItems':5,'items':obj({'field':FIELD,'direction':{'type':'string','enum':['asc','desc']}})}}), data.sort_rows)
        self.add('rows.group', obj({'rows':ROWS,'field':FIELD}), data.group_rows)
        self.add('rows.merge', obj({'left':ROWS,'right':ROWS,'mode':{'type':'string','enum':['concat','inner','left']},'key':FIELD}, ['left','right']), data.merge_rows)
        self.add('items.split', obj({'items':{'type':'array','maxItems':1000,'items':JSON},'size':{'type':'integer','minimum':1,'maximum':1000}}), data.split_rows)
        self.add('flow.condition', obj({'row':{'type':'object','additionalProperties':True},'condition':CONDITION}), lambda a: {'matches':data.condition(a['row'],a['condition'])})
        self.add('flow.map', obj({'items':{'type':'array','maxItems':50,'items':JSON},'operation':FIELD,
                                 'inputParameter':FIELD,'arguments':{'type':'object','additionalProperties':True}}), self._map, pure=False)
        self.add('flow.wait', obj({'milliseconds':{'type':'integer','minimum':0,'maximum':2000}}), self._wait, pure=False)
        if self.drive:
            self.add('drive.read_text',obj({'resourceId':FIELD,'version':{'type':'integer','minimum':1}}),self._drive_read,pure=False,permission='read')
        else: self.unavailable['drive.read_text']='CANONICAL_DRIVE_ADAPTER_NOT_BOUND'
        if self.drive and self.journal:
            self.add('drive.write_text',obj({'title':{'type':'string','minLength':1,'maxLength':240},'text':STR,'parentId':FIELD},['title','text']),self._drive_write,pure=False,effect='write',permission='files.manage')
        else: self.unavailable['drive.write_text']='CANONICAL_DRIVE_AND_DURABLE_JOURNAL_REQUIRED'
        if self.public_http:
            self.add('http.public_get',obj({'url':{'type':'string','minLength':1,'maxLength':2048}}),self._http,pure=False)
        else: self.unavailable['http.public_get']='EXISTING_SSRF_POLICY_ADAPTER_NOT_BOUND'
        if self.scheduler and self.journal:
            self.add('schedule.prepare',obj({'operation':FIELD,'arguments':{'type':'object','additionalProperties':True},
                                           'intervalSeconds':{'type':'integer','minimum':60,'maximum':86400},'timezone':FIELD}),self._schedule,pure=False,effect='write')
        else: self.unavailable['schedule.prepare']='DURABLE_NATIVE_SCHEDULER_NOT_BOUND'

    def check(self, ctx):
        need(isinstance(ctx,Execution) and all(type(getattr(ctx,n)) is str and 0<len(getattr(ctx,n))<=256
             for n in ('company','actor','binding','room','bot','run','assistant','call')), 'CANONICAL_NATIVE_SCOPE_REQUIRED')
        need(ctx.deadline>self.clock(), 'DEADLINE_EXCEEDED')
        need(self.authorize(ctx) is True, 'NATIVE_GRANT_REVOKED')

    async def emit(self,ctx,operation,phase,**safe):
        self.check(ctx)
        value=dict(version=1,companyId=ctx.company,conversationId=ctx.room,botId=ctx.bot,runId=ctx.run,
                   assistantMessageId=ctx.assistant,toolCallId=ctx.call,operationId=operation,phase=phase,**safe)
        value['eventKey']=hashlib.sha256(json.dumps([ctx.company,ctx.run,ctx.call,operation,phase,safe],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        result=self.publish(ctx,value)
        if inspect.isawaitable(result):await result
        self.check(ctx)

    def detail(self,name):
        if name not in self.operations:
            need(name in self.unavailable,'OPERATION_NOT_FOUND')
            return dict(operationId=name,availability='UNAVAILABLE',reason=self.unavailable[name])
        op=self.operations[name]
        return dict(operationId=name,inputSchema=op.schema,effect=op.effect,permission=op.permission,
                    availability='CALLABLE_WHEN_NATIVE_REGISTERED',accountRequired=False,limits=dict(inputBytes=MAX_BYTES,outputBytes=MAX_BYTES))

    async def execute(self,ctx,name,args):
        self.check(ctx)
        need(name in self.operations,'OPERATION_UNAVAILABLE')
        op=self.operations[name]
        bounded(args)
        need(valid(args,op.schema),'OPERATION_ARGUMENTS_INVALID')
        acquired=False
        try:
            await asyncio.wait_for(self.slots.acquire(),timeout=min(0.05,max(0.001,ctx.deadline-self.clock())))
            acquired=True
            async with asyncio.timeout(min(15, max(0.001,ctx.deadline-self.clock()))):
                await self.emit(ctx,name,'started')
                self.check(ctx)
                result=op.handler(args) if op.pure else op.handler(ctx,args)
                if inspect.isawaitable(result):result=await result
                self.check(ctx)
                bounded(result)
                response=dict(status='COMPLETED',operationId=name,value=result)
                # Match the existing native ToolSpec result serializer, including
                # ASCII escaping and envelope overhead, before completion.
                need(len(json.dumps(response,allow_nan=False).encode())<=MAX_BYTES,'OUTPUT_LIMIT')
                await self.emit(ctx,name,'completed')
                return response
        except TimeoutError:
            raise WorkflowFault('CAPACITY_OR_DEADLINE_LIMIT') from None
        except asyncio.CancelledError:
            raise  # Never emit a false completed/physically-stopped receipt.
        except WorkflowFault as error:
            try:await self.emit(ctx,name,'failed',code=error.code)
            except Exception:pass
            raise
        except Exception:raise WorkflowFault('OPERATION_FAILED') from None
        finally:
            if acquired:self.slots.release()

    async def _map(self,ctx,args):
        op=self.operations.get(args['operation'])
        need(op is not None and op.pure and op.effect=='read','PURE_REGISTERED_MAP_OPERATION_REQUIRED')
        key=args['inputParameter']
        need(key in op.schema['properties'] and key not in args['arguments'],'MAP_PARAMETER_INVALID')
        results=[]
        for index,item in enumerate(args['items']):
            self.check(ctx)
            payload={**args['arguments'],key:item}
            need(valid(payload,op.schema),'MAP_ARGUMENTS_INVALID')
            result=op.handler(payload)
            bounded(result)
            results.append(result)
            bounded(results)
            await self.emit(ctx,'flow.map','progress',completedItems=index+1,totalItems=len(args['items']))
            await asyncio.sleep(0)
        return results

    async def _wait(self,ctx,args):
        end=self.clock()+args['milliseconds']/1000
        while self.clock()<end:
            self.check(ctx)
            await asyncio.sleep(min(0.05,end-self.clock()))
        self.check(ctx)
        return dict(waitedMilliseconds=args['milliseconds'])

    async def _drive_read(self,ctx,args):
        result=self.drive.read_text(ctx,args['resourceId'],args['version'],MAX_BYTES,lambda:self.check(ctx))
        result=await result if inspect.isawaitable(result) else result
        self.check(ctx)
        need(type(result) is dict and result.get('resourceId')==args['resourceId'] and result.get('version')==args['version'], 'DRIVE_BINDING_CHANGED')
        return bounded(result)

    async def _write_once(self,ctx,name,args,action):
        self.check(ctx)
        fingerprint=hashlib.sha256(json.dumps([ctx.company,ctx.actor,ctx.binding,ctx.room,name,args],sort_keys=True,separators=(',',':')).encode()).hexdigest()
        operation=hashlib.sha256((ctx.company+'\0'+ctx.run+'\0'+ctx.call+'\0'+name).encode()).hexdigest()
        claim=self.journal.begin(ctx,operation,fingerprint)
        if inspect.isawaitable(claim):claim=await claim
        if claim.get('dispatch') is not True:
            need(claim.get('state')=='SETTLED','WRITE_OUTCOME_UNCERTAIN')
            self.check(ctx)
            return claim['receipt']
        attempted=False
        try:
            self.check(ctx)
            attempted=True
            value=action(operation)
            value=await value if inspect.isawaitable(value) else value
            self.check(ctx)
            bounded(value)
            result=self.journal.finish(ctx,operation,fingerprint,value)
            if inspect.isawaitable(result):await result
            return value
        except BaseException:
            result=self.journal.unknown(ctx,operation,fingerprint) if attempted else self.journal.failed(ctx,operation,fingerprint)
            if inspect.isawaitable(result):await result
            raise

    async def _drive_write(self,ctx,args):
        need('/' not in args['title'] and '\\' not in args['title'] and args['title'].strip()
             and all(ord(c)>=32 and ord(c)!=127 for c in args['title']),'CANONICAL_FILE_TITLE_REQUIRED')
        async def write(op):
            value=self.drive.write_text(ctx,args,op,lambda:self.check(ctx))
            value=await value if inspect.isawaitable(value) else value
            need(type(value) is dict and set(value)=={'companyId','resourceId','version'}
                 and value['companyId']==ctx.company and type(value['resourceId']) is str
                 and type(value['version']) is int and value['version']>0,'CANONICAL_DRIVE_RECEIPT_REQUIRED')
            return value
        return await self._write_once(ctx,'drive.write_text',args,write)

    async def _http(self,ctx,args):
        url=args['url']
        try:
            p=urlsplit(url)
            need(p.scheme=='https' and p.hostname and p.port in (None,443) and not p.username and not p.password and not p.fragment,'PUBLIC_HTTPS_REQUIRED')
            try:ipaddress.ip_address(p.hostname)
            except ValueError:pass
            else:raise WorkflowFault('IP_LITERAL_DENIED')
            need(p.hostname!='localhost' and '.' in p.hostname and not p.hostname.endswith(('.local','.localhost','.internal')),'PUBLIC_HOST_REQUIRED')
        except ValueError:raise WorkflowFault('URL_INVALID') from None
        self.check(ctx)
        async with asyncio.timeout(10):
            value=await self.public_http.get(ctx,url,max_bytes=MAX_BYTES,timeout=10,authorize=lambda:self.check(ctx))
        self.check(ctx)
        need(type(value) is dict and value.get('finalURL')==url and type(value.get('body')) is str
             and type(value.get('status')) is int and 200<=value['status']<300,'HTTP_POLICY_OR_RESPONSE_DENIED')
        data.text(value['body'])
        return dict(status=value['status'],body=value['body'],contentType=str(value.get('contentType',''))[:100],untrustedExternalData=True)

    async def _schedule(self,ctx,args):
        from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
        op=self.operations.get(args['operation'])
        need(op is not None and op.pure and valid(args['arguments'],op.schema),'REVIEWED_PURE_SCHEDULE_OPERATION_REQUIRED')
        try:
            if args['timezone']!='UTC':ZoneInfo(args['timezone'])
        except (ZoneInfoNotFoundError,ValueError):raise WorkflowFault('TIMEZONE_INVALID') from None
        async def create(operation):
            value=self.scheduler.prepare(ctx,args,operation,lambda:self.check(ctx))
            value=await value if inspect.isawaitable(value) else value
            need(type(value) is dict and value.get('state')=='DRAFT' and value.get('nextDue') is None
                 and type(value.get('scheduleId')) is str and type(value.get('revision')) is int,'DURABLE_SCHEDULE_DRAFT_UNVERIFIED')
            return value
        return await self._write_once(ctx,'schedule.prepare',args,create)
