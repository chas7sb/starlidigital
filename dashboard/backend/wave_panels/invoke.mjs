import { Worker } from "node:worker_threads";
let raw="";
for await (const part of process.stdin) {
  raw+=part;
  if(Buffer.byteLength(raw)>300000) process.exit(2);
}
const input=JSON.parse(raw);
const controlled=input.config?.controlledSmtp===true && input.method==="email.controlled-send";
const worker=new Worker(new URL("./product-worker.mjs",import.meta.url),{workerData:input});
worker.once("message",result=>process.stdout.write(JSON.stringify(result)));

const deadline=setTimeout(()=>{worker.terminate();process.stdout.write(JSON.stringify({ok:false,status:503,error:{code:"UNAVAILABLE"}}));},controlled?60000:25000);
worker.once("message",()=>clearTimeout(deadline));
worker.once("error",()=>{clearTimeout(deadline);process.stdout.write(JSON.stringify({ok:false,status:503,error:{code:"UNAVAILABLE"}}));});
