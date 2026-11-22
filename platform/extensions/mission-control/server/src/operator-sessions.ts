import type {Store} from './store.js';
import {requireOperator} from './operator-auth.js';
import {fail,type Context} from './security.js';

export function listOperatorSessions(store:Store,ctx:Context){
 const {user}=requireOperator(ctx,'CONVERSATIONS');
 return store.list('operator-conversations').filter(session=>session.ownerId===user.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
export function getOperatorSession(store:Store,ctx:Context,id:string){
 const {user}=requireOperator(ctx,'CONVERSATIONS'),session=store.get('operator-conversations',id);
 if(!session||session.ownerId!==user.id)fail('Conversația operatorului nu există sau nu îți aparține.','NOT_FOUND');
 return session;
}
