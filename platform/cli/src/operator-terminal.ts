export type OperatorEvent={sequence:number;kind:string;message:string;dataJson?:string;createdAt?:string};
export type TerminalReceipt={cursor:number;finalRendered:boolean};
export class OperatorTerminal{
 private lastStatus='';
 constructor(private options:{write:(text:string)=>void;status?:(text:string)=>void;clearStatus?:()=>void;json?:boolean;receipt:TerminalReceipt;save:(receipt:TerminalReceipt)=>void;refreshPrompt?:()=>void}){}
 get receipt(){return{...this.options.receipt};}
 events(events:OperatorEvent[]){
  for(const event of [...events].sort((a,b)=>a.sequence-b.sequence)){
   if(!Number.isSafeInteger(event.sequence)||event.sequence<=this.options.receipt.cursor)continue;
   if(!this.options.json){
    if(event.kind==='progress'||event.kind==='start'||event.kind==='accepted'){
     if(event.message&&event.message!==this.lastStatus){this.lastStatus=event.message;this.options.status?.(event.message);}
    }else if(event.kind==='objective'){
     let data:any;try{data=JSON.parse(event.dataJson||'{}');}catch{}
     if(Array.isArray(data?.requirements)&&(data.requirements.length||data.pendingEffects?.length))this.options.write(event.message+'\n'+data.requirements.slice(0,16).map((item:any)=>`  ${item.complete?'[x]':'[ ]'} ${item.title}`).join('\n'));
    }else if(event.kind==='plan'){
     let steps:unknown;try{steps=JSON.parse(event.dataJson||'{}').steps;}catch{}
     if(Array.isArray(steps)){const lines=steps.filter(step=>typeof step==='string').slice(0,12);if(lines.length){this.options.clearStatus?.();this.options.write('Plan\n'+lines.map((step,i)=>`  ${i+1}. ${step}`).join('\n'));this.options.refreshPrompt?.();}}
    }else if(event.kind==='tool'){
     this.options.clearStatus?.();if(event.message)this.options.write('  · '+event.message);this.options.refreshPrompt?.();
    }else if(['final','error','canceled'].includes(event.kind)){
     let status=event.kind==='final'?'SUCCEEDED':event.kind==='canceled'?'INTERRUPTED':'FAILED';
     try{const data=JSON.parse(event.dataJson||'{}');if(typeof data.status==='string')status=data.status;}catch{}
     this.final(event.message,status);
    }
   }
   this.options.receipt.cursor=event.sequence;this.options.save(this.receipt);
  }
 }
 final(message:string,status:string,task?:unknown){
  if(this.options.receipt.finalRendered)return false;
  // Record the terminal receipt before output so normal reconnects cannot replay it.
  this.options.receipt.finalRendered=true;this.options.save(this.receipt);this.options.clearStatus?.();
  if(this.options.json)this.options.write(JSON.stringify(task??{status,reply:message},null,2));
  else this.options.write('\n'+(status==='SUCCEEDED'?'Starli':status==='BLOCKED'?'Starli · NECESITĂ INTERVENȚIE':'Starli · '+status.toLowerCase())+'\n'+message+'\n');
  this.options.refreshPrompt?.();return true;
 }
}
