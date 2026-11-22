import {createResearch} from './research.mjs';
let chunks=[],size=0;
for await(const b of process.stdin){size+=b.length;if(size>16384)throw Error('ENVELOPE_TOO_LARGE');chunks.push(b)}
const controller=new AbortController();
process.on('SIGTERM',()=>controller.abort());process.on('SIGINT',()=>controller.abort());
try{
 const e=JSON.parse(Buffer.concat(chunks));
 const run=createResearch({origin:e.origin,protectedAddresses:e.protectedAddresses,authorize:async()=>true});
 const result=await run(e.name,e.args,{...e.scope,signal:controller.signal});
 process.stdout.write(JSON.stringify({ok:true,result}));
}catch(error){process.stdout.write(JSON.stringify({ok:false,code:/^[A-Z_]{1,64}$/.test(error.code??'')?error.code:'RESEARCH_FAILED'}));process.exitCode=1}
