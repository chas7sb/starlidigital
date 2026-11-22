export const SMS_BRIDGE_COMPONENT='ro.starlidigital.smsbridge/.BridgeReceiver';
type ProcessResult={exitCode:number|null;stdout:string;stderr:string;timedOut:boolean};
type Runner=(binary:string,args:string[],options?:{cwd?:string;timeoutMs?:number;signal?:AbortSignal})=>Promise<ProcessResult>;
export function parseSmsBridgeResult(output:string):Record<string,any>{
 const tail=output.slice(output.lastIndexOf('Broadcast completed:'));const start=tail.indexOf('data=');if(start<0)throw Error('Starli SMS Bridge nu a confirmat cererea.');let data=tail.slice(start+5).trim();if(data.startsWith('"')&&data.endsWith('"'))data=data.slice(1,-1);try{return JSON.parse(data);}catch{try{return JSON.parse(data.replace(/\\"/g,'"'));}catch{throw Error('Răspuns invalid de la Starli SMS Bridge.');}}
}
export async function bridgeCall(run:Runner,serial:string,extras:string[],signal?:AbortSignal){if(signal?.aborted)throw Error('Operațiunea ADB a fost oprită înainte de execuție.');const result=await run('adb',['-s',serial,'shell','am','broadcast','-n',SMS_BRIDGE_COMPONENT,...extras],{timeoutMs:15000,signal});if(result.exitCode!==0||result.timedOut)throw Error('Conexiunea ADB nu a confirmat cererea SMS.');return parseSmsBridgeResult(result.stdout);}
export async function sendSmsThroughBridge(run:Runner,input:{serial:string;requestId:string;to:string;body:string},signal?:AbortSignal){
 const payload=Buffer.from(JSON.stringify({requestId:input.requestId,to:input.to,body:input.body}),'utf8').toString('base64');
 let receipt=await bridgeCall(run,input.serial,['--es','payload',payload],signal);
 for(let n=0;n<60&&['SUBMITTING','SUBMITTED'].includes(String(receipt.state));n++){if(signal?.aborted)throw Error('Verificarea SMS a fost întreruptă; verifică chitanța Android înainte de repetare.');await new Promise(resolve=>setTimeout(resolve,1000));receipt=await bridgeCall(run,input.serial,['--es','operation','status','--es','requestId',input.requestId],signal);}
 return receipt;
}
