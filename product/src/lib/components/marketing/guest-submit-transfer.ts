const PREFIX='starli.guest-submit.v1:';
const intentPattern=/^[a-f0-9]{40}$/i,requestPattern=/^[A-Za-z0-9_-]{8,128}$/;
export function storeGuestSubmit(storage:Storage,intentId:string,requestId:string):boolean{
 if(!intentPattern.test(intentId)||!requestPattern.test(requestId))return false;
 try{storage.setItem(PREFIX+intentId+':'+requestId,JSON.stringify({intentId,requestId,createdAt:Date.now()}));return true;}catch{return false;}
}
export function consumeGuestSubmit(storage:Storage,intentId:string):{intentId:string;requestId:string}|null{
 if(!intentPattern.test(intentId))return null;
 try{
  const keys:string[]=[];
  for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(PREFIX+intentId+':'))keys.push(key);}
  let result:{intentId:string;requestId:string}|null=null;
  for(const key of keys){
   const raw=storage.getItem(key);storage.removeItem(key); // Consume before parsing or any caller await.
   try{const value=JSON.parse(raw||'null');
    if(value?.intentId===intentId&&requestPattern.test(value.requestId||'')&&key===PREFIX+intentId+':'+value.requestId&&
     Number.isFinite(value.createdAt)&&Date.now()-value.createdAt>=0&&Date.now()-value.createdAt<600000)
     result=result?null:{intentId,requestId:value.requestId};
   }catch{}
  }
  return keys.length===1?result:null;
 }catch{return null;}
}
