/** Trusted public installation origin. Never read backend/private service URLs. */
export function validatePublicOrigin(value: unknown): string | null {
 if(typeof value!=='string'||!value||/[\s\\]/.test(value)||value.includes('@')||value.includes('?')||value.includes('#'))return null;
 const raw=value.match(/^(https?):\/\/(\[[^\]]+\]|[^:/?#]+)(?::([0-9]+))?\/?$/i);
 if(!raw)return null;
 try{
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.port==='0')return null;
  const host=raw[2].toLowerCase();
  if(!host.startsWith('[')&&(host.length>253||!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))))return null;
  const ipv4=host.split('.');
  const literalLoopback=host==='[::1]'||(ipv4.length===4&&ipv4[0]==='127'&&ipv4.every(n=>/^(0|[1-9][0-9]{0,2})$/.test(n)&&Number(n)<=255)&&host===url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&literalLoopback))return null;
  return url.origin;
 }catch{return null;}
}

export function installationPublicOrigin(
 current:unknown=typeof window!=='undefined'?window.location.origin:undefined,
 configured:unknown=(import.meta as unknown as {env?:Record<string,string|undefined>}).env?.VITE_STARLI_PUBLIC_ORIGIN
):string|null{
 // A malformed explicit setting fails closed; it must never silently widen trust.
 return validatePublicOrigin(configured===undefined||configured===''?current:configured);
}

export function installationPublicUrl(path:string,origin:string|null=installationPublicOrigin()):string|null{
 if(!origin||validatePublicOrigin(origin)!==origin||!/^\/(?!\/)[A-Za-z0-9_/-]*$/.test(path))return null;
 return origin+path;
}

export function installationAuthorizationUrl(value:unknown,path:string,origin:string|null=installationPublicOrigin()):string|null{
 if(!origin||typeof value!=='string'||/[\s\\]/.test(value)||value.includes('#'))return null;
 try{
  const url=new URL(value);
  const prefix=value.match(/^https?:\/\/([^/]+)/i);
  const authority=prefix?.[1];
  const rawPath=prefix?value.slice(prefix[0].length).split('?')[0]:'';
  if(!authority||authority.includes('@')||validatePublicOrigin(origin)!==origin||url.origin!==origin||rawPath!==path||url.pathname!==path||url.username||url.password)return null;
  return url.href;
 }catch{return null;}
}

export function verifiedMcpAuthorization(data:any,returnOrigin:unknown,origin:string|null=installationPublicOrigin()):string|null{
 const callbackOrigin=validatePublicOrigin(returnOrigin);
 const link=installationAuthorizationUrl(data?.authorizationUrl,'/oauth/authorize',origin);
 if(!callbackOrigin||!link||data?.version!=='starli.mcp-oauth.v1'||data.scope!=='read'||data.issuer!==origin)return null;
 const url=new URL(link);
 if(url.searchParams.getAll('redirect_uri').length!==1||url.searchParams.get('redirect_uri')!==callbackOrigin+'/api/v1/starli/mcp/oauth/callback'||url.searchParams.getAll('scope').length!==1||url.searchParams.get('scope')!=='read')return null;
 return url.href;
}
