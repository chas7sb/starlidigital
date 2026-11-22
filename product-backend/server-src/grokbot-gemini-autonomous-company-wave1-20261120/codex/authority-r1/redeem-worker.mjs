import {NativeAuthorityHost} from './package/server/native-host.ts';
let text='';for await(const b of process.stdin)text+=b;
const {opts,ticket}=JSON.parse(text);let h;
try{h=new NativeAuthorityHost(opts);h.bootstrap(ticket);console.log(JSON.stringify({ok:true,pid:process.pid}));}
catch(e){console.log(JSON.stringify({ok:false,code:e.code,pid:process.pid}));}
finally{h?.close();}
