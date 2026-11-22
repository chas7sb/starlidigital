export class Events {
  private listeners=new Map<string,Set<(value:any)=>void>>();
  publish(topic:string,value:any=null) { for(const listener of this.listeners.get(topic)||[])listener(value); }
  iterator(topic:string):AsyncIterableIterator<any> {
    const queue:any[]=[];let resolve:((value:IteratorResult<any>)=>void)|undefined;let closed=false;
    const listener=(value:any)=>{if(resolve){const r=resolve;resolve=undefined;r({value,done:false});}else{if(queue.length>=50)queue.shift();queue.push(value);}};
    if(!this.listeners.has(topic))this.listeners.set(topic,new Set());this.listeners.get(topic)!.add(listener);
    return {[Symbol.asyncIterator](){return this;},next:()=>{if(closed)return Promise.resolve({value:undefined,done:true});if(queue.length)return Promise.resolve({value:queue.shift(),done:false});return new Promise(r=>{resolve=r;});},return:()=>{closed=true;this.listeners.get(topic)?.delete(listener);resolve?.({value:undefined,done:true});return Promise.resolve({value:undefined,done:true});}};
  }
}
