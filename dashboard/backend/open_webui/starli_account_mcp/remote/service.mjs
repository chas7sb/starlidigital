import {createInterface}from 'node:readline';
import {remoteOperation}from './adapter.mjs';
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
let queue=Promise.resolve();
const authorize=()=>{
 const next=queue.then(async()=>{send({type:'authorize'});const line=await lines.next();if(line.done||JSON.parse(line.value).authorized!==true)throw Error('MCP_ACCOUNT_DENIED')});
 queue=next.catch(()=>{});return next;
};
try{
 const line=await lines.next();if(line.done||line.value.length>100000)throw Error('MCP_INPUT_INVALID');
 const job=JSON.parse(line.value);
 const result=await remoteOperation(job.configuration,job.request,{authorize});
 send({type:'result',result});
}catch(error){
 const code=typeof error?.code==='string'&&/^MCP_[A-Z0-9_]+$/.test(error.code)?error.code:'MCP_REMOTE_FAILED';
 send({type:'error',code});
}finally{process.exitCode=0;process.stdin.destroy()}
