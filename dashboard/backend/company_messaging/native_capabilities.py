"""Native capability advertisement, not execution authority or a cached grant."""
def dispatch_capability(app,store,permission):
    def available(session,company):
        runtime=getattr(app.state,'company_bot_runtime',None)
        if runtime is None or not getattr(runtime,'accepting',False):return False
        try:
            with store.access(session,company,readonly=True)as(db,member,_):
                permission(db,member.user_id,company,'bots.run')
                candidates=db.execute("SELECT r.id,a.agent FROM cm_rooms r JOIN cm_agents a ON a.room=r.id WHERE r.company=? AND r.kind!='work_session' ORDER BY r.id,a.agent LIMIT 1001",(company,)).fetchall()
                if len(candidates)>1000:return False
                for row in candidates:
                    try:
                        store.room(db,member,row['id'])
                        descriptor=store.agent(db,member,row['id'],row['agent'])
                        permission(db,row['agent'],company,'bots.run')
                        if store.authority.can_dispatch_agent(member,descriptor['id'])is True:return True
                    except Exception as error:
                        if getattr(error,'status',None)not in (401,403,404):raise
            return False
        except Exception:
            # No optimistic UI control on missing/denied/stale runtime bindings.
            return False
    return available
