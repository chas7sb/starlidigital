import {readFileSync,lstatSync} from 'node:fs';

/** Fail-closed OAuth registered-client policy for the Starli Control Plane.
 * Uses an operator-owned client registry, never client-submitted redirect hosts
 * or tenant identities. No secrets or provider calls are performed here.
 */
export type RegisteredClient = Readonly<{
  clientId:string;
  redirectUris:readonly string[];
  scopes:readonly string[];
  enabled:boolean;
}>;
export class OAuthClientPolicyError extends Error {
  constructor(public readonly code:string) {super(code);}
}
function err(code:string):never{throw new OAuthClientPolicyError(code);}
const FIRST_PARTY="starliapp-native-mcp-readonly";
const DEVELOPMENT="starliapp-native-mcp-development";
const DEV_REDIRECTS=new Set([
 "https://starliapp.com/api/v1/starli/mcp/development/callback",
 "https://starlidigital.ro/api/v1/starli/mcp/development/callback"
]);
const APP_REDIRECTS=new Set([
 "https://starliapp.com/api/v1/starli/mcp/oauth/callback",
 "https://starlidigital.ro/api/v1/starli/mcp/oauth/callback"
]);
const SCOPE=new Set(["read","write","admin"]);
function isHttpsCallback(raw:string):boolean {
  try {
    const u=new URL(raw);
    return u.protocol==="https:" && !u.username && !u.password && !u.hash &&
           raw===u.href && u.port==="" && u.hostname.length<=253;
  }catch{return false;}
}
export function parseRegisteredClients(raw:string|undefined):ReadonlyMap<string,RegisteredClient>{
  if(typeof raw!=="string" || raw.length===0 || raw.length>32768)err("OAUTH_CLIENTS_CONFIG_REQUIRED");
  let data:unknown;
  try {data=JSON.parse(raw);}catch{err("OAUTH_CLIENTS_CONFIG_INVALID");}
  if(data===null||typeof data!=="object"||Array.isArray(data)||
     Object.keys(data).sort().join(",")!=="clients"||
     !Array.isArray((data as any).clients)|| (data as any).clients.length>40)err("OAUTH_CLIENTS_CONFIG_INVALID");
  const result=new Map<string,RegisteredClient>();
  for(const item of (data as any).clients){
    if(item===null||typeof item!=="object"||Array.isArray(item)||
       Object.keys(item).sort().join(",")!=="clientId,enabled,redirectUris,scopes"||
       typeof item.clientId!=="string"||!/^[a-z0-9][a-z0-9._-]{1,119}$/.test(item.clientId)||
       typeof item.enabled!=="boolean"||!Array.isArray(item.redirectUris)||
       item.redirectUris.length<1||item.redirectUris.length>20||
       !item.redirectUris.every((v:unknown)=>typeof v==="string"&&isHttpsCallback(v))||
       new Set(item.redirectUris).size!==item.redirectUris.length||
       !Array.isArray(item.scopes)||item.scopes.length<1||item.scopes.length>3||
       !item.scopes.every((v:unknown)=>typeof v==="string"&&SCOPE.has(v))||
       new Set(item.scopes).size!==item.scopes.length||
       result.has(item.clientId))err("OAUTH_CLIENTS_CONFIG_INVALID");
    if(item.clientId===FIRST_PARTY &&
       (item.scopes.length!==1||item.scopes[0]!=="read"||
       item.redirectUris.some((v:string)=>!APP_REDIRECTS.has(v))))err("OAUTH_FIRST_PARTY_CONFIG_DENIED");
    // Operator-owned exact first-party development client. No redirect wildcards,
    // public registration or scope expansion by caller-provided fields.
    if(item.clientId===DEVELOPMENT &&
       (item.scopes.join(" ")!=="read write admin" ||
        item.redirectUris.length!==2 ||
        item.redirectUris.some((v:string)=>!DEV_REDIRECTS.has(v))))
      err("OAUTH_DEVELOPMENT_CONFIG_DENIED");
    result.set(item.clientId,Object.freeze({
       clientId:item.clientId,redirectUris:Object.freeze([...item.redirectUris]),
       scopes:Object.freeze([...item.scopes]),enabled:item.enabled
    }));
  }
  if(result.size===0)err("OAUTH_CLIENTS_CONFIG_REQUIRED");
  return result;
}
/** Fixed, root-controlled registry; no client-supplied paths or secrets. */
export function registeredClients(path='/etc/starlidigital/control-oauth-clients.json'):ReadonlyMap<string,RegisteredClient>{
  let bytes:string;
  try{
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode & 0o022)!==0)err('OAUTH_CLIENTS_CONFIG_DENIED');
    bytes=readFileSync(path,'utf8');
  }catch{err('OAUTH_CLIENTS_CONFIG_REQUIRED');}
  return parseRegisteredClients(bytes);
}

