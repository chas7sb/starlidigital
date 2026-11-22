"""Reviewed orders/create -> original native chat, informational after activation.

HMAC authenticates raw bytes, not unsigned shop/topic headers. The opaque owned
subscription mapping plus connected-shop order read-back are both mandatory.
No synthetic JWT, Slack dependency, per-order approval, customer PII or refund.
"""
import starli_portable as _portable
import base64,hashlib,hmac,json,re,secrets
from .common import need,Fault,identifier,encoded,digest,public_error,envelope
from .business_config import shop_domain
from .n8n import EngineWorkflow

CREATE='''mutation StarliOrderHook($topic:WebhookSubscriptionTopic!,$input:WebhookSubscriptionInput!){webhookSubscriptionCreate(topic:$topic,webhookSubscription:$input){webhookSubscription{id topic uri includeFields} userErrors{field message}}}'''
LIST='''query StarliOwnedHooks{webhookSubscriptions(first:100){nodes{id topic uri includeFields} pageInfo{hasNextPage}}}'''
DELETE='''mutation StarliRemoveHook($id:ID!){webhookSubscriptionDelete(id:$id){deletedWebhookSubscriptionId userErrors{field message}}}'''
ORDER='''query StarliNewOrder($id:ID!){order(id:$id){id name totalPriceSet{shopMoney{amount currencyCode}}}}'''
TOPICS={'ORDERS_CREATE':'orders/create','APP_UNINSTALLED':'app/uninstalled'}

