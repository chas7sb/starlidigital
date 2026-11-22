"""Private generic executor. Mandatory native standing and worker gates."""
import asyncio
from .compiler import need,verify_definition
from starli_n8n_mcp.lifecycle import fixed_settings_operations
class ConnectorExecutor:
    def __init__(self,compiler,*,fence,worker_ready,journal):
        self.compiler,self.fence,self.worker_ready,self.journal=compiler,fence,worker_ready,journal
    async def _fence(self,ctx,bound,phase):
        await self.compiler.refresh_bindings(ctx,bound)
        need(await self.fence(ctx,phase,bound.review_hash,bound.effects,bound.bindings) is True,'company_flow_standing_review_required')
    def call(self,name,args):return self.compiler.call(name,args)
    async def prepare(self,ctx,bound,reviewed_hash):
        need(reviewed_hash==bound.review_hash,'company_flow_review_changed')
        await self._fence(ctx,bound,'prepare')
        need(await self.worker_ready(ctx,bound.review_hash,bound.effects,tuple(bound.compiled.types)) is True,'company_worker_policy_not_ready')
        self.journal('CREATE_INTENT',{'companyId':ctx.company,'name':bound.compiled.workflow_name,'reviewHash':bound.review_hash})
        result=await asyncio.to_thread(self.call,'create_workflow_from_code',{'code':bound.compiled.code,'versionName':'Company reviewed connector graph'})
        need(type(result)is dict and type(result.get('workflowId'))is str,'company_workflow_create_unknown')
        wid=result['workflowId'];self.journal('ENGINE_CREATED',{'companyId':ctx.company,'workflowId':wid,'name':bound.compiled.workflow_name})
        need(result.get('autoAssignedCredentials')==[],'company_workflow_auto_credentials_denied')
        details=await asyncio.to_thread(self.call,'get_workflow_details',{'workflowId':wid});verify_definition(details,wid,bound,phase='created')
        await self._fence(ctx,bound,'configure')
        await asyncio.to_thread(self.call,'update_workflow',{'workflowId':wid,'operations':fixed_settings_operations()})
        details=await asyncio.to_thread(self.call,'get_workflow_details',{'workflowId':wid});proof=verify_definition(details,wid,bound)
        self.journal('PREPARED',{'companyId':ctx.company,'workflowId':wid,'reviewHash':bound.review_hash,'proof':proof})
        return {'companyId':ctx.company,'reviewHash':bound.review_hash,'proof':proof}
    async def run(self,ctx,bound,ref):
        need(ref['companyId']==ctx.company and ref['reviewHash']==bound.review_hash,'company_flow_scope_changed')
        await self._fence(ctx,bound,'dispatch')
        need(await self.worker_ready(ctx,bound.review_hash,bound.effects,tuple(bound.compiled.types)) is True,'company_worker_policy_not_ready')
        wid=ref['proof']['workflowId'];details=await asyncio.to_thread(self.call,'get_workflow_details',{'workflowId':wid});verify_definition(details,wid,bound,proof=ref['proof'])
        # No native credentials/raw n8n admin call is exposed by this private API.
        await self._fence(ctx,bound,'dispatch_commit')
        self.journal('EXECUTION_INTENT',{'companyId':ctx.company,'workflowId':wid,'reviewHash':bound.review_hash})
        started=await asyncio.to_thread(self.call,'execute_workflow',{'workflowId':wid,'executionMode':'manual'})
        need(type(started)is dict and type(started.get('executionId'))is str,'company_execution_unknown')
        receipt={'companyId':ctx.company,'workflowId':wid,'executionId':started['executionId'],'reviewHash':bound.review_hash,'status':'STARTED'}
        self.journal('EXECUTION_STARTED',receipt);return receipt
    async def receipt(self,ctx,bound,ref,started):
        need(ref['companyId']==ctx.company and ref['reviewHash']==bound.review_hash and started['companyId']==ctx.company and started['workflowId']==ref['proof']['workflowId'] and started['reviewHash']==bound.review_hash,'company_execution_scope_changed')
        await self._fence(ctx,bound,'receipt')
        details=await asyncio.to_thread(self.call,'get_workflow_details',{'workflowId':started['workflowId']});verify_definition(details,started['workflowId'],bound,proof=ref['proof'])
        result=await asyncio.to_thread(self.call,'get_workflow_execution',{'workflowId':started['workflowId'],'executionId':started['executionId'],'includeData':False})
        e=result.get('execution') if type(result)is dict else None
        if e is None:return {'status':'PENDING'}
        need(str(e.get('id'))==started['executionId'] and e.get('workflowId')==started['workflowId'] and e.get('mode')=='manual','company_execution_identity_changed')
        status={'success':'COMPLETED','error':'FAILED','crashed':'UNKNOWN','canceled':'CANCELED'}.get(e.get('status'),'PENDING')
        # Completion means engine processing, not independently verified provider
        # business receipt; provider evidence needs a reviewed receipt verifier.
        return {'status':status,'engineProcessingVerified':status=='COMPLETED','externalBusinessReceiptVerified':False}

