"""Server-derived audience for the runtime/memory adapter. No inference here."""
from dataclasses import dataclass
from .authority import actor, require, Denied


@dataclass(frozen=True)
class RoomContext:
    company_id:str
    room_id:str
    actor_id:str
    actor_binding:str
    bot_id:str
    visibility:str
    room_revision:int
    audience:tuple

    @property
    def memory_identity(self):
        return ('company',self.company_id,self.bot_id)


def capture(store,session,company,room,bot):
    with store.access(session,company,room,readonly=True) as (db,member,row):
        store.agent(db,member,room,bot)
        audience=[]
        if row['visibility']=='private':
            for target in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1 ORDER BY user',(room,)):
                try:
                    current=store.human(db,room,company,target[0])
                    if current.binding==target[1]:audience.append((current.user_id,current.binding))
                except Denied:pass
        # Public company audience is the dynamic company membership policy, not
        # a client-supplied list or a snapshot that remains valid after revocation.
        return RoomContext(company,room,member.user_id,member.binding,bot,row['visibility'],row['revision'],tuple(audience))


def revalidate(store,session,context):
    fresh=capture(store,session,context.company_id,context.room_id,context.bot_id)
    require(fresh==context,403,'ROOM_CONTEXT_CHANGED')
    return fresh


def memory_scope(context):
    return {'scopeKind':'company','companyId':context.company_id,'botId':context.bot_id,
            'actorId':context.actor_id,'membershipBinding':context.actor_binding,
            'audience':{'kind':'company' if context.visibility=='public' else 'room',
                        'companyId':context.company_id,'roomId':context.room_id,
                        'members':list(context.audience)},
            'provenance':{'roomId':context.room_id}}
