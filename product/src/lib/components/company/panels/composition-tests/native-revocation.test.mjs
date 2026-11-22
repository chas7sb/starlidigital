import {test} from 'node:test';import assert from 'node:assert/strict';
import {PanelHost,PanelRegistry} from '../index.mjs';import {httpAdapter} from '../http-adapter.mjs';
test('a hidden/deleted resource404 clears an already open private panel and draft',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let snapshots=0;const scope={userId:'user',kind:'company',ownerId:'company'},ref={scope:'company',ownerId:'company',kind:'file',id:'private-file'};
 const response=value=>new Response(JSON.stringify({scope:'company',ownerId:'company',...value}),{headers:{'Content-Type':'application/json'}});
 const fetcher=async path=>path.endsWith('/authorize')?response({allowed:true}):++snapshots===1?response({value:{secret:'private snapshot'},revision:1}):new Response(null,{status:404});
 const registry=new PanelRegistry();registry.register({version:'starli.panel.v1',type:'resource.file',scopes:['company'],capabilities:['read'],resourceKinds:['file']},async()=>({default:class{}}));
 const host=new PanelHost(registry,httpAdapter(fetcher),{getItem:()=>null,setItem:()=>{}});await host.switchScope(scope);const panel=await host.open({type:'resource.file',ref});host.draft(panel.key,{secret:'unsent draft'});assert.equal(panel.state,'ready');
 t.mock.timers.tick(3000);await new Promise(resolve=>setImmediate(resolve));assert.equal(panel.state,'capability');assert.equal(panel.data,null);assert.equal(panel.draft,null);assert.equal(panel.renderer,null);host.destroy();
});
