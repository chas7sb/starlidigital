import test from'node:test';import assert from'node:assert/strict';
import{OperatorTerminal}from'../src/operator-terminal.js';
test('ordered event replay deduplicates overlap and prints a terminal result only once',()=>{
 const lines:string[]=[],statuses:string[]=[];let saved={cursor:0,finalRendered:false};
 const renderer=new OperatorTerminal({write:line=>lines.push(line),status:line=>statuses.push(line),receipt:saved,save:receipt=>{saved=receipt;}});
 renderer.events([{sequence:2,kind:'tool',message:'Website verificat'},{sequence:1,kind:'progress',message:'Verific website-ul'}]);
 renderer.events([{sequence:2,kind:'tool',message:'Website verificat'},{sequence:3,kind:'final',message:'Proiect finalizat.'}]);
 renderer.final('Proiect finalizat.','SUCCEEDED');
 assert.equal(lines.filter(line=>line.includes('Website verificat')).length,1);assert.equal(lines.filter(line=>line.includes('Proiect finalizat.')).length,1);assert.equal(saved.cursor,3);assert.equal(saved.finalRendered,true);assert.equal(statuses.length,1);
 const reconnected=new OperatorTerminal({write:line=>lines.push(line),receipt:saved,save:()=>{}});reconnected.events([{sequence:3,kind:'final',message:'Proiect finalizat.'}]);reconnected.final('Proiect finalizat.','SUCCEEDED');assert.equal(lines.length,2);
});
test('JSON mode emits one parseable task object without event or progress noise',()=>{
 const lines:string[]=[];const renderer=new OperatorTerminal({json:true,write:line=>lines.push(line),receipt:{cursor:0,finalRendered:false},save:()=>{}});
 renderer.events([{sequence:1,kind:'progress',message:'Execut'},{sequence:2,kind:'tool',message:'Rezultat instrument'},{sequence:3,kind:'final',message:'Final'}]);
 renderer.final('Final','SUCCEEDED',{id:'task',status:'SUCCEEDED',reply:'Final'});renderer.final('Final','SUCCEEDED');assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0]).id,'task');
});

test('empty objective events do not print a misleading zero-of-zero checklist',()=>{
 const lines:string[]=[];const renderer=new OperatorTerminal({write:line=>lines.push(line),receipt:{cursor:0,finalRendered:false},save:()=>{}});
 renderer.events([{sequence:1,kind:'objective',message:'Obiectiv: 0/0 rezultate confirmate',dataJson:'{"requirements":[],"pendingEffects":[]}'},{sequence:2,kind:'objective',message:'Obiectiv: 0/1 rezultate confirmate',dataJson:'{"requirements":[{"title":"SMS expediat","complete":false}]}'}]);
 assert.equal(lines.length,1);assert.match(lines[0],/SMS expediat/);assert(!lines[0].includes('0/0'));
});

test('plans render once after replay and malformed plan payloads do not interrupt execution',()=>{
 const lines:string[]=[];const renderer=new OperatorTerminal({write:line=>lines.push(line),receipt:{cursor:0,finalRendered:false},save:()=>{}});
 const plan={sequence:1,kind:'plan',message:'Plan actualizat',dataJson:JSON.stringify({steps:['Inspectez proiectul','Verific rezultatul']})};
 renderer.events([plan]);renderer.events([plan,{sequence:2,kind:'plan',message:'Invalid',dataJson:'invalid'}]);
 renderer.events([{sequence:3,kind:'final',message:'Finalizat'}]);assert.equal(lines.length,2);assert.match(lines[0],/1\. Inspectez proiectul/);assert.match(lines[1],/Finalizat/);
});

test('objective receipts distinguish confirmed work from pending effects and blocked final status',()=>{
 const lines:string[]=[];const renderer=new OperatorTerminal({write:line=>lines.push(line),receipt:{cursor:0,finalRendered:false},save:()=>{}});
 renderer.events([{sequence:1,kind:'objective',message:'Obiectiv: 1/2 rezultate confirmate',dataJson:JSON.stringify({requirements:[{title:'Site creat',complete:true},{title:'SMS trimis',complete:false}]})},{sequence:2,kind:'final',message:'Telefonul trebuie conectat.',dataJson:JSON.stringify({status:'BLOCKED'})}]);
 assert.match(lines[0],/\[x\] Site creat/);assert.match(lines[0],/\[ \] SMS trimis/);assert.match(lines[1],/NECESITĂ INTERVENȚIE/);renderer.final('Telefonul trebuie conectat.','BLOCKED');assert.equal(lines.length,2);
});
