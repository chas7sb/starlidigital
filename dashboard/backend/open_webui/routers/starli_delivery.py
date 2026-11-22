"""Durable owner-scoped agent delivery. Persist first; execute recipient with real tools."""
import asyncio, hashlib, json, time
from fastapi import HTTPException
from open_webui.routers import starli_v3_native as native

def initialize(db):
    db.execute("""CREATE TABLE IF NOT EXISTS agent_delivery(
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL,
        message TEXT NOT NULL, status TEXT NOT NULL, task_id TEXT, response TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT '')""")
    db.execute("CREATE INDEX IF NOT EXISTS agent_delivery_pending ON agent_delivery(status,owner)")
    db.execute("CREATE TABLE IF NOT EXISTS agent_message_routes(id TEXT PRIMARY KEY,owner TEXT NOT NULL,source_agent_id TEXT NOT NULL,target_agent_id TEXT NOT NULL,request TEXT NOT NULL,response TEXT NOT NULL,created_at TEXT NOT NULL)")

def conversation(owner, agent):
    from open_webui.models.chats import Chats, ChatForm
    with native._db() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT chat_id FROM agent_conversations WHERE owner=? AND agent_id=?",(owner,agent["id"])).fetchone()
        if row:
            chat=Chats.get_chat_by_id_and_user_id(row["chat_id"],owner)
            if chat:return row["chat_id"]
        chat=Chats.insert_new_chat(owner,ChatForm(chat={"title":agent["name"],"models":["starli-ai"],"history":{"messages":{},"currentId":None},"messages":[],"params":{"system":agent.get("instructions","")}}))
        if not chat:raise HTTPException(503,"Could not create recipient conversation")
        db.execute("INSERT INTO agent_conversations VALUES(?,?,?,?,?) ON CONFLICT(owner,agent_id) DO UPDATE SET chat_id=excluded.chat_id,updated_at=excluded.updated_at",(owner,agent["id"],chat.id,native._utc(),native._utc()))
        db.commit()
        return chat.id

def append(owner, chat_id, ident, actor, target, content, delivery_id):
    from open_webui.models.chats import Chat, ChatModel
    from open_webui.internal.db import get_db
    # A single database transaction serializes concurrent mirrors and chat saves.
    with get_db() as db:
        if db.bind.dialect.name=="sqlite":db.connection().exec_driver_sql("BEGIN IMMEDIATE")
        row=db.query(Chat).filter(Chat.id==chat_id,Chat.user_id==owner).first()
        if not row:raise HTTPException(404,"Conversation not found")
        doc=dict(row.chat or {});history=dict(doc.get("history") or {});messages=dict(history.get("messages") or {})
        if ident in messages:return
        previous=history.get("currentId")
        msg={"id":ident,"parentId":previous,"childrenIds":[],"role":"assistant","content":content,
             "timestamp":int(time.time()),"model":"starli-native","senderAgentId":actor["id"],"senderName":actor["name"],
             "recipientAgentId":target,"starliInterAgent":True,"starliDeliveryId":delivery_id,"done":True}
        if previous in messages:
            parent=dict(messages[previous]);parent["childrenIds"]=list(dict.fromkeys([*(parent.get("childrenIds") or []),ident]));messages[previous]=parent
        messages[ident]=msg;history.update(messages=messages,currentId=ident);doc.update(history=history,messages=[*(doc.get("messages") or []),msg])
        row.chat=doc;row.updated_at=int(time.time());db.commit()

async def mirror(row, reply=False):
    owner=row["owner"]
    with native._db() as db:
        actors={i:dict(native._get(db,owner,i)) for i in (row["source"],row["target"])}
    actor=actors[row["target"] if reply else row["source"]]
    content=row["response"] if reply else row["message"]
    for participant in actors.values():
        chat_id=conversation(owner,participant)
        append(owner,chat_id,row["id"]+(":reply" if reply else ":request"),actor,
               row["source"] if reply else row["target"],content,row["id"])
        from open_webui.socket.main import sio, USER_POOL
        for sid in list(USER_POOL.get(owner,[]) or []):
            await sio.emit("starli-execution",{"chatId":chat_id,"agentId":participant["id"],"phase":"message_delivered","deliveryId":row["id"]},to=sid)

async def deliver(user,args,key):
    native._ready(user);owner=native._owner(user)
    from open_webui.routers.starli_execution_context import current_agent
    source=str(current_agent() or args.get("fromAgentId") or "boss:"+owner);target=str(args.get("agentId",""));message=args.get("message")
    if source==target:raise HTTPException(422,"Sender and recipient must differ")
    if not isinstance(message,str) or not 1<=len(message.strip())<=4000:raise HTTPException(422,"Message must contain 1–4000 characters")
    ident="delivery-"+hashlib.sha256((owner+":"+key).encode()).hexdigest()
    with native._db() as db:
        initialize(db);native._boss(db,owner)
        for agent_id in (source,target):
            if native._get(db,owner,agent_id)["status"]=="PAUSED":raise HTTPException(409,"Agent is paused")
        previous=db.execute("SELECT * FROM agent_delivery WHERE id=? AND owner=?",(ident,owner)).fetchone()
        if previous and (previous["source"],previous["target"],previous["message"])!=(source,target,message):
            raise HTTPException(409,"Delivery key already used for another message")
        if not previous:
            db.execute("INSERT INTO agent_delivery(id,owner,source,target,message,status,created_at,updated_at) VALUES(?,?,?,?,?,'QUEUED',?,?)",(ident,owner,source,target,message,native._utc(),native._utc()))
            native._emit(db,owner,target,"message.queued",{"deliveryId":ident,"fromAgentId":source})
        db.commit()
        row=dict(db.execute("SELECT * FROM agent_delivery WHERE id=?",(ident,)).fetchone())
    await mirror(row)
    # Durable queue is consumed by the API supervisor; a request disconnect loses no work.
    return {"deliveryId":ident,"fromAgentId":source,"agentId":target,"delivered":True,"status":row["status"],
            "taskId":row["task_id"],"reply":row["response"],"execution":"recipient_task_queued" if row["status"]=="QUEUED" else row["status"]}

