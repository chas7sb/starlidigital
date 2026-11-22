"""Canonical multi-channel approvals with verified Slack ingress and mapping."""
import hashlib
import hmac
import json
import urllib.parse
from .common import need, Fault, envelope

class SlackIngress:
    def __init__(self,gateway,signing_secret,context_for_member):
        self.gateway,self.secret,self.context_for_member=gateway,signing_secret,context_for_member
    def handle(self,timestamp,signature,body):
        need(isinstance(body,bytes) and len(body)<=65536,'SLACK_BODY_LIMIT',413)
        try:stamp=int(timestamp)
        except (TypeError,ValueError):raise Fault('SLACK_TIMESTAMP_INVALID') from None
        need(abs(self.gateway.clock()-stamp)<=300,'SLACK_TIMESTAMP_EXPIRED')
        calculated='v0='+hmac.new(self.secret(),b'v0:'+str(stamp).encode()+b':'+body,hashlib.sha256).hexdigest()
        need(isinstance(signature,str) and hmac.compare_digest(calculated,signature),'SLACK_SIGNATURE_INVALID')
        try:
            parsed=urllib.parse.parse_qs(body.decode(),strict_parsing=True)
            need(set(parsed)=={'payload'} and len(parsed['payload'])==1,'SLACK_PAYLOAD_INVALID',422)
            payload=json.loads(parsed['payload'][0]);team=payload['team']['id'];user=payload['user']['id'];actions=payload['actions']
            need(len(actions)==1 and actions[0]['action_id']=='starli_approval','SLACK_ACTION_INVALID',422)
            approval,decision=actions[0]['value'].split(':')
        except (ValueError,KeyError,TypeError):raise Fault('SLACK_PAYLOAD_INVALID',422) from None
        with self.gateway.store.db() as db:
            row=db.execute('SELECT * FROM sa_approvals WHERE id=?',(approval,)).fetchone()
            need(row is not None,'APPROVAL_NOT_FOUND',404)
            connection=db.execute("SELECT 1 FROM sa_connections WHERE company=? AND provider='slack' AND account=? AND state='CONNECTED'",(row['company'],team)).fetchone()
            need(connection is not None,'SLACK_WORKSPACE_DENIED')
            mapping=db.execute('SELECT * FROM sa_slack_members WHERE company=? AND workspace=? AND slack_user=?',(row['company'],team,user)).fetchone()
            need(mapping is not None and (mapping['user'],mapping['binding'])==(row['approver'],row['binding']),'SLACK_APPROVER_DENIED')
            replay=hashlib.sha256(str(stamp).encode()+body).hexdigest()
            need(not db.execute("SELECT 1 FROM sa_replays WHERE kind='slack' AND key=?",(replay,)).fetchone(),'SLACK_REPLAY_DENIED',409)
            db.execute("INSERT INTO sa_replays VALUES('slack',?,?)",(replay,self.gateway.clock()))
            company,member,binding,room=row['company'],mapping['user'],mapping['binding'],row['room']
        # A signed Slack event alone never authenticates an arbitrary Starli user.
        # Host resolver must verify fresh native identity and current grants.
        ctx=self.context_for_member(company,member,binding,room)
        need((ctx.company,ctx.actor,ctx.binding,ctx.room)==(company,member,binding,room),'SLACK_NATIVE_MAPPING_CHANGED')
        return self.gateway.decide(ctx,approval,dict(decision=decision,expectedStatus='PENDING'),origin='slack')
