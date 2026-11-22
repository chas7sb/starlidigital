"""Only saved native bot/room/assistant origins produce a graph review card."""
import json,types
from starli_automations.common import need,encoded

def install(gateway):
    store=gateway.native.store
    with store.db()as db:
        db.execute('CREATE TABLE IF NOT EXISTS sn_graph_origins(graph TEXT PRIMARY KEY,company TEXT NOT NULL,room TEXT NOT NULL,bot TEXT NOT NULL,message TEXT NOT NULL)')
    original=store.message_dto
    def dto(self,db,room,message):
        value=original(db,room,message)
        origin=db.execute('SELECT * FROM sn_graph_origins WHERE room=? AND message=? ORDER BY rowid DESC LIMIT 1',(room,message)).fetchone()
        if origin and not value.get('deleted'):
            current=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(message,room)).fetchone()
            if current and current['speaker']==origin['bot'] and current['kind']=='agent' and not current['deleted']:
                value['data']={**value.get('data',{}),'starliN8nGraph':card(origin)}
        return value
    store.message_dto=types.MethodType(dto,store)

def card(origin):
    return {'version':'starli.company-n8n.v1','companyId':origin['company'],'conversationId':origin['room'],'graphId':origin['graph'],'requestingBotId':origin['bot'],'assistantMessageId':origin['message']}

def bind(gateway,db,ctx,graph):
    message=getattr(ctx.native_scope,'assistant_message_id',None)
    need(message,'NATIVE_ASSISTANT_ORIGIN_REQUIRED')
    row=db.execute('SELECT * FROM cm_messages WHERE id=? AND room=?',(message,ctx.room)).fetchone()
    need(row and row['speaker']==ctx.bot and row['kind']=='agent' and not row['deleted'],'NATIVE_ASSISTANT_ORIGIN_DENIED')
    db.execute('INSERT INTO sn_graph_origins VALUES(?,?,?,?,?)',(graph,ctx.company,ctx.room,ctx.bot,message))
    db.execute('UPDATE cm_messages SET revision=revision+1 WHERE id=?',(message,))
    gateway.native.store.event(db,ctx.room,'message.updated',message)
