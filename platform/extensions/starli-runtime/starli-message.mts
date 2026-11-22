import {readFileSync} from 'node:fs';
import {PiXaiAgentClient} from './pi-client.ts';
const request=JSON.parse(readFileSync(0,'utf8'));
process.env.STARLI_AGENT_PROVIDER=request.provider||'hosted';
process.env.STARLI_AGENT_MODEL=request.model||'starli-coder';
const client=new PiXaiAgentClient('nvidia/nemotron-3-ultra-550b-a55b:free',undefined,60000,1);
const controller=new AbortController();
try {
 const prompt=`You are ${request.name}, a persistent internal Starli agent. Your role: ${request.role}. Instructions: ${request.instructions}. You received a message from ${request.senderName || "Starli Boss"}. Reply directly to the request, accurately and concisely. Do not claim tool access or completed actions.\nMessage: ${request.message}`;
 const answer=await client.ask(prompt,{signal:controller.signal});
 process.stdout.write(JSON.stringify({ok:true,reply:answer.slice(0,12000),receipt:client.receipt})+'\n');
} catch(e){process.stdout.write(JSON.stringify({ok:false,error:String((e as Error).message||'PI_EXECUTION_FAILED')})+'\n');process.exitCode=1;}finally{client.dispose();}
