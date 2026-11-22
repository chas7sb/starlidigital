"""Signed Starli refund-request ingress; no tenant trusted from webhook JSON."""
import hashlib,hmac,json,secrets
from .common import need,exact,Fault,digest,envelope

class WebhookIngress:
    def __init__(self,gateway,vault):self.gateway,self.vault=gateway,vault
    def register(self,ctx,workflow,secret):
        """Host provisioning only. Secret is delivered out-of-band to the trusted
        trigger owner, never through model tools or normal frontend DTOs.
        """
        need(isinstance(secret,bytes) and len(secret)>=32,'WEBHOOK_SECRET_REQUIRED',500)
        token=secrets.token_hex(24);key=hashlib.sha256(token.encode()).hexdigest()
        with self.gateway.access(ctx,'integrations.install') as db:
            self.gateway.row(db,ctx,'sa_workflows',workflow)
            sealed=self.vault.seal(ctx.company,key,{'key':secret.hex()})
            db.execute('INSERT INTO sa_webhooks VALUES(?,?,?,?,?,?)',(key,ctx.company,workflow,'starli',sealed,'ACTIVE'))
            self.gateway.audit(db,ctx,'webhook.provisioned',workflow)
        return token
    async def handle(self,token,timestamp,signature,body):
        need(type(token)is str and len(token)==48 and isinstance(body,bytes) and len(body)<=65536,'WEBHOOK_INVALID',422)
        try:stamp=int(timestamp)
        except (TypeError,ValueError):raise Fault('WEBHOOK_SIGNATURE_INVALID') from None
        need(abs(self.gateway.clock()-stamp)<=300,'WEBHOOK_SIGNATURE_EXPIRED')
        key=hashlib.sha256(token.encode()).hexdigest()
        with self.gateway.store.db() as db:
            row=db.execute("SELECT * FROM sa_webhooks WHERE token_hash=? AND state='ACTIVE'",(key,)).fetchone();need(row is not None,'WEBHOOK_NOT_FOUND',404)
            secret=bytes.fromhex(self.vault.open(row['company'],key,row['secret'])['key'])
            computed='v1='+hmac.new(secret,str(stamp).encode()+b'.'+body,hashlib.sha256).hexdigest()
            need(isinstance(signature,str) and hmac.compare_digest(computed,signature),'WEBHOOK_SIGNATURE_INVALID')
            company,workflow=row['company'],row['workflow']
        try:payload=json.loads(body)
        except ValueError:raise Fault('WEBHOOK_JSON_INVALID',422) from None
        exact(payload,('eventId','event'))
        ctx=self.gateway.worker_context(workflow);need(ctx.company==company,'WEBHOOK_OWNER_CHANGED')
        return await self.gateway.ingest(ctx,workflow,payload['eventId'],payload['event'])
