import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { Store, RecordData } from './store.js';

export function fail(message: string, code = 'BAD_USER_INPUT'): never { throw new GraphQLError(message,{extensions:{code}}); }
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function hashPassword(password: string) { const salt=randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password: string, hash: string) { try {const [salt,key]=hash.split(':');const actual=scryptSync(password,salt,64);const expected=Buffer.from(key,'hex');return expected.length===actual.length && timingSafeEqual(actual,expected);}catch{return false;} }
export function validatePassword(password: string) { if(password.length<10 || password.length>128) fail('Parola trebuie să aibă între 10 și 128 de caractere.'); }
export function normalizeUsername(value: string) { const username=value.trim().toLowerCase().replace(/@starlidigital\.ro$/,''); if(!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) fail('Alege un nume de 3–30 de caractere: litere, cifre, punct, _ sau -.'); if(['admin','administrator','support','alex','starli','contact','postmaster','abuse','security'].includes(username)) fail('Acest nume este rezervat.'); return username; }
export function parseCookies(header='') { return Object.fromEntries(header.split(';').map(part=>{const i=part.indexOf('=');return i<0?['','']:[part.slice(0,i).trim(),part.slice(i+1).trim()];})); }
export type Context = { store: Store; user?: RecordData; guest?: string; sessionHash?:string; operatorTokenId?: string; operatorPermissions?: string[]; setCookie: (cookie:string)=>void; ip:string; origin?:string; };
export function sessionContext(store: Store, cookie: string, setCookie:Context['setCookie']=()=>{},ip='local', authHeader=''): Context {
  const cookies=parseCookies(cookie);let user:RecordData|undefined;let operatorTokenId:string|undefined;let operatorPermissions:string[]|undefined;
  const trimmedAuth = String(authHeader || '').trim();
  const rawToken = trimmedAuth.toLowerCase().startsWith('bearer ') ? trimmedAuth.slice(7).trim() : trimmedAuth;
  if(rawToken.startsWith('starli_op_') && rawToken.length >= 30 && rawToken.length <= 200) {
    const hashed = hashToken(rawToken);
    const tokenRecord = store.list('operator-tokens').find(t => t.tokenHash === hashed);
    if(tokenRecord && !tokenRecord.revokedAt && Date.parse(String(tokenRecord.expiresAt || '')) > Date.now()) {
      const candidate = store.user(String(tokenRecord.userId));
      if(candidate && !candidate.disabled && candidate.role === 'ADMIN') {
        user = candidate;
        operatorTokenId = tokenRecord.id;
        operatorPermissions = Array.isArray(tokenRecord.permissions) ? tokenRecord.permissions : ['READ'];
      }
    }
  }
  if(!user && cookies.starli_session) { const row=store.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hashToken(cookies.starli_session),Date.now()); if(row) user=store.user(String(row.user_id));if(user?.disabled)user=undefined; }
  return {store,user,sessionHash:cookies.starli_session?hashToken(cookies.starli_session):undefined,operatorTokenId,operatorPermissions,guest:/^[a-f0-9]{48}$/.test(cookies.starli_guest||'')?cookies.starli_guest:undefined,setCookie,ip};
}
export function refresh(ctx:Context) {
  if(ctx.user&&ctx.operatorTokenId){
    const tokenRecord=ctx.store.get('operator-tokens',ctx.operatorTokenId);
    const validToken=tokenRecord&&!tokenRecord.revokedAt&&Date.parse(String(tokenRecord.expiresAt||''))>Date.now();
    ctx.user=validToken?ctx.store.user(String(tokenRecord.userId)):undefined;
    if(ctx.user?.disabled||ctx.user?.role!=='ADMIN'){ctx.user=undefined;ctx.operatorPermissions=undefined;}
    else ctx.operatorPermissions=Array.isArray(tokenRecord?.permissions)?tokenRecord.permissions:['READ'];
    return ctx;
  }
  if(ctx.user&&ctx.sessionHash){const row=ctx.store.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(ctx.sessionHash,Date.now());ctx.user=row?ctx.store.user(String(row.user_id)):undefined;if(ctx.user?.disabled)ctx.user=undefined;}
  return ctx;
}
const secure=()=>process.env.NODE_ENV==='production'?'; Secure':'';
export function startSession(ctx:Context,user:RecordData) { const token=randomBytes(32).toString('hex');ctx.sessionHash=hashToken(token);ctx.store.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(ctx.sessionHash,user.id,Date.now()+7*86400000);ctx.setCookie(`starli_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure()}`);if(ctx.guest)ctx.store.transferGuest(ctx.guest,user.id);ctx.user=user;return user; }
export function owner(ctx:Context) { if(ctx.user)return ctx.user.id;if(!ctx.guest){ctx.guest=randomBytes(24).toString('hex');ctx.setCookie(`starli_guest=${ctx.guest}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure()}`);}return ctx.guest; }
export function requireUser(ctx:Context) { refresh(ctx);if(!ctx.user)fail('Autentifică-te pentru a continua.','UNAUTHENTICATED');return ctx.user!; }
export function requireAdmin(ctx:Context) { const user=requireUser(ctx);if(user.role!=='ADMIN')fail('Acces rezervat administratorului.','FORBIDDEN');return user; }
export function access(ctx:Context,record:RecordData|undefined) { refresh(ctx);if(!record)fail('Resursa nu există.','NOT_FOUND');if(ctx.user?.role!=='ADMIN' && record!.ownerId!==(ctx.user?.id||ctx.guest))fail('Nu ai acces la această resursă.','FORBIDDEN');return record!; }
const attempts=new Map<string,{count:number;until:number}>();
export function limit(key:string,max=20,period=60000) { const time=Date.now();let state=attempts.get(key);if(!state||state.until<time){state={count:0,until:time+period};attempts.set(key,state);}if(++state.count>max)fail('Prea multe cereri. Încearcă din nou mai târziu.','RATE_LIMITED');if(attempts.size>10000)for(const [k,v]of attempts)if(v.until<time)attempts.delete(k); }
export function bounded(value:string,max=20000,min=1) { const text=value.trim();if(text.length<min||text.length>max)fail(`Textul trebuie să aibă între ${min} și ${max} de caractere.`);return text; }
