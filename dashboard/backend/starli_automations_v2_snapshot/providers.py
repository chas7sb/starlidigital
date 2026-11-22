"""Native reviewed provider operations; n8n never receives business tokens.

These adapters are unverified until a configured OAuth account passes the real
identity and operation acceptance checks. All destinations derive from verified
connection accounts, never an arbitrary model URL.
"""
from decimal import Decimal
import re
from .common import need, Fault

ORDER_QUERY = '''query StarliOrder($id:ID!){order(id:$id){id currencyCode totalRefundedSet{shopMoney{amount}} totalReceivedSet{shopMoney{amount}} transactions(first:20){id kind status gateway amountSet{shopMoney{amount currencyCode}}} refunds{id note transactions(first:20){nodes{id status kind amountSet{shopMoney{amount currencyCode}}}}}}}'''
REFUND_MUTATION = '''mutation StarliRefund($input:RefundInput!){refundCreate(input:$input){refund{id note transactions(first:20){nodes{id status kind amountSet{shopMoney{amount currencyCode}}}}} userErrors{field message}}}'''

class ReviewedProviders:
    def __init__(self,connections,transport_for):
        self.connections,self.transport_for=connections,transport_for
    def supports(self,provider,capability):
        return (provider,capability) in {('shopify','orders.get'),('shopify','orders.refund'),('zendesk','support.ticket.create'),('zendesk','support.ticket.get'),('slack','slack.approval.notify')}
    async def connection(self,ctx,provider,scope):
        ident,revision,account,token=await self.connections.lease(ctx,provider)
        with self.connections.gateway.access(ctx) as db:
            row=self.connections.selected(ctx,provider,db)
            need(row['id']==ident and row['revision']==revision,'CONNECTION_CHANGED')
            scopes=__import__('json').loads(row['scopes']);need(scope in scopes,'PROVIDER_SCOPE_REQUIRED')
        return ident,revision,account,token
    def check_connection(self,ctx,provider,ident,revision):
        with self.connections.gateway.access(ctx) as db:
            row=self.connections.selected(ctx,provider,db)
            need(row['id']==ident and row['revision']==revision,'CONNECTION_CHANGED')
    async def shopify(self,ctx,query,variables,scope='read_orders',fence=lambda:None):
        ident,revision,account,token=await self.connection(ctx,'shopify',scope)
        need(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,61}\.myshopify\.com',account),'VERIFIED_SHOP_DOMAIN_REQUIRED')
        fence();self.check_connection(ctx,'shopify',ident,revision)
        transport=self.transport_for('https://'+account)
        _,response=await transport.request('POST','/admin/api/2026-10/graphql.json',headers={'X-Shopify-Access-Token':token},body={'query':query,'variables':variables})
        need(type(response)is dict and not response.get('errors') and type(response.get('data'))is dict,'SHOPIFY_OPERATION_REJECTED',502)
        return response['data']
    def order_id(self,value):
        need(re.fullmatch(r'gid://shopify/Order/[1-9][0-9]{0,29}',value),'EXACT_SHOPIFY_ORDER_ID_REQUIRED',422)
        return value
    async def lookup(self,ctx,config,event):
        need(config['orderPlatform']=='shopify','ORDER_ADAPTER_UNAVAILABLE',503)
        data=await self.shopify(ctx,ORDER_QUERY,{'id':self.order_id(event['orderId'])})
        order=data.get('order');need(order is not None,'ORDER_NOT_FOUND',404)
        need(order['id']==event['orderId'] and order['currencyCode']==event['currency'],'ORDER_BINDING_CHANGED')
        _,_,account,_=await self.connections.lease(ctx,'shopify')
        need(account==event['store'],'ORDER_STORE_CHANGED')
        received=Decimal(order['totalReceivedSet']['shopMoney']['amount']);refunded=Decimal(order['totalRefundedSet']['shopMoney']['amount'])
        transactions=[t for t in order['transactions'] if t['kind'] in ('SALE','CAPTURE') and t['status']=='SUCCESS' and t['gateway']==event['paymentProvider']]
        need(len(transactions)==1,'PAYMENT_TRANSACTION_AMBIGUOUS',409)
        return dict(orderId=order['id'],store=account,currency=order['currencyCode'],paymentProvider=transactions[0]['gateway'],eligible=Decimal(event['amount'])<=received-refunded)
    async def perform(self,ctx,config,event,decision,operation,fence):
        if decision=='ticket':return await self.ticket(ctx,config,event,operation,fence)
        need(decision=='refund' and config['orderPlatform']=='shopify','REFUND_ADAPTER_UNAVAILABLE',503)
        # Re-read immediately before write; reject already-refunded orders.
        await self.lookup(ctx,config,event)
        data=await self.shopify(ctx,ORDER_QUERY,{'id':self.order_id(event['orderId'])},fence=fence)
        order=data['order'];marker='Starli operation '+operation
        prior=[r for r in order['refunds'] if r.get('note')==marker]
        need(not prior,'REFUND_ALREADY_PROCESSED',409)
        received=Decimal(order['totalReceivedSet']['shopMoney']['amount']);refunded=Decimal(order['totalRefundedSet']['shopMoney']['amount'])
        need(Decimal(event['amount'])<=received-refunded,'REFUND_ALREADY_PROCESSED',409)
        parents=[t for t in order['transactions'] if t['kind'] in ('SALE','CAPTURE') and t['status']=='SUCCESS' and t['gateway']==event['paymentProvider']]
        need(len(parents)==1,'PAYMENT_TRANSACTION_AMBIGUOUS',409)
        body=dict(orderId=event['orderId'],currency=event['currency'],notify=False,allowOverRefunding=False,note=marker,
                  transactions=[dict(orderId=event['orderId'],parentId=parents[0]['id'],gateway=event['paymentProvider'],kind='REFUND',amount=event['amount'])])
        result=await self.shopify(ctx,REFUND_MUTATION,{'input':body},'write_orders',fence)
        output=result['refundCreate'];need(not output.get('userErrors') and output.get('refund'),'REFUND_PROVIDER_REJECTED',502)
        refund_id=output['refund']['id']
        # A provider mutation response alone is not a verified payment receipt.
        check=await self.shopify(ctx,ORDER_QUERY,{'id':event['orderId']})
        refunds=[r for r in check['order']['refunds'] if r['id']==refund_id and r.get('note')==marker]
        need(len(refunds)==1,'REFUND_RECEIPT_UNVERIFIED',502)
        transactions=refunds[0]['transactions']['nodes']
        need(len(transactions)==1 and transactions[0]['status']=='SUCCESS' and transactions[0]['kind']=='REFUND','REFUND_PAYMENT_PENDING',502)
        money=transactions[0]['amountSet']['shopMoney'];need(Decimal(money['amount'])==Decimal(event['amount']) and money['currencyCode']==event['currency'],'REFUND_RECEIPT_MISMATCH',502)
        return dict(resourceId=refund_id,verified=True)
    async def ticket(self,ctx,config,event,operation,fence):
        need(config['ticketPlatform']=='zendesk','TICKET_ADAPTER_UNAVAILABLE',503)
        ident,revision,account,token=await self.connection(ctx,'zendesk','tickets:write')
        need(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,61}\.zendesk\.com',account),'VERIFIED_ZENDESK_DOMAIN_REQUIRED')
        transport=self.transport_for('https://'+account)
        fence();self.check_connection(ctx,'zendesk',ident,revision)
        _,result=await transport.request('POST','/api/v2/tickets.json',headers={'Authorization':'Bearer '+token},body={'ticket':dict(subject='Refund request review',comment=dict(body='Review order '+event['orderId']+' for '+event['amount']+' '+event['currency'],public=False),external_id=operation)})
        ticket=result.get('ticket',{});need(type(ticket.get('id'))is int,'TICKET_RECEIPT_UNVERIFIED',502)
        _,verified=await transport.request('GET','/api/v2/tickets/'+str(ticket['id'])+'.json',headers={'Authorization':'Bearer '+token})
        need(verified.get('ticket',{}).get('external_id')==operation,'TICKET_RECEIPT_MISMATCH',502)
        return dict(resourceId=str(ticket['id']),verified=True)
    async def notify_slack(self,ctx,channel,approval):
        need(re.fullmatch('[CG][A-Z0-9]{1,30}',channel),'SLACK_CHANNEL_REQUIRED',422)
        ident,revision,account,token=await self.connection(ctx,'slack','chat:write')
        self.check_connection(ctx,'slack',ident,revision)
        # Buttons carry only canonical opaque approval references, no refund
        # authority, tokens, source history or response_url execution.
        params=approval['parameters']
        description='Review order '+params['orderId']+' at '+params['store']+' for '+params['amount']+' '+params['currency']+' via '+params['paymentProvider']+'.'
        body=dict(channel=channel,text='A refund request needs approval in StarliDigital.',blocks=[
            dict(type='section',text=dict(type='plain_text',text=description)),
            dict(type='actions',elements=[dict(type='button',text=dict(type='plain_text',text=label),action_id='starli_approval',value=approval['id']+':'+choice) for choice,label in [('refund','Refund'),('ticket','Open ticket'),('reject','Reject')]])])
        _,result=await self.transport_for('https://slack.com').request('POST','/api/chat.postMessage',headers={'Authorization':'Bearer '+token},body=body)
        need(result.get('ok') is True,'SLACK_NOTIFICATION_REJECTED',502)
        return {'workspace':account,'message':result.get('ts')}
    async def reconcile(self,ctx,config,event,decision,operation):
        """Read-only outcome proof. Absence never authorizes another refund."""
        if decision=='refund' and config['orderPlatform']=='shopify':
            data=await self.shopify(ctx,ORDER_QUERY,{'id':self.order_id(event['orderId'])})
            order=data.get('order');need(order is not None,'ORDER_NOT_FOUND',404)
            refunds=[r for r in order['refunds'] if r.get('note')=='Starli operation '+operation]
            need(len(refunds)==1,'EXTERNAL_OUTCOME_UNRESOLVED',409)
            transactions=refunds[0]['transactions']['nodes']
            need(len(transactions)==1 and transactions[0]['status']=='SUCCESS' and transactions[0]['kind']=='REFUND','EXTERNAL_OUTCOME_UNRESOLVED',409)
            money=transactions[0]['amountSet']['shopMoney']
            need(Decimal(money['amount'])==Decimal(event['amount']) and money['currencyCode']==event['currency'],'PROVIDER_RECEIPT_MISMATCH',502)
            return dict(resourceId=refunds[0]['id'],verified=True)
        # Ticket lookup by external marker requires separately reviewed search
        # scopes. An unavailable reconciliation is a durable hold, never retry.
        raise Fault('EXTERNAL_OUTCOME_UNRESOLVED',409)
