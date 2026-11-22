export const VERSION='starli.customer-api.v1';
export const API_BASE='https://starlidigital.ro/api/customer/v1';
export const SCOPES=['bots:read','conversations:read','messages:send','runs:read','runs:cancel'] as const;
export type Scope=typeof SCOPES[number];
export type OwnedBot={id:string;name:string;kind?:string;provider?:string};
export type BotAccess={mode:'all_owned'}|{mode:'selected';botIds:string[]};
export type TokenMetadata={id:string;name:string;scopes:Scope[];botAccess:BotAccess;createdAt:number;expiresAt:number;lastUsedAt:number|null;revokedAt:number|null};
export class AccessError extends Error{
 status:number;
 constructor(status:number,message:string){super(message);this.status=status;}
}
function validId(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);}
function timestamp(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
export function tokenMetadata(value:any):TokenMetadata{
 if(!value||!validId(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||
  !Array.isArray(value.scopes)||!value.scopes.length||value.scopes.some((s:any)=>!SCOPES.includes(s))||
  !timestamp(value.createdAt)||!timestamp(value.expiresAt)||
  (value.lastUsedAt!==null&&!timestamp(value.lastUsedAt))||(value.revokedAt!==null&&!timestamp(value.revokedAt)))throw new AccessError(503,'The token metadata could not be verified.');
 const access=value.botAccess;
 if(!access||!(access.mode==='all_owned'&&access.botIds===undefined||access.mode==='selected'&&Array.isArray(access.botIds)&&access.botIds.length&&access.botIds.every(validId)))throw new AccessError(503,'The token access could not be verified.');
 return {id:value.id,name:value.name,scopes:[...value.scopes],botAccess:access.mode==='all_owned'?{mode:'all_owned'}:{mode:'selected',botIds:[...access.botIds]},
  createdAt:value.createdAt,expiresAt:value.expiresAt,lastUsedAt:value.lastUsedAt,revokedAt:value.revokedAt};
}
export function creationInput(name:string,expiresAt:number,scopes:Scope[],access:BotAccess,bots:OwnedBot[],now=Date.now()/1000){
 if(!name.trim()||name.trim().length>100)throw new AccessError(422,'Enter a token name of 1–100 characters.');
 if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+366*86400)throw new AccessError(422,'Choose an expiration within 366 days.');
 if(!scopes.length||scopes.some(s=>!SCOPES.includes(s)))throw new AccessError(422,'Select at least one supported scope.');
 if(access.mode==='selected'&&(!access.botIds.length||access.botIds.some(id=>!validId(id)||!bots.some(b=>b.id===id))))throw new AccessError(422,'Select owned bots for this token.');
 return {name:name.trim(),expiresAt,scopes:[...new Set(scopes)],botAccess:access.mode==='all_owned'?{mode:'all_owned'}:{mode:'selected',botIds:[...new Set(access.botIds)]}};
}
export class ApiAccessClient{
 #fetch:typeof fetch;#bearer='';#account='';#generation=0;#controllers=new Set<AbortController>();
 constructor(fetcher:typeof fetch=globalThis.fetch.bind(globalThis)){this.#fetch=fetcher;}
 setSession(account:string,bearer:string){
  if(account===this.#account&&bearer===this.#bearer)return false;
  this.#generation++;for(const controller of this.#controllers)controller.abort();this.#controllers.clear();
  this.#account=account;this.#bearer=bearer;return true;
 }
 clear(){this.setSession('','');}
 async #request(path='',method='GET',body?:unknown){
  if(!this.#account||!this.#bearer||this.#bearer.startsWith('stli_')||this.#bearer.startsWith('sk-'))throw new AccessError(401,'Sign in to Starli to manage API tokens.');
  const generation=this.#generation,controller=new AbortController();this.#controllers.add(controller);
  try{
   const response=await this.#fetch('/api/v1/starli/api-tokens'+path,{method,signal:controller.signal,credentials:'same-origin',cache:'no-store',
    headers:{Authorization:'Bearer '+this.#bearer,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(generation!==this.#generation)throw new AccessError(409,'Account changed. Refresh API Access.');
   if(!response.ok){
    const message=response.status===404||response.status===503?'API Access is not available on this server yet.':response.status===401?'Your session ended. Sign in again.':response.status===403?'Your session does not permit this action.':response.status===429?'The token limit or request limit was reached.':response.status===422?'Check the token fields and expiration.':'The API Access request failed. Refresh before retrying.';
    throw new AccessError(response.status,message);
   }
   const data=await response.json();
   if(generation!==this.#generation)throw new AccessError(409,'Account changed. Refresh API Access.');
   if(data?.version!==VERSION)throw new AccessError(503,'The API Access contract could not be verified.');
   return data;
  }finally{this.#controllers.delete(controller);}
 }
 async list(){const data=await this.#request();if(!Array.isArray(data.data))throw new AccessError(503,'The token list could not be verified.');return data.data.map(tokenMetadata);}
 async create(body:ReturnType<typeof creationInput>){
  const data=await this.#request('','POST',body),metadata=tokenMetadata(data);
  if(typeof data.token!=='string'||!/^stli_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(data.token))throw new AccessError(503,'The one-time token could not be verified.');
  return {metadata,token:data.token};
 }
 async revoke(id:string){if(!validId(id))throw new AccessError(422,'Invalid token ID.');const data=await this.#request('/'+encodeURIComponent(id),'DELETE');if(data.revoked!==true)throw new AccessError(503,'Revocation could not be verified. Refresh the token list.');}
}
export function example(botId:string,language:'curl'|'javascript'|'python'){
 if(!validId(botId))return 'Select an owned bot to see an example.';
 const model='starli/'+botId;
 if(language==='curl'){
  const continuation=String.fromCharCode(92);
  return [`curl -N '${API_BASE}/chat/completions' ${continuation}`,
   `  -H "Authorization: Bearer $STARLI_TOKEN" ${continuation}`,
   `  -H 'Content-Type: application/json' ${continuation}`,
   `  -H 'Idempotency-Key: save-and-reuse-this-request-id' ${continuation}`,
   `  -d '${JSON.stringify({model,messages:[{role:'user',content:'Hello'}],stream:true})}'`].join('\n');
 }
 if(language==='javascript')return `import OpenAI from 'openai';\nconst client = new OpenAI({apiKey: process.env.STARLI_TOKEN, baseURL: '${API_BASE}', maxRetries: 0});\nconst stream = await client.chat.completions.create({model: '${model}', messages: [{role: 'user', content: 'Hello'}], stream: true}, {headers: {'Idempotency-Key': 'save-and-reuse-this-request-id'}});\nfor await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta.content ?? '');`;
 return `import os\nfrom openai import OpenAI\nclient = OpenAI(api_key=os.environ['STARLI_TOKEN'], base_url='${API_BASE}', max_retries=0)\nstream = client.chat.completions.create(model='${model}', messages=[{'role': 'user', 'content': 'Hello'}], stream=True, extra_headers={'Idempotency-Key': 'save-and-reuse-this-request-id'})\nfor chunk in stream:\n    print(chunk.choices[0].delta.content or '', end='')`;
}
