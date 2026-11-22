import test from 'node:test';import assert from 'node:assert/strict';import {parseAgentTurn} from '../src/agent-turn.js';
test('agent accepts bounded real build requests and keeps ordinary chat as text',()=>{
 assert.deepEqual(parseAgentTurn({output:[{type:'message',content:[{type:'output_text',text:'Salut!'}]}]}),{text:'Salut!'});
 const result=parseAgentTurn({output:[{type:'function_call',name:'build_website',arguments:JSON.stringify({name:'Atelier',brief:'Website pentru atelier de ceramică în Brașov.'})}]});assert.equal(result.build?.name,'Atelier');
});
test('agent cannot request purchases, arbitrary tools or incomplete work',()=>{
 assert.throws(()=>parseAgentTurn({output:[{type:'function_call',name:'buy_domain',arguments:'{}'}]}));
 assert.throws(()=>parseAgentTurn({status:'incomplete',output:[]}));
 assert.throws(()=>parseAgentTurn({output:[{type:'function_call',name:'build_website',arguments:'{"name":"x","brief":""}'}]}));
});