async def tick():
    from open_webui.models.users import Users
    from open_webui.routers.starli_runtime_adapter import adapter
    with native._db() as db:
        initialize(db);db.commit()
        rows=[dict(r) for r in db.execute("SELECT * FROM agent_delivery WHERE status IN ('QUEUED','RUNNING','MIRROR_PENDING') ORDER BY created_at LIMIT 50")]
    for row in rows:
        try:
            user=Users.get_user_by_id(row["owner"])
            if not user:continue
            native._ready(user)
            if row["status"]=="QUEUED":
                await mirror(row)
                with native._db() as db:
                    active=db.execute("SELECT enabled FROM autonomous_sessions WHERE owner=? AND agent_id=?",(row["owner"],row["target"])).fetchone()
                    if active and active["enabled"]:continue
                    agent=dict(native._get(db,row["owner"],row["target"]))
                    if agent["status"]!="IDLE":
                        db.execute("UPDATE agent_delivery SET error='Recipient is paused; delivery remains queued',updated_at=? WHERE id=?",(native._utc(),row["id"]));db.commit()
                        continue
                prompt=("You are "+agent["name"]+" (registry ID "+agent["id"]+"). "+agent["instructions"]+
                        "\nAssigned message from another project agent:\n"+row["message"]+
                        "\nCarry out this bounded customer-project task with real tools. Report verified evidence. Do not modify the platform.")
                # A crash may occur after the durable task insert but before its
                # delivery pointer is saved. Reattach it without rebuilding a changed prompt.
                from open_webui.routers.starli_runtime_adapter import db as task_db,receipt
                with task_db() as connection:
                    previous=connection.execute("SELECT payload FROM tasks WHERE owner=? AND idem=?",(user.id,row["id"])).fetchone()
                if previous:
                    persisted=json.loads(previous[0])
                    if persisted.get("agentId")!=row["target"] or persisted.get("deliveryId")!=row["id"]:
                        raise HTTPException(409,"Persisted delivery task identity does not match")
                    task=receipt(persisted)
                else:
                    task=await adapter(user.id,"tasks.create",{"prompt":prompt,"chatHistory":native._agent_conversation_messages(row["owner"],row["target"]),
                        "idempotencyKey":row["id"],"agentId":row["target"],"sourceAgentId":row["source"],"deliveryId":row["id"]})
                with native._db() as db:
                    db.execute("INSERT INTO autonomous_sessions(owner,agent_id,enabled,task_id,updated_at,cycles,objective) VALUES(?,?,1,?,?,0,?) ON CONFLICT(owner,agent_id) DO UPDATE SET enabled=1,task_id=excluded.task_id,updated_at=excluded.updated_at,cycles=0,objective=excluded.objective",(row["owner"],row["target"],task["taskId"],native._utc(),row["message"]))
                    db.execute("UPDATE agent_delivery SET task_id=?,status='RUNNING',error='',updated_at=? WHERE id=? AND status='QUEUED'",(task["taskId"],native._utc(),row["id"]));db.commit()
            elif row["status"]=="RUNNING":
                with native._db() as db:
                    session=db.execute("SELECT task_id,enabled FROM autonomous_sessions WHERE owner=? AND agent_id=?",(row["owner"],row["target"])).fetchone()
                if session and session["enabled"] and session["task_id"]!=row["task_id"]:
                    with native._db() as db:
                        db.execute("UPDATE agent_delivery SET task_id=? WHERE id=?",(session["task_id"],row["id"]));db.commit()
                    continue
                task=await adapter(user.id,"tasks.get",{"taskId":row["task_id"]})
                if task["status"]=="COMPLETED":
                    from open_webui.routers.starli_runtime_adapter import owned
                    full=owned(user.id,row["task_id"])
                    if session and session["enabled"] and not (full.get("objectiveComplete") or full.get("needsInput")):continue
                if task["status"] not in ("COMPLETED","FAILED","CANCELLED","INTERRUPTED"):continue
                response=task.get("progress","")
                with native._db() as db:
                    db.execute("UPDATE agent_delivery SET status='MIRROR_PENDING',response=?,error=?,updated_at=? WHERE id=?",(response,"" if task["status"]=="COMPLETED" else task["status"],native._utc(),row["id"]));db.commit()
            else:
                await mirror(row,reply=True)
                with native._db() as db:
                    db.execute("INSERT OR IGNORE INTO agent_message_routes VALUES(?,?,?,?,?,?,?)",(row["id"],row["owner"],row["source"],row["target"],row["message"],row["response"],row["created_at"]))
                    db.execute("UPDATE agent_delivery SET status=?,updated_at=? WHERE id=?",("FAILED" if row["error"] else "COMPLETED",native._utc(),row["id"]))
                    native._emit(db,row["owner"],row["source"],"message.completed",{"deliveryId":row["id"],"error":row["error"]})
                    db.commit()
        except HTTPException as error:
            if error.status_code not in (429,503):
                with native._db() as db:
                    db.execute("UPDATE agent_delivery SET error=?,updated_at=? WHERE id=?",(str(error.detail)[:200],native._utc(),row["id"]));db.commit()
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Delivery deferred %s",row["id"])
