/** Bound provider network waits, including a response body that never finishes. */
export function modelFetchDeadline(fetcher:typeof fetch, options:{totalMs:number;idleMs:number;onTimeout:()=>void}):typeof fetch {
 return async (input,init)=>{
  const aborter=new AbortController();let idle:ReturnType<typeof setTimeout>|undefined;
  const expire=()=>{options.onTimeout();aborter.abort(Error('PI_NATIVE_TIMEOUT'));};
  const total=setTimeout(expire,options.totalMs);
  const reset=()=>{clearTimeout(idle);idle=setTimeout(expire,options.idleMs);};
  const cleanup=()=>{clearTimeout(total);clearTimeout(idle);};
  const signal=init?.signal?AbortSignal.any([init.signal,aborter.signal]):aborter.signal;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const aborted=()=>{void reader?.cancel(signal.reason).catch(()=>{});};
  signal.addEventListener('abort',aborted,{once:true});
  reset();
  try{
   const response=await fetcher(input,{...init,signal});
   if(!response.body){cleanup();signal.removeEventListener('abort',aborted);return response;}
   reader=response.body.getReader();
   const body=new ReadableStream<Uint8Array>({
    async pull(controller){
     try{signal.throwIfAborted();const next=await reader!.read();signal.throwIfAborted();if(next.done){cleanup();signal.removeEventListener('abort',aborted);controller.close();}else{reset();controller.enqueue(next.value);}}
     catch(error){cleanup();signal.removeEventListener('abort',aborted);controller.error(error);}
    },
    async cancel(reason){cleanup();signal.removeEventListener('abort',aborted);await reader!.cancel(reason);},
   });
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){cleanup();signal.removeEventListener('abort',aborted);throw error;}
 };
}
