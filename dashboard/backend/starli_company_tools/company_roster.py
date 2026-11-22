"""Additive native company roster lookup. No bot/member/profile mutations."""
import re
from dataclasses import replace
from starli_company_tools.core import ToolSpec,obj,require

def install(runtime,registry):
    store=runtime.store
    schema=getattr(store.authority,'schema',None)
    require(type(schema)is str and re.fullmatch('[a-z][a-z_]{0,40}',schema)is not None,'NATIVE_AUTHORITY_SCHEMA_REQUIRED',503)
    registry_schema='company_bots' if 'company_bots' in store.attached_databases else schema
    def human(db,ctx):
        row=db.execute('SELECT user_id,name FROM '+schema+".members WHERE company_id=? AND user_id=? AND active=1 AND kind='person'",(ctx.company_id,ctx.actor_id)).fetchone()
        require(row is not None,'REQUESTING_HUMAN_NOT_CURRENT')
        return dict(userId=row['user_id'],displayName=row['name'],kind='person')
    def bots(bound,args):
        bound.check();ctx=bound.context;query=args.get('query','').strip()
        with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,member,_):
            requester=human(db,ctx)
            rows=db.execute('SELECT b.id,b.name FROM '+registry_schema+'.bots b JOIN '+schema+".members m ON m.company_id=b.owner AND m.user_id=b.id WHERE b.owner=? AND b.kind='company' AND b.active=1 AND m.kind='bot' AND m.active=1 ORDER BY b.id LIMIT 1001",(ctx.company_id,)).fetchall()
            require(len(rows)<=1000,'DIRECTORY_PAGINATION_REQUIRED',503)
            if query:
                exact=[row for row in rows if row['id']==query]
                rows=exact or [row for row in rows if row['name'].strip().casefold()==query.casefold()]
            require(len(rows)<=50,'RECIPIENT_AMBIGUOUS',422)
            matches=[]
            for row in rows:
                store.authority.require_agent(member,row['id'])
                admitted=db.execute('SELECT 1 FROM cm_agents a JOIN cm_rooms r ON r.id=a.room WHERE a.room=? AND r.company=? AND a.agent=?',(ctx.room_id,ctx.company_id,row['id'])).fetchone()is not None
                matches.append(dict(botId=row['id'],displayName=row['name'],kind='bot',isCurrentBot=row['id']==ctx.bot_id,admittedToCurrentRoom=admitted))
            selectable=[row for row in matches if not row['isCurrentBot']]
            return dict(companyId=ctx.company_id,requestingHuman=requester,currentBotId=ctx.bot_id,matches=matches,requiresDisambiguation=len(selectable)!=1,selfDelegationDenied=bool(matches) and not selectable,delegationToolInstalled='company_bot_delegate'in registry.specs)
    registry.register(ToolSpec('company_bots_directory','Resolve actual active company bots by exact name or ID, or list with empty query. Returns botId, kind, current-room admission and requestingHuman from native authority. Excludes other companies and inactive bots. Never guess ambiguity, create/rename bots or delegate to yourself. Use company_bot_delegate if installed: admitted bots work in this conversation; other company bots receive only the explicit request in a separate private native conversation with the requesting human. Admission metadata is informative and does not prevent cross-room delegation. Cross-room receipts contain no private answer text. For the user saying me use requestingHuman.userId, regardless of their conversational name.',obj({'query':{'type':'string','maxLength':100}},[]),'read','native-company-roster',bots))
    original=registry.specs.get('company_directory')
    require(original is not None,'NATIVE_HUMAN_DIRECTORY_REQUIRED',503)
    def people(bound,args):
        bound.check();ctx=bound.context
        with store.access(bound.session,ctx.company_id,ctx.room_id) as (db,_,_):requester=human(db,ctx)
        query=args['query'].strip()
        effective=requester['userId'] if query.casefold()in ('me','myself','requesting human') else query
        result=original.handler(bound,{**args,'query':effective})
        result=dict(result);result['requestingHuman']=requester
        for match in result.get('matches',[]):match['kind']='person'
        return result
    registry.specs['company_directory']=replace(original,handler=people,description='Resolve actual current company HUMAN members by exact native name/ID; query me resolves the requesting human identity. requestingHuman is authoritative even if their conversational name differs. Bot names are resolved ONLY with company_bots_directory. Never invent a name match or choose an ambiguous recipient. Use company_human_message_send with the resolved userId when available.')
    return registry
