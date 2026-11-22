import test from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{spawn}from'node:child_process';import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{saveCliConfig}from'../src/index.js';
test('interactive input remains available for stop while an operator task is running',{timeout:12000},async()=>{
 const directory=mkdtempSync(join(tmpdir(),'starli-interactive-')),configPath=join(directory,'config.json');let started=0,stopped=0,status='RUNNING';
 let signalStop!:()=>void;const didStop=new Promise<void>(resolve=>{signalStop=resolve;});let selected=0,histories=0;
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),query=body.query;let data:any;
 if(query.includes('startOperatorTask')){started++;data={startOperatorTask:{id:'task-live',conversationId:'conv-live',status:'QUEUED'}};}
 else if(query.includes('stopOperatorTask')){stopped++;status='INTERRUPTED';data={stopOperatorTask:{id:'task-live',status}};signalStop();}
 else if(query.includes('operatorConversation(')){assert.equal(body.variables.id,'conv-other');if(query.includes('messages{')){histories++;data={operatorConversation:{messages:[{role:'assistant',content:'Istoric privat disponibil',createdAt:'2026-10-30'}]}};}else{selected++;data={operatorConversation:{id:'conv-other',title:'Altă conversație'}};}}
 else data={operatorTask:{id:'task-live',conversationId:'conv-live',status,reply:null,error:status==='INTERRUPTED'?'Oprit de operator':null,toolResults:[]},operatorTaskEvents:status==='RUNNING'?[{sequence:1,kind:'start',message:'În execuție'}]:[{sequence:2,kind:'canceled',message:'Oprit de operator'}]};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as{port:number};
 saveCliConfig({apiUrl:'http://127.0.0.1:'+address.port,operatorToken:'starli_op_test12345678901234567890'},configPath);
 const entry=join(directory,'entry.mjs');writeFileSync(entry,`import{runCli}from${JSON.stringify(new URL('../src/index.ts',import.meta.url).href)};await runCli(['chat']);`);
 const child=spawn(process.execPath,['--import','tsx',entry],{env:{...process.env,STARLI_OPERATOR_CONFIG:configPath},stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
 try{child.stdin.write('Verifică platforma\n/stop\n');await didStop;assert.equal(started,1);assert.equal(stopped,1);child.stdin.write('/use conv-other\n/history\n/new\n/stop\n/exit\n');child.stdin.end();await new Promise<void>((resolve,reject)=>{child.once('exit',()=>resolve());child.once('error',reject);});assert.equal(selected,1);assert.equal(histories,1);assert.equal(stopped,1,'a new empty session cannot cancel another session');assert.ok(output.includes('Istoric privat disponibil'));assert.ok(output.includes('Oprire solicitată'));assert.ok(!output.includes('JOB_UPDATED'));}
 finally{child.kill();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(directory,{recursive:true,force:true,maxRetries:5});}
});
