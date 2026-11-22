export function safeStripeUrl(raw:string,kind:'checkout'|'portal'){
 const url=new URL(raw);const hostname=kind==='checkout'?'checkout.stripe.com':'billing.stripe.com';
 if(url.protocol!=='https:'||url.hostname!==hostname||url.username||url.password||url.port)throw new Error('The payment URL could not be verified. No payment page was opened.');
 return url.href;
}
export function creditEntryAmount(entry:{kind:string;amount:number},format:(value:number)=>string){
 const kind=entry.kind.toUpperCase();
 if(kind==='RESERVE')return `${format(Math.abs(entry.amount))} rezervate`;
 if(kind==='RELEASE')return `${format(Math.abs(entry.amount))} eliberate`;
 return `${entry.amount>0?'+':''}${format(entry.amount)}`;
}