export type AuthorizationRequest = {
 response_type?:string;client_id?:string;redirect_uri?:string;scope?:string;
 state?:string;code_challenge?:string;code_challenge_method?:string
};
export function authorizeRequest(
 p:AuthorizationRequest,configured:ReadonlyMap<string,RegisteredClient>
):Readonly<{clientId:string;redirectUri:string;scope:string;state:string;challenge:string}>{
 const item=configured.get(String(p.client_id||""));
 if(!item||!item.enabled)err("OAUTH_CLIENT_NOT_REGISTERED");
 if(p.response_type!=="code"||p.code_challenge_method!=="S256"||
    typeof p.code_challenge!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)||
    typeof p.state!=="string"||!/^[A-Za-z0-9_-]{24,200}$/.test(p.state))
       err("OAUTH_PKCE_STATE_REQUIRED");
 if(typeof p.redirect_uri!=="string"||!item.redirectUris.includes(p.redirect_uri))
       err("OAUTH_REDIRECT_NOT_REGISTERED");
 const scopes=(p.scope||"read").split(" ").filter(Boolean);
 if(scopes.length<1||scopes.length>3||new Set(scopes).size!==scopes.length||
    scopes.some(s=>!item.scopes.includes(s)))err("OAUTH_SCOPE_NOT_REGISTERED");
 if(item.clientId===FIRST_PARTY &&
    (scopes.length!==1||scopes[0]!=="read"||
     !APP_REDIRECTS.has(p.redirect_uri)))err("OAUTH_FIRST_PARTY_SCOPE_DENIED");
 if(item.clientId===DEVELOPMENT &&
    (scopes.join(" ")!=="read write admin" || !DEV_REDIRECTS.has(p.redirect_uri)))
      err("OAUTH_DEVELOPMENT_SCOPE_DENIED");
 return Object.freeze({
   clientId:item.clientId,redirectUri:p.redirect_uri,
   scope:scopes.join(" "),state:p.state,challenge:p.code_challenge
 });
}
export function tokenExchangeAllowed(
 codeRecord:{clientId?:string;redirectUri?:string;scope?:string;
             codeChallenge?:string;codeChallengeMethod?:string;state?:string},
 form:{client_id?:string|null;redirect_uri?:string|null;code_verifier?:string|null},
 configured:ReadonlyMap<string,RegisteredClient>
):boolean {
 if(typeof form.code_verifier!=="string"||!/^[-._~A-Za-z0-9]{43,128}$/.test(form.code_verifier))return false;
 if(!codeRecord.clientId||!codeRecord.redirectUri||
    form.client_id!==codeRecord.clientId||form.redirect_uri!==codeRecord.redirectUri)return false;
 try{
   authorizeRequest({response_type:"code",client_id:codeRecord.clientId,
     redirect_uri:codeRecord.redirectUri,scope:codeRecord.scope,
     state:codeRecord.state,code_challenge:codeRecord.codeChallenge,
     code_challenge_method:codeRecord.codeChallengeMethod},configured);
   return true;
 }catch{return false;}
}