class ShopifyOrders:
    def __init__(self,gateway):self.gateway=gateway;self.store=gateway.store
    def application(self,ctx):
        app=self.gateway.connections.app_for(ctx,'shopify');need(app is not None,'SHOPIFY_APPLICATION_REQUIRED',409)
        return app
    async def readiness(self,ctx):
        registration=self.gateway.connections.app_resolver.registration('shopify')
        need(ctx.company in self.gateway.internal_companies or registration.get('ordersCreatePublicApproved') is True,'SHOPIFY_PUBLIC_APP_REVIEW_REQUIRED',409)
        await self.gateway.connections.verify(ctx,'shopify',['read_orders'])
        app=self.application(ctx)
        # Actual non-destructive API authorization proof. Public-app protected
        # order access can be rejected by Shopify while its review is pending.
        try:response=await self.gateway.providers.shopify(ctx,LIST,{})
        except Fault as error:raise Fault('SHOPIFY_WEBHOOK_ACCESS_OR_REVIEW_REQUIRED' if error.code in ('UPSTREAM_REJECTED','SHOPIFY_OPERATION_REJECTED') else 'SHOPIFY_WEBHOOK_ACCESS_UNAVAILABLE',409) from None
        need(type(response.get('webhookSubscriptions'))is dict,'SHOPIFY_WEBHOOK_ACCESS_REQUIRED',409)
        return True
    def status(self,db,ctx,workflow,version):
        source=db.execute('SELECT id,state,shop FROM sa_shopify_sources WHERE company=? AND workflow=? AND version=?',(ctx.company,workflow,version)).fetchone()
        if not source:return dict(status='NOT_SUBSCRIBED')
        return dict(status=source['state'],shopDomain=source['shop'],topic='orders/create')
    def is_notification(self,ctx,execution):
        with self.gateway.access(ctx) as db:
            row=self.gateway.row(db,ctx,'sa_executions',execution)
            ir=db.execute('SELECT ir FROM sa_versions WHERE company=? AND workflow=? AND version=?',(ctx.company,row['workflow'],row['version'])).fetchone()
            return json.loads(ir['ir'])['kind']=='shopify_new_order_chat'
    def token(self,source):return self.gateway.connections.vault.open(source['company'],source['id'],source['token'])['token']
    def callback(self,source):return _portable.public_url('/api/v1/starli/automations/shopify/webhooks/')+self.token(source)
    async def owned(self,ctx,uri,topic):
        data=await self.gateway.providers.shopify(ctx,LIST,{})
        rows=data['webhookSubscriptions'];need(not rows['pageInfo']['hasNextPage'],'SHOPIFY_HOOK_RECONCILIATION_LIMIT',409)
        found=[r for r in rows['nodes'] if r['topic']==topic and r['uri']==uri]
        need(len(found)<=1,'SHOPIFY_DUPLICATE_OWNED_SUBSCRIPTIONS',409)
        return found[0] if found else None
    async def activate(self,ctx,workflow,version):
        app=self.application(ctx);app_hash=digest(app.client_id)
        with self.gateway.access(ctx,'integrations.install') as db:
            row=self.gateway.row(db,ctx,'sa_workflows',workflow)
            need(row['version']==version and row['state']=='PROVISIONING','WORKFLOW_CHANGED',409)
            connection=self.gateway.connections.selected(ctx,'shopify',db)
            shop=shop_domain(connection['account'])
            source=db.execute('SELECT * FROM sa_shopify_sources WHERE company=? AND workflow=? AND version=?',(ctx.company,workflow,version)).fetchone()
            if not source:
                ident=identifier();token=secrets.token_hex(24);sealed=self.gateway.connections.vault.seal(ctx.company,ident,{'token':token})
                db.execute('INSERT INTO sa_shopify_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(ident,ctx.company,workflow,version,connection['id'],connection['revision'],shop,app_hash,hashlib.sha256(token.encode()).hexdigest(),sealed,'PROVISIONING',self.gateway.clock()))
                for topic in TOPICS:db.execute("INSERT INTO sa_shopify_subscriptions VALUES(?,?,NULL,'NEW',NULL)",(ident,topic))
                source=db.execute('SELECT * FROM sa_shopify_sources WHERE id=?',(ident,)).fetchone()
            need((source['connection'],source['shop'],source['app_hash'])==(connection['id'],shop,app_hash),'SHOPIFY_SOURCE_BINDING_CHANGED')
        uri=self.callback(source)
        for topic in TOPICS:
            with self.gateway.access(ctx,'integrations.install') as db:
                sub=db.execute('SELECT * FROM sa_shopify_subscriptions WHERE source=? AND topic=?',(source['id'],topic)).fetchone()
            existing=await self.owned(ctx,uri,topic)
            if not existing:
                need(sub['state'] not in ('INTENT','UNKNOWN'),'SHOPIFY_SUBSCRIPTION_OUTCOME_UNKNOWN',409)
                with self.gateway.access(ctx,'integrations.install') as db:db.execute("UPDATE sa_shopify_subscriptions SET state='INTENT',error=NULL WHERE source=? AND topic=?",(source['id'],topic))
                try:
                    fields=['id'] if topic=='ORDERS_CREATE' else ['id','myshopify_domain']
                    data=await self.gateway.providers.shopify(ctx,CREATE,{'topic':topic,'input':{'uri':uri,'includeFields':fields}})
                    result=data['webhookSubscriptionCreate']
                    need(not result['userErrors'] and result.get('webhookSubscription'),'SHOPIFY_SUBSCRIPTION_REJECTED',409)
                    existing=await self.owned(ctx,uri,topic)
                    need(existing is not None and existing['id']==result['webhookSubscription']['id'],'SHOPIFY_SUBSCRIPTION_UNVERIFIED',502)
                except BaseException as error:
                    with self.store.db() as db:db.execute("UPDATE sa_shopify_subscriptions SET state='UNKNOWN',error=? WHERE source=? AND topic=?",(public_error(error),source['id'],topic))
                    raise
            allowed={'id'} if topic=='ORDERS_CREATE' else {'id','myshopify_domain'}
            need(set(existing['includeFields'])==allowed,'SHOPIFY_HOOK_FIELDS_CHANGED')
            with self.gateway.access(ctx,'integrations.install') as db:db.execute("UPDATE sa_shopify_subscriptions SET provider_id=?,state='ACTIVE',error=NULL WHERE source=? AND topic=?",(existing['id'],source['id'],topic))
        with self.gateway.access(ctx,'integrations.install') as db:db.execute("UPDATE sa_shopify_sources SET state='ACTIVE' WHERE id=? AND company=?",(source['id'],ctx.company))
    def close_local(self,db,company,workflow,state='PAUSED'):
        db.execute('UPDATE sa_shopify_sources SET state=? WHERE company=? AND workflow=?',(state,company,workflow))
    async def remove(self,ctx,workflow):
        with self.gateway.access(ctx,'integrations.install') as db:
            self.close_local(db,ctx.company,workflow)
            sources=db.execute('SELECT * FROM sa_shopify_sources WHERE company=? AND workflow=?',(ctx.company,workflow)).fetchall()
        for source in sources:
            for topic in TOPICS:
                try:
                    _,_,shop,_=await self.gateway.connections.lease(ctx,'shopify')
                    need(shop==source['shop'],'SHOPIFY_CLEANUP_ACCOUNT_CHANGED')
                    owned=await self.owned(ctx,self.callback(source),topic)
                    if owned:
                        result=await self.gateway.providers.shopify(ctx,DELETE,{'id':owned['id']})
                        need(result['webhookSubscriptionDelete'].get('deletedWebhookSubscriptionId')==owned['id'],'SHOPIFY_HOOK_CLEANUP_UNVERIFIED',502)
                    with self.store.db() as db:db.execute("UPDATE sa_shopify_subscriptions SET state='REMOVED',error=NULL WHERE source=? AND topic=?",(source['id'],topic))
                except Exception as error:
                    with self.store.db() as db:db.execute("UPDATE sa_shopify_subscriptions SET state='CLEANUP_PENDING',error=? WHERE source=? AND topic=?",(public_error(error),source['id'],topic))
    async def receive(self,token,headers,body):
        need(type(token)is str and re.fullmatch('[a-f0-9]{48}',token) and isinstance(body,bytes) and len(body)<=65536,'SHOPIFY_EVENT_INVALID',422)
        headers={k.lower():v for k,v in headers.items()};topic=headers.get('x-shopify-topic')
        need(topic in TOPICS.values(),'SHOPIFY_TOPIC_DENIED')
        with self.store.db(readonly=True) as db:
            source=db.execute('SELECT * FROM sa_shopify_sources WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
            need(source is not None,'SHOPIFY_SOURCE_NOT_FOUND',404)
        # App secret is server configuration; no webhook body selects a company.
        resolver=self.gateway.connections.app_resolver
        registration=resolver.registration('shopify');secret=registration.get('clientSecret')
        need(type(secret)is str and source['app_hash']==digest(registration.get('clientId')),'SHOPIFY_APPLICATION_CHANGED')
        signature=headers.get('x-shopify-hmac-sha256','')
        need(type(signature)is str and re.fullmatch('[A-Za-z0-9+/=]{44}',signature),'SHOPIFY_SIGNATURE_INVALID')
        expected=base64.b64encode(hmac.new(secret.encode(),body,hashlib.sha256).digest()).decode()
        need(hmac.compare_digest(signature,expected),'SHOPIFY_SIGNATURE_INVALID')
        need(shop_domain(headers.get('x-shopify-shop-domain'))==source['shop'],'SHOPIFY_SHOP_MISMATCH')
        event=headers.get('x-shopify-event-id');need(type(event)is str and re.fullmatch('[A-Za-z0-9._:-]{1,180}',event),'SHOPIFY_EVENT_ID_REQUIRED',422)
        def unique(pairs):
            result={}
            for key,value in pairs:need(key not in result,'SHOPIFY_DUPLICATE_JSON_KEY',422);result[key]=value
            return result
        try:payload=json.loads(body,object_pairs_hook=unique)
        except ValueError:raise Fault('SHOPIFY_EVENT_JSON_INVALID',422) from None
        need(type(payload)is dict,'SHOPIFY_EVENT_INVALID',422)
        body_hash=hashlib.sha256(body).hexdigest()
        with self.store.db(readonly=True) as db:
            old=db.execute('SELECT * FROM sa_shopify_events WHERE company=? AND source=? AND event=? AND topic=?',(source['company'],source['id'],event,topic)).fetchone()
            if old:
                need(old['hash']==body_hash,'SHOPIFY_EVENT_REPLAY_CONFLICT',409)
                if old['execution'] is not None or old['state']=='UNINSTALLED':return {'accepted':True,'duplicate':True}
            if source['state']!='ACTIVE':return {'accepted':False,'ignored':True}
        if topic=='app/uninstalled':
            need(payload.get('myshopify_domain')==source['shop'],'SHOPIFY_UNINSTALL_SHOP_MISMATCH')
            with self.store.db() as db:
                db.execute('INSERT INTO sa_shopify_events VALUES(?,?,?,?,?,NULL,NULL,?,?)',(source['company'],source['id'],event,topic,body_hash,'UNINSTALLED',self.gateway.clock()))
                self.close_local(db,source['company'],source['workflow'],'REVOKED')
                db.execute("UPDATE sa_workflows SET state='PAUSED',revision=revision+1 WHERE id=? AND company=?",(source['workflow'],source['company']))
                db.execute("UPDATE sa_grants SET state='REVOKED' WHERE workflow=? AND company=?",(source['workflow'],source['company']))
                db.execute("UPDATE sa_connections SET state='REAUTH_REQUIRED' WHERE id=? AND company=? AND revision=?",(source['connection'],source['company'],source['connection_revision']))
                from .common import Context
                workflow=db.execute('SELECT * FROM sa_workflows WHERE id=? AND company=?',(source['workflow'],source['company'])).fetchone()
                if workflow:self.gateway.feedback.publish(db,Context(source['company'],workflow['actor'],workflow['binding'],None,workflow['bot'],workflow['room']),workflow['id'])
            return {'accepted':True,'uninstalled':True}
        need(type(payload.get('id'))is int and 0<payload['id']<10**30,'SHOPIFY_ORDER_ID_INVALID',422)
        order_id='gid://shopify/Order/'+str(payload['id'])
        ctx=self.gateway.worker_context(source['workflow'])
        need(ctx.company==source['company'] and ctx.workflow_version==source['version'],'SHOPIFY_SOURCE_VERSION_CHANGED')
        await self.gateway.connections.refresh_if_needed(ctx,'shopify')
        with self.gateway.access(ctx) as db:
            current=self.gateway.connections.selected(ctx,'shopify',db)
            need(current['id']==source['connection'] and current['account']==source['shop'],'SHOPIFY_CONNECTION_CHANGED')
            db.execute('INSERT OR IGNORE INTO sa_shopify_events VALUES(?,?,?,?,?,?,NULL,?,?)',(ctx.company,source['id'],event,topic,body_hash,order_id,'PENDING',self.gateway.clock()))
            old=db.execute('SELECT hash FROM sa_shopify_events WHERE company=? AND source=? AND event=? AND topic=?',(ctx.company,source['id'],event,topic)).fetchone();need(old['hash']==body_hash,'SHOPIFY_EVENT_REPLAY_CONFLICT',409)
        # Event headers are not HMAC-covered. Deduplicate the actual created
        # order as well, so changing Event-Id cannot duplicate its notification.
        execution=await self.gateway.ingest(ctx,source['workflow'],'shopify:orders_create:'+order_id,{'orderId':order_id})
        with self.gateway.access(ctx) as db:db.execute("UPDATE sa_shopify_events SET execution=?,state='QUEUED' WHERE company=? AND source=? AND event=? AND topic=?",(execution['id'],ctx.company,source['id'],event,topic))
        return {'accepted':True,'duplicate':False}
    async def advance(self,ctx,execution_id):
        await self.gateway.connections.refresh_if_needed(ctx,'shopify')
        with self.gateway.access(ctx) as db:
            row=self.gateway.row(db,ctx,'sa_executions',execution_id);workflow=self.gateway.row(db,ctx,'sa_workflows',row['workflow'])
            need(row['state']=='QUEUED' and workflow['state']=='ACTIVE','ORDER_NOTIFICATION_NOT_QUEUED',409)
            source=db.execute("SELECT * FROM sa_shopify_sources WHERE company=? AND workflow=? AND version=? AND state='ACTIVE'",(ctx.company,row['workflow'],row['version'])).fetchone();need(source is not None,'SHOPIFY_SOURCE_INACTIVE')
            need((workflow['actor'],workflow['binding'])==(ctx.actor,ctx.binding),'WORKFLOW_GRANT_REVOKED')
            current=self.gateway.connections.selected(ctx,'shopify',db);need((current['id'],current['account'])==(source['connection'],source['shop']),'SHOPIFY_CONNECTION_CHANGED')
            event=json.loads(row['input']);old=db.execute("SELECT * FROM sa_operations WHERE company=? AND execution=? AND kind='notify'",(ctx.company,execution_id)).fetchone()
            if old:
                need(old['state']=='RETRY_SAFE' and old['hash']==digest(event),'ORDER_NOTIFICATION_ALREADY_ATTEMPTED',409)
                operation=old['id'];db.execute("UPDATE sa_operations SET state='INTENT',error=NULL,updated=? WHERE id=? AND company=?",(self.gateway.clock(),operation,ctx.company))
            else:
                operation=identifier()
                db.execute('INSERT INTO sa_operations VALUES(?,?,?,?,?,?,?,?,?,?)',(operation,ctx.company,execution_id,'notify',digest(event),'INTENT',None,None,self.gateway.clock(),self.gateway.clock()))
            db.execute("UPDATE sa_executions SET state='RUNNING' WHERE id=? AND company=?",(execution_id,ctx.company));self.gateway.feedback.publish(db,ctx,execution_id)
            mapped=EngineWorkflow(workflow['engine_id'],workflow['engine_path'])
        try:
            # Mandatory connected-store read-back prevents replaying a valid
            # app HMAC from another shop with rewritten unsigned headers.
            data=await self.gateway.providers.shopify(ctx,ORDER,{'id':event['orderId']})
            order=data.get('order');need(order is not None and order['id']==event['orderId'],'SHOPIFY_ORDER_NOT_IN_BOUND_STORE',404)
            money=order['totalPriceSet']['shopMoney']
            summary=dict(orderId=order['id'],orderName=str(order['name'])[:200],amount=str(money['amount']),currency=str(money['currencyCode']),shopDomain=source['shop'])
            engine_receipt=await self.gateway.engine.execute_workflow(mapped,execution_id)
            with self.gateway.access(ctx) as db:
                current=self.gateway.row(db,ctx,'sa_executions',execution_id);active=self.gateway.row(db,ctx,'sa_workflows',row['workflow'])
                need(current['state']=='RUNNING' and active['state']=='ACTIVE','ORDER_NOTIFICATION_STOPPED')
                connection=self.gateway.connections.selected(ctx,'shopify',db);need((connection['id'],connection['account'])==(source['connection'],source['shop']),'SHOPIFY_CONNECTION_CHANGED')
                origin=self.gateway.feedback.origin(db,ctx.company,'execution',execution_id,row['version']);need(origin is not None,'AUTOMATION_ORIGIN_REQUIRED')
                receipt=dict(status='VERIFIED',operation='shopify_order_chat_notification',resourceId=origin['feedback_message'],verifiedAt=self.gateway.clock(),orderSummary=summary)
                db.execute("UPDATE sa_executions SET state='COMPLETED',engine_execution=?,receipt=?,updated=? WHERE id=? AND company=?",(engine_receipt['id'],encoded(receipt),self.gateway.clock(),execution_id,ctx.company))
                db.execute("UPDATE sa_operations SET state='SUCCEEDED',result=?,updated=? WHERE id=? AND company=?",(encoded({'messageId':origin['feedback_message']}),self.gateway.clock(),operation,ctx.company))
                db.execute("UPDATE sa_jobs SET state='DONE' WHERE company=? AND execution=?",(ctx.company,execution_id))
                self.gateway.audit(db,ctx,'order.notification.completed',execution_id)
                return self.gateway.execution_dto(ctx,self.gateway.row(db,ctx,'sa_executions',execution_id),db)
        except BaseException as error:
            with self.store.db() as db:
                db.execute("UPDATE sa_executions SET state='FAILED',error=?,updated=? WHERE id=? AND company=?",(public_error(error),self.gateway.clock(),execution_id,ctx.company))
                db.execute("UPDATE sa_operations SET state='FAILED',error=? WHERE id=? AND company=?",(public_error(error),operation,ctx.company))
                db.execute("UPDATE sa_jobs SET state='DEAD',error=? WHERE company=? AND execution=?",(public_error(error),ctx.company,execution_id))
                self.gateway.feedback.cleanup(db,ctx.company,execution_id)
            raise
