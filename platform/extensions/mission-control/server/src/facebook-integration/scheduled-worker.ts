/**
 * Explicitly started pilot worker. Never auto-starts or enables provider writes.
 * The injected scheduler is responsible for durable claims, authorization and
 * no-retry handling of uncertain provider acknowledgements.
 */
export interface DueFacebookScheduler {
  dispatchDue(limit:number):Promise<unknown[]>;
}
export function createFacebookScheduledWorker(options:{
  scheduler:DueFacebookScheduler;
  intervalMs?:number;
  batchSize?:number;
  onError?:(error:unknown)=>void;
}){
  const intervalMs=options.intervalMs??15_000;
  const batchSize=options.batchSize??20;
  if(!Number.isInteger(intervalMs)||intervalMs<1_000||intervalMs>3_600_000)throw Error('INVALID_WORKER_INTERVAL');
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>50)throw Error('INVALID_WORKER_BATCH');
  let timer:ReturnType<typeof setInterval>|undefined;
  let inFlight:Promise<unknown[]>|undefined;
  let stopping=false;
  const tick=()=>{
    if(stopping)return Promise.resolve([]);
    if(inFlight)return inFlight;
    const run=Promise.resolve().then(()=>options.scheduler.dispatchDue(batchSize));
    inFlight=run;
    void run.catch(error=>{try{options.onError?.(error);}catch{}}).finally(()=>{if(inFlight===run)inFlight=undefined;});
    return run;
  };
  return {
    tick,
    start(){
      if(stopping)throw Error('WORKER_STOPPED');
      if(timer)return;
      timer=setInterval(()=>{void tick().catch(()=>{});},intervalMs);
      timer.unref?.();
    },
    async stop(){
      stopping=true;
      if(timer){clearInterval(timer);timer=undefined;}
      if(inFlight)await inFlight.catch(()=>{});
    },
    get running(){return timer!==undefined;},
  };
}
