import test from 'node:test';
import assert from 'node:assert/strict';
import {graphql} from 'graphql';
import {Store,id,now} from '../src/store.js';
import {Events} from '../src/events.js';
import {sessionContext} from '../src/security.js';
import {createAppSchema} from '../src/schema.js';
import {runOperatorTurn} from '../src/operator-tools.js';

test('private operator sessions cannot be listed, read, subscribed to or written by another operator',async()=>{
 const store=new Store(':memory:'),events=new Events();
 try{
 const owner=store.saveUser({id:id(),username:'session_owner',role:'ADMIN',createdAt:now()});
 const other=store.saveUser({id:id(),username:'session_other',role:'ADMIN',createdAt:now()});
 const ownerCtx=sessionContext(store,'',()=>{},'owner');ownerCtx.user=owner;
 const otherCtx=sessionContext(store,'',()=>{},'other');otherCtx.user=other;
 const sessionId=id();store.put('operator-conversations',{id:sessionId,ownerId:owner.id,title:'Private task',status:'OPEN',messages:[],createdAt:now(),updatedAt:now()},owner.id);
 const schema=createAppSchema(store,events);
 const listed=await graphql({schema,source:'{operatorConversations{id}}',contextValue:otherCtx});assert.deepEqual(listed.data?.operatorConversations,[]);
 const read=await graphql({schema,source:'query($id:ID!){operatorConversation(id:$id){id}}',variableValues:{id:sessionId},contextValue:otherCtx});assert.ok(read.errors?.length);
 const subscription=schema.getSubscriptionType()!.getFields().operatorConversationUpdated;
 assert.throws(()=>subscription.subscribe!({}, {id:sessionId},otherCtx,{} as any));
 await assert.rejects(runOperatorTurn(store,events,otherCtx,{conversationId:sessionId,prompt:'Modifică istoricul'},{autonomous:false}));
 assert.deepEqual(store.get('operator-conversations',sessionId)!.messages,[]);
 const allowed=await graphql({schema,source:'query($id:ID!){operatorConversation(id:$id){id}}',variableValues:{id:sessionId},contextValue:ownerCtx});assert.equal(allowed.errors,undefined);
 }finally{store.close();}
});
