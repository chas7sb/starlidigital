"""Agent6 runtime + independently owned Agent7 v4 native session/Store mount."""
import time
from company_bot_runtime import Runtime,mount
from company_messaging.authority import require
from company_messaging.context import revalidate


class NativeRuntime(Runtime):
    accepting=False

    def local_fence(self,db,ctx):
        super().local_fence(db,ctx)
        authority=object.__new__(type(self.authority));authority.db=db
        authority.require_member(ctx.bot_id,ctx.company_id,permission='messages.send')

    async def startup(self):
        require(not self.accepting,409,'NATIVE_RUNTIME_ALREADY_STARTED')
        self.accepting=True

    async def start_turn(self,session,audience,source,key):
        require(self.accepting,503,'NATIVE_RUNTIME_NOT_STARTED')
        revalidate(self.store,session,audience)
        return await self.start_from_message(session,audience.company_id,audience.room_id,audience.bot_id,key,source['id'])

    def authorize_native(self,db,run):
        """Agent7 callback. Reuses supplied attached BEGIN IMMEDIATE connection."""
        try:
            saved=self.scopes.get(run.run_id)
            if saved is None:return False
            session,ctx,selection=saved
            if (run.company_id,run.room_id,run.bot_id,run.actor_id,run.actor_binding)!=(ctx.company_id,ctx.room_id,ctx.bot_id,ctx.actor_id,ctx.actor_binding):return False
            if getattr(run,'source_context',None)!=ctx:return False
            if session.expires_at<=time.time()or not callable(getattr(session,'revalidate',None))or session.revalidate()is not True:return False
            with self.store.authority.bind_connection(db):
                member=self.store.authority.require_member(run.actor_id,run.company_id)
                if member.binding!=ctx.actor_binding:return False
                room=self.store.room(db,member,run.room_id)
                if room['revision']!=ctx.room_revision:return False
                self.local_fence(db,ctx)
                self.store.agent(db,member,run.room_id,run.bot_id)
                if room['visibility']=='private':
                    audience=[]
                    for target in db.execute('SELECT user,binding FROM cm_members WHERE room=? AND active=1 ORDER BY user',(run.room_id,)):
                        current=self.store.authority.require_member(target['user'],run.company_id)
                        if current.binding==target['binding']:audience.append((current.user_id,current.binding))
                    if tuple(audience)!=ctx.audience:return False
                row=db.execute('SELECT * FROM cr_turns WHERE id=?',(run.run_id,)).fetchone()
                if row is None or (row['company'],row['room'],row['bot'],row['actor'],row['binding'],row['message'],row['state'])!=(ctx.company_id,ctx.room_id,ctx.bot_id,ctx.actor_id,ctx.actor_binding,getattr(run,'assistant_message_id',None),'RUNNING'):return False
                if (row['provider'],row['model'],row['configuration_revision'])!=(selection['provider'],selection['model'],selection['configurationRevision']):return False
                self.providers.check(selection)
                return True
        except Exception:return False

    async def close(self):
        self.accepting=False
        await super().close()


def install(app,providers,bots,authority,memory_factory,runner):
    store=getattr(app.state,'company_messaging',None)
    session=getattr(app.state,'company_messaging_session',None)
    require(store is not None and callable(session),503,'AGENT7_NATIVE_MOUNT_REQUIRED')
    runtime=NativeRuntime(store,providers,bots,authority,memory_factory,runner)
    require(not hasattr(app.state,'company_messaging_start_turn'),409,'NATIVE_INGRESS_ALREADY_INSTALLED')
    app.state.company_messaging_start_turn=runtime.start_turn
    app.state.company_messaging_authorize_run=runtime.authorize_native
    mount(app,runtime,session)
    app.add_event_handler('startup',runtime.startup)
    return runtime
