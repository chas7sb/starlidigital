"""Installed connector discovery, separate from verified native execution."""
import json
from pathlib import Path

def install(app,runtime):
    from fastapi import APIRouter,Depends
    from starli_company_tools.core import ToolSpec,obj
    gateway=app.state.starli_automations
    metadata=json.loads(Path(__file__).with_name('catalog.json').read_text())
    assert metadata['version']=='starli.connector-catalog.v1'
    assert len({c['id'] for c in metadata['connectors']})==len(metadata['connectors'])

    def catalog(ctx):
        with gateway.access(ctx,'integrations.run'):pass
        # Static bundled metadata is never evidence of an enabled executor.
        connectors=[{**c,'executionStatus':'NOT_EXECUTABLE',
                     'operations':[{**op,'executionStatus':'NOT_EXECUTABLE'} for op in c['operations']]} for c in metadata['connectors']]
        active=getattr(app.state,'starli_company_n8n',None)
        if active is not None and hasattr(active,'deployment_policy'):
            rules=active.deployment_policy.rules()
            with gateway.access(ctx) as db:
                stored={row[0] for row in db.execute("SELECT type FROM ecc_connections WHERE company=? AND state='STORED_NOT_VERIFIED'",(ctx.company,))}
            for connector in connectors:
                if connector['id'] not in rules:continue
                needs=connector.get('credentialTypes',[])
                status='AVAILABLE' if not needs or connector['id']=='n8n-nodes-base.httpRequest' or set(needs)&stored else 'CONNECTION_REQUIRED'
                connector['executionStatus']=status
                connector['source']='NATIVE_COMPANY_GATEWAY'
                for op in connector['operations']:op['executionStatus']=status
        kernel=getattr(app.state,'starli_workflow_kernel',None)
        if kernel is not None:
            operations=[]
            for name,operation in kernel.operations.items():
                operations.append({'id':name,'title':name.replace('.',' ').replace('_',' ').title(),
                    'description':operation.description,'executionStatus':'AVAILABLE',
                    'toolName':'company_workflow_'+name.replace('.','_'),
                    'requiresConnection':False,'inputSchema':kernel.detail(name)['inputSchema']})
            connectors.insert(0,{'id':'starli.workflow-tools','title':'Workflow tools',
                'description':'Implemented data and control operations. No external account is required.',
                'kind':'transform','credentialTypes':[],'operations':operations,
                'executionStatus':'AVAILABLE','source':'NATIVE_VERIFIED_EXECUTOR'})
        smtp=getattr(app.state,'starli_company_smtp',None)
        if smtp is not None:
            has_conn=smtp.has_active_connection(ctx.company)
            smtp_status='AVAILABLE' if has_conn else 'CONNECTION_REQUIRED'
            connectors.insert(0,{
                'id':'starli.company-smtp',
                'title':'Company SMTP Email',
                'description':'Company-owned TLS/STARTTLS SMTP credentials for human-reviewed outbound email.',
                'kind':'email',
                'credentialTypes':['smtp'],
                'operations':[
                    {'id':'smtp.connections_list','title':'List SMTP Connections','description':'List active company SMTP connections without exposing secrets or usernames.','executionStatus':smtp_status,'toolName':'company_smtp_connections_list','requiresConnection':False},
                    {'id':'smtp.draft_prepare','title':'Prepare Email Draft','description':'Prepare a bound email draft with recipients (To/Cc/Bcc), subject, text and sanitized HTML.','executionStatus':smtp_status,'toolName':'company_smtp_draft_prepare','requiresConnection':True},
                    {'id':'smtp.approval_request','title':'Request Human Approval','description':'Submit draft for explicit human review of exact sender, recipients and content.','executionStatus':smtp_status,'toolName':'company_smtp_approval_request','requiresConnection':True},
                    {'id':'smtp.send_status','title':'Check SMTP Send Status','description':'Inspect approval decision and idempotent SMTP send receipt (SMTP acceptance only).','executionStatus':smtp_status,'toolName':'company_smtp_send_status','requiresConnection':True},
                    {'id':'smtp.send','title':'Send Approved Email','description':'Send an explicitly approved email once via TLS/STARTTLS SMTP without retrying uncertain outcomes.','executionStatus':smtp_status,'toolName':'company_smtp_send','requiresConnection':True},
                ],
                'executionStatus':smtp_status,
                'source':'NATIVE_VERIFIED_EXECUTOR',
            })
        return {'version':'starli.integration-catalog.v1','companyId':ctx.company,
                'connectors':connectors,'executionPolicy':'Only explicitly available native operations can execute.'}

    router=APIRouter(prefix='/api/v1/starli/companies/{company}/automations/integrations')
    @router.get('/catalog')
    def read_catalog(company:str,principal=Depends(app.state.company_messaging_session)):
        return catalog(gateway.context(principal,company))
    app.include_router(router)

    def context(bound):
        bound.check()
        return gateway.context(bound.session,bound.context.company_id,bound.context.room_id,bound.context.bot_id,bound.native_scope)
    def search(bound,args):
        data=catalog(context(bound));query=args['query'].casefold().strip();items=[]
        for connector in data['connectors']:
            matches=[op for op in connector['operations'] if query in (op['title']+' '+op.get('description','')).casefold()]
            if query in (connector['title']+' '+connector['description']).casefold() or matches:
                items.append({**connector,'operations':(matches or connector['operations'])[:12]})
            if len(items)>=args.get('limit',10):break
        bound.check()
        return {'version':data['version'],'companyId':data['companyId'],'items':items,
                'notice':'Installed metadata does not imply that an executor or account connection is available.'}
    runtime.company_tools.register(ToolSpec('company_integrations_catalog_search',
        'Search installed connector/action metadata and verified account-free workflow tools. NOT_EXECUTABLE entries cannot run; do not claim them connected or implemented.',
        obj({'query':{'type':'string','minLength':1,'maxLength':160},'limit':{'type':'integer','minimum':1,'maximum':20}},['query']),
        'read','starli-integration-catalog',search,'integrations.run'))
    app.state.starli_integration_catalog=catalog
    return {'connectors':len(metadata['connectors']),'metadataOnly':True}
