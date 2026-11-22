"""One durable Starli/Slack outbox pointing to the same canonical approval."""
import json
import uuid
from .common import need,encoded,public_error

async def deliver(gateway,ctx,notification):
    with gateway.access(ctx) as db:
        row=db.execute("SELECT * FROM sa_notifications WHERE id=? AND company=? AND state='PENDING'",(notification,ctx.company)).fetchone()
        need(row is not None,'NOTIFICATION_NOT_PENDING',409)
        approval=gateway.row(db,ctx,'sa_approvals',row['approval'])
        need(approval['state']=='PENDING' and approval['expires']>gateway.clock(),'APPROVAL_NOT_PENDING',409)
        workflow=gateway.row(db,ctx,'sa_workflows',approval['workflow'])
        member=gateway.store.authority.require_member(row['user'],ctx.company)
        need(member.binding==row['binding'],'NOTIFICATION_MEMBERSHIP_CHANGED')
        if row['channel']=='starli':
            origin=gateway.feedback.origin(db,ctx.company,'execution',approval['execution'],approval['version'])
            need(origin is not None,'AUTOMATION_ORIGIN_REQUIRED',409)
            message=origin['feedback_message']
            gateway.feedback.publish(db,ctx,approval['execution'])
            db.execute('INSERT OR IGNORE INTO cm_notifications(id,company,room,message,user,binding,created) VALUES(?,?,?,?,?,?,?)',(str(uuid.uuid4()),ctx.company,row['room'],message,member.user_id,member.binding,gateway.clock()))
            db.execute("UPDATE sa_notifications SET state='DONE' WHERE id=? AND company=?",(notification,ctx.company))
            return
        need(row['channel']=='slack','NOTIFICATION_CHANNEL_UNAVAILABLE')
        config=json.loads(db.execute('SELECT ir FROM sa_versions WHERE workflow=? AND version=? AND company=?',(workflow['id'],approval['version'],ctx.company)).fetchone()[0])['configuration']
        db.execute("UPDATE sa_notifications SET state='INTENT' WHERE id=? AND company=?",(notification,ctx.company))
        canonical={'id':approval['id'],'parameters':json.loads(approval['parameters'])}
    try:
        receipt=await gateway.providers.notify_slack(ctx,config['slackChannelId'],canonical)
        with gateway.access(ctx) as db:
            db.execute("UPDATE sa_notifications SET state='DONE' WHERE id=? AND company=?",(notification,ctx.company))
            gateway.audit(db,ctx,'approval.notification.sent',approval['id'],{'channel':'slack','message':receipt['message']})
    except BaseException:
        with gateway.store.db() as db:db.execute("UPDATE sa_notifications SET state='UNKNOWN' WHERE id=? AND company=?",(notification,ctx.company))
        raise
