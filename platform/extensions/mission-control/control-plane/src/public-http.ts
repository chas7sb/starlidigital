import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export function isPublicAddress(address: string): boolean {
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));}
  if(isIP(address)===6){const lower=address.toLowerCase();return /^[23][0-9a-f]{3}:/.test(lower)&&!lower.startsWith('2001:db8:')&&!lower.startsWith('2002:');}
  return false;
}

/** DNS is validated and pinned to the socket; redirects are revalidated. Never use for internal API access. */
export async function publicRequest(raw: string, options: { method?: string; headers?: Record<string,string>; body?: string; timeoutMs?: number; maxBytes?: number } = {}) {
  const deadline=Date.now()+Math.min(options.timeoutMs || 15000,30000),maxBytes=options.maxBytes || 1024*1024;
  let url=new URL(raw),method=options.method || 'GET',body=options.body,headers={...options.headers};
  for(let redirects=0;redirects<=3;redirects++){
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new Error('Only public HTTP(S) URLs on standard ports are allowed');
    const hostname=url.hostname.replace(/^\[|\]$/g,'');
    const addresses=await Promise.race([lookup(hostname,{all:true}),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('DNS timeout')),Math.max(1,deadline-Date.now()));timer.unref();})]);
    if(!addresses.length||addresses.some(entry=>!isPublicAddress(entry.address)))throw new Error('Private, local and reserved network addresses are prohibited');
    if(Date.now()>=deadline)throw new Error('HTTP request timed out');
    const pinned=addresses[0];
    const response=await new Promise<{status:number;headers:Record<string,string>;text:string}>((resolve,reject)=>{
      const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method,headers,lookup:(_name,_options,callback)=>{
        if(typeof _options==='object'&&_options.all)callback(null,[pinned]);else callback(null,pinned.address,pinned.family);
      }},res=>{
        let length=0;const chunks:Buffer[]=[];
        res.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>maxBytes){request.destroy(new Error('Response exceeds maximum size'));res.destroy();}else chunks.push(chunk);});
        res.on('error',reject);res.on('end',()=>{const resultHeaders:Record<string,string>={};for(const[key,value]of Object.entries(res.headers))if(value!==undefined&&!['set-cookie','authorization','proxy-authenticate'].includes(key))resultHeaders[key]=Array.isArray(value)?value.join(', '):String(value);resolve({status:res.statusCode || 0,headers:resultHeaders,text:Buffer.concat(chunks).toString('utf8')});});
      });
      const timer=setTimeout(()=>request.destroy(new Error('HTTP request timed out')),Math.max(1,deadline-Date.now()));
      request.on('close',()=>clearTimeout(timer));request.on('error',reject);if(body)request.write(body);request.end();
    });
    if([301,302,303,307,308].includes(response.status)&&response.headers.location){
      if(redirects===3)throw new Error('Too many redirects');const next=new URL(response.headers.location,url);
      if(next.origin!==url.origin)headers=Object.fromEntries(Object.entries(headers).filter(([key])=>!['authorization','cookie','proxy-authorization','host'].includes(key.toLowerCase())));
      if(response.status===303){method='GET';body=undefined;}url=next;continue;
    }
    return {...response,url:url.href};
  }
  throw new Error('Too many redirects');
}
