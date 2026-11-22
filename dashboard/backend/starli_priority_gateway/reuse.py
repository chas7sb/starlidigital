"""Explicit human reuse of the already-consented company Slack account."""
import json,types
from starli_automations.common import need
from starli_engine_connections.schema import sha

def install(app):
    service=app.state.starli_engine_connections;native=service.gateway
    with native.store.db()as db:db.execute('CREATE TABLE IF NOT EXISTS ecc_sources(connection_id TEXT PRIMARY KEY,company TEXT NOT NULL,provider TEXT NOT NULL,provider_id TEXT NOT NULL,provider_revision INTEGER NOT NULL)')
    def source_fence(ctx,handle):
        with native.access(ctx)as db:
            source=db.execute('SELECT * FROM ecc_sources WHERE connection_id=? AND company=?',(handle,ctx.company)).fetchone()
            if source:
                current=db.execute('SELECT * FROM sa_connections WHERE company=? AND id=?',(ctx.company,source['provider_id'])).fetchone()
                need(current and current['provider']==source['provider'] and current['state']=='CONNECTED' and current['revision']==source['provider_revision'],'COMPANY_SOURCE_RECONNECT_REQUIRED',409)
    service.source_fence=source_fence
    original_resolve=service.resolve
    async def resolve(self,ctx,handle,credential_type,expected_revision):
        source_fence(ctx,handle);result=await original_resolve(ctx,handle,credential_type,expected_revision);source_fence(ctx,handle);return result
    service.resolve=types.MethodType(resolve,service)
    original_get=service.get
    def get(self,ctx,ident):
        result=original_get(ctx,ident)
        result['canReuseConnectedSlack']=result['credentialType']=='slackApi'and result['status']=='REQUESTED'and native.connections.ready(ctx,'slack')
        return result
    service.get=types.MethodType(get,service)
    from fastapi import APIRouter,Depends,Request
    route=next(r for r in app.router.routes if getattr(r,'path','').endswith('/engine-connections/requests/{ident}/submit'))
    router=APIRouter(prefix='/api/v1/starli/companies/{company}/engine-connections',route_class=type(route))
    @router.post('/requests/{ident}/reuse-slack')
    async def reuse(company:str,ident:str,request:Request,principal=Depends(app.state.company_messaging_session)):
        payload=await request.json();need(type(payload)is dict and set(payload)=={'conversationId','expectedRevision'},'CONNECTION_FORM_INVALID',422)
        ctx=native.context(principal,company,payload['conversationId'])
        with native.access(ctx,'integrations.install')as db:
            row=dict(service.row(db,ctx,ident));need(row['type']=='slackApi'and row['state']=='REQUESTED'and row['revision']==payload['expectedRevision'],'CONNECTION_REVISION_OR_STATE_CHANGED',409)
        provider_id,provider_revision,account,token=await native.connections.lease(ctx,'slack')
        with native.access(ctx,'integrations.install')as db:
            current=native.connections.selected(ctx,'slack',db)
            need(current['id']==provider_id and current['revision']==provider_revision,'COMPANY_SOURCE_RECONNECT_REQUIRED',409)
            db.execute('INSERT INTO ecc_sources VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET provider_id=excluded.provider_id,provider_revision=excluded.provider_revision',(ident,ctx.company,'slack',provider_id,provider_revision))
        schema=await service.api.schema('slackApi')
        result=await service.submit(ctx,ident,{'expectedRevision':row['revision'],'schemaHash':sha(schema),'displayName':'Company Slack','data':{'accessToken':token}})
        token=None
        changed=False
        with native.access(ctx,'integrations.install')as db:
            current=native.connections.selected(ctx,'slack',db)
            if current['id']!=provider_id or current['revision']!=provider_revision:
                db.execute("UPDATE ecc_connections SET state='REVOKED',revision=revision+1 WHERE id=?",(ident,));changed=True
        need(not changed,'COMPANY_SOURCE_RECONNECT_REQUIRED',409)
        return result
    app.include_router(router)
