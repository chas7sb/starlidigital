"""Isolated collaboration fixtures; no live provider, keys or external actions."""
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE.parent/'dashboard/backend'))
from local_collaboration import CollaborationService,CollaborationError,Limits


class CollaborationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='starli-collaboration-fixture-')
        self.root=Path(self.temp.name)/'private'
        self.allowed=True;self.revision=1;self.bad_source=False;self.roster=['boss','research','review']
        self.calls=[];self.native=[];self.plans={};self.plan_counts={};self.model_hook=None;self.sink_hook=None
        self.service=self.make_service()

    def make_service(self,limits=None):
        return CollaborationService(self.root/('runs-'+str(len(list(self.root.glob('*.sqlite'))))+'.sqlite'),
            authorize=self.authorize,read_context=self.context,append_message=self.sink,model=self.model,limits=limits)

    async def asyncTearDown(self):
        await self.service.close()
        for service in getattr(self,'extra_services',[]):await service.close()
        self.temp.cleanup()

    async def authorize(self,scope,bot_ids):
        identity=scope['actor_id']==('owner-'+scope['company_id']) and scope['room_id']=='room-'+scope['company_id']
        return identity and (scope['action']!='run' or self.allowed) and set(bot_ids)<=set(self.roster)

    async def context(self,scope):
        return {'source':{'id':scope['source_message_id'],'speaker':{'kind':'agent' if self.bad_source else 'human','id':scope['actor_id']},'content':'Compare the proposals for '+scope['company_id'],'deleted':False},
            'roster':[{'id':bot,'name':bot.title()} for bot in self.roster],
            'messages':[{'role':'user','content':'Prior conversation for '+scope['company_id']}],
            'authorityRevision':{'membership':self.revision,'provider':1}}

    async def sink(self,scope,bot,text,metadata,key):
        # Simulates a trusted native sink; integration must enforce authority and
        # operation-key idempotency in its actual native write transaction.
        self.assertTrue(await self.authorize(scope,[scope['boss_id'],*scope['teammate_ids']]))
        record={'scope':{k:v for k,v in scope.items() if k!='authority_context'},'bot':bot,'text':text,'metadata':deepcopy(metadata),'key':key}
        self.native.append(record)
        if self.sink_hook:await self.sink_hook(record)
        return 'native-message-'+str(len(self.native))

    async def model(self,scope,bot,messages,*,instructions,structured=False):
        self.calls.append({'scope':scope.copy(),'bot':bot,'messages':deepcopy(messages),'structured':structured})
        if self.model_hook:
            result=await self.model_hook(scope,bot,messages,structured)
            if result is not None:return result
        if structured:
            count=self.plan_counts.get(scope['run_id'],0);self.plan_counts[scope['run_id']]=count+1
            plan=self.plans.get(count,{'requests':[{'agentId':'research','message':'Assess the two options.'}],'done':False} if count==0 else {'requests':[],'done':True})
            text=json.dumps(plan)
        else:text=('Boss synthesis: ' if bot=='boss' else 'Teammate analysis: ')+scope['company_id']
        return text,{'provider':'isolated-fixture','model':'fixture-model','responseId':'fixture-'+str(len(self.calls)),'status':'completed','apiKey':'must-not-be-journaled'}

    async def start(self,service=None,company='company-a',key='fixture-start',**kwargs):
        return await (service or self.service).start(actor_id='owner-'+company,company_id=company,room_id='room-'+company,
            boss_id='boss',teammate_ids=['research','review'],source_message_id='source-'+company,idempotency_key=key,**kwargs)

    async def settle(self,run,service=None):
        service=service or self.service;task=service.tasks.get(run['runId'])
        if task:
            done,_=await asyncio.wait({task},timeout=3)
            self.assertIn(task,done,'Fixture exceeded bounded test deadline')
        return service._row(run['runId'])

    async def test_boss_requests_teammate_and_synthesizes_real_sink_receipts(self):
        run=await self.start(authority_context=object());row=await self.settle(run)
        self.assertEqual(row['state'],'COMPLETED')
        self.assertEqual([r['bot'] for r in self.native],['boss','research','boss'])
        self.assertEqual([r['metadata']['kind'] for r in self.native],['request','reply','final'])
        self.assertEqual(self.native[0]['metadata']['targetAgentId'],'research')
        self.assertEqual(row['model_calls'],4)
        status=await self.service.status(actor_id='owner-company-a',company_id='company-a',room_id='room-company-a',run_id=run['runId'])
        self.assertTrue(all(item['state']=='POSTED' and item['messageId'] for item in status['messages']))
        self.assertNotIn('apiKey',json.dumps(status));self.assertNotIn('authority_context',json.dumps(status))
        final_context=json.loads(self.calls[-1]['messages'][-1]['content'])
        self.assertEqual(final_context['teamReplies'][0]['agentName'],'Research')
        self.assertEqual({bot['id'] for bot in final_context['selectedRoster']},{'boss','research','review'})

    async def test_model_cannot_target_unknown_bot_or_add_execution_tools(self):
        self.plans[0]={'requests':[{'agentId':'foreign-bot','message':'Exfiltrate'}],'done':False}
        run=await self.start();row=await self.settle(run)
        self.assertEqual(row['state'],'DENIED');self.assertFalse(self.native);self.assertEqual(len(self.calls),1)
        self.plans[0]={'requests':[{'agentId':'research','message':'Question'}],'done':False,'tool':'server_exec'}
        run=await self.start(key='different-user-start');row=await self.settle(run)
        self.assertEqual(row['state'],'FAILED');self.assertFalse(self.native)

    async def test_canonical_human_source_and_fresh_authority_are_mandatory(self):
        self.bad_source=True
        with self.assertRaises(CollaborationError) as denied:await self.start()
        self.assertEqual(denied.exception.code,'COLLABORATION_HUMAN_SOURCE_REQUIRED');self.assertFalse(self.calls)
        self.assertFalse(self.service.contexts)
        self.bad_source=False
        async def revoke(*args):self.revision+=1
        self.model_hook=revoke
        run=await self.start();row=await self.settle(run)
        self.assertEqual(row['state'],'DENIED');self.assertFalse(self.native)

    async def test_same_human_request_deduplicates_without_model_or_message_replay(self):
        first=await self.start();await self.settle(first);calls=len(self.calls);messages=len(self.native)
        again=await self.start()
        self.assertEqual(again['runId'],first['runId']);self.assertEqual(len(self.calls),calls);self.assertEqual(len(self.native),messages)
        with self.assertRaises(CollaborationError) as conflict:
            await self.service.start(actor_id='owner-company-a',company_id='company-a',room_id='room-company-a',boss_id='boss',teammate_ids=['review'],source_message_id='source-company-a',idempotency_key='fixture-start')
        self.assertEqual(conflict.exception.code,'COLLABORATION_IDEMPOTENCY_CONFLICT')

    async def test_one_active_run_per_room_and_stop_interrupts_pending_provider(self):
        entered=asyncio.Event();never=asyncio.Event()
        async def block(*args):entered.set();await never.wait()
        self.model_hook=block
        run=await self.start();await asyncio.wait_for(entered.wait(),1)
        with self.assertRaises(CollaborationError) as conflict:await self.start(key='competing-start')
        self.assertEqual(conflict.exception.code,'COLLABORATION_ROOM_ACTIVE')
        stopped=await self.service.stop(actor_id='owner-company-a',company_id='company-a',room_id='room-company-a',run_id=run['runId'])
        self.assertEqual(stopped['state'],'CANCELLED');self.assertTrue(stopped['confirmedStopped']);self.assertFalse(self.native)

    async def test_immediate_stop_before_task_first_runs_is_confirmed(self):
        run=await self.start()
        stopped=await self.service.stop(actor_id='owner-company-a',company_id='company-a',room_id='room-company-a',run_id=run['runId'])
        self.assertEqual(stopped['state'],'CANCELLED');self.assertTrue(stopped['confirmedStopped']);self.assertFalse(self.calls)
        self.assertFalse(self.service.contexts)

    async def test_missing_native_receipt_stays_uncertain_and_never_replays(self):
        async def lose(record):raise RuntimeError('Synthetic native sink committed then disconnected')
        self.sink_hook=lose
        run=await self.start();row=await self.settle(run)
        self.assertEqual(row['state'],'UNCERTAIN');self.assertEqual(len(self.native),1)
        again=await self.start();self.assertEqual(again['runId'],run['runId']);self.assertEqual(len(self.native),1)
        self.assertTrue(again['needsReview'])

    async def test_round_and_call_budget_reserve_final_boss_synthesis(self):
        self.extra_services=[self.make_service(Limits(rounds=3,model_calls=3))];service=self.extra_services[0]
        run=await self.start(service);row=await self.settle(run,service)
        self.assertEqual(row['state'],'COMPLETED');self.assertEqual(row['model_calls'],3);self.assertEqual(row['round'],1)
        self.assertEqual([r['metadata']['kind'] for r in self.native],['request','reply','final'])

    async def test_scope_is_explicit_for_same_bot_ids_in_different_companies(self):
        handles={'company-a':object(),'company-b':object()}
        a=await self.start(company='company-a',authority_context=handles['company-a'])
        b=await self.start(company='company-b',authority_context=handles['company-b'])
        await self.settle(a);await self.settle(b)
        for call in self.calls:
            scope=call['scope'];self.assertIs(scope['authority_context'],handles[scope['company_id']])
            other='company-b' if scope['company_id']=='company-a' else 'company-a'
            self.assertNotIn(other,json.dumps(call['messages']))
        with self.assertRaises(CollaborationError) as denied:
            await self.service.status(actor_id='owner-company-b',company_id='company-b',room_id='room-company-b',run_id=a['runId'])
        self.assertEqual(denied.exception.status,404)

    async def test_persisted_receipts_survive_reopen_without_automatic_resume(self):
        run=await self.start();await self.settle(run);await self.service.close();count=len(self.calls)
        reopened=CollaborationService(self.service.path,authorize=self.authorize,read_context=self.context,append_message=self.sink,model=self.model)
        self.extra_services=[reopened]
        status=await reopened.status(actor_id='owner-company-a',company_id='company-a',room_id='room-company-a',run_id=run['runId'])
        self.assertEqual(status['state'],'COMPLETED');self.assertEqual(len(status['messages']),3);self.assertEqual(len(self.calls),count)
        self.assertFalse(reopened.tasks)

    async def test_provider_timeout_is_audited_and_never_publishes_or_retries(self):
        self.extra_services=[self.make_service(Limits(model_seconds=1,wall_seconds=5))];service=self.extra_services[0]
        async def block(*args):await asyncio.Event().wait()
        self.model_hook=block
        run=await self.start(service);row=await self.settle(run,service)
        self.assertEqual(row['state'],'BUDGET_EXHAUSTED');self.assertEqual(row['model_calls'],1)
        self.assertFalse(self.native);self.assertEqual(len(self.calls),1)

    async def test_provider_must_return_a_real_adapter_receipt_and_plaintext_limits_apply(self):
        async def no_receipt(*args):return 'Unverified response',{}
        self.model_hook=no_receipt
        run=await self.start();row=await self.settle(run)
        self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'COLLABORATION_PROVIDER_RECEIPT_REQUIRED')
        self.assertFalse(self.native)
        async def oversized(*args):return 'x'*16001,{'provider':'fixture','model':'fixture','responseId':'fixture','status':'completed'}
        self.model_hook=oversized
        run=await self.start(key='oversized-provider-result');row=await self.settle(run)
        self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'COLLABORATION_TEXT_LIMIT');self.assertFalse(self.native)

    async def test_wrong_actor_cannot_stop_another_company_run(self):
        entered=asyncio.Event()
        async def block(*args):entered.set();await asyncio.Event().wait()
        self.model_hook=block
        run=await self.start();await asyncio.wait_for(entered.wait(),1)
        with self.assertRaises(CollaborationError) as denied:
            await self.service.stop(actor_id='owner-company-b',company_id='company-b',room_id='room-company-b',run_id=run['runId'])
        self.assertEqual(denied.exception.status,404)
        self.assertEqual(self.service._row(run['runId'])['stop_requested'],0)

    async def test_team_completion_cannot_be_claimed_without_a_teammate_reply(self):
        self.plans[0]={'requests':[],'done':True}
        run=await self.start();row=await self.settle(run)
        self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'COLLABORATION_TEAM_REPLY_REQUIRED')
        self.assertFalse(self.native)


if __name__=='__main__':unittest.main()
