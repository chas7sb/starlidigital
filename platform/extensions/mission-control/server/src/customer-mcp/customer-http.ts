import type {createLoopApprovalFlow} from '../facebook-integration/loop-approval.js';
/**
 * LCG1 isolated customer-only Facebook MCP/OAuth HTTP surface.
 * NOT mounted on frozen V2 or admin MCP. Host on a separately reviewed HTTPS
 * origin/ingress and inject the EXACT LCG10 four Zod schemas/handlers.
 */
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {ZodTypeAny} from 'zod';
import type {Store, RecordData} from '../store.js';
import {sessionContext, refresh, verifyPassword, hashToken, parseCookies, type Context} from '../security.js';
import {
  CustomerFacebookMcpAuth, CustomerMcpAuthError, CUSTOMER_FACEBOOK_SCOPES,
  CUSTOMER_FACEBOOK_TOOL_SCOPES, authenticateFacebookCustomerToolCall,
  customerFacebookMcpToolContext, listCustomerFacebookTools,
  type CustomerMcpPrincipal, type CustomerFacebookTool, type TrustedCustomerMcpOAuthClient
} from './customer-auth.js';

const CONSENTS = 'customer-facebook-mcp-http-consents';
const RATELIMITS = 'customer-facebook-mcp-http-rate-limits';
const AUDITS = 'customer-facebook-mcp-http-audit';
const MAX_FORM = 16_384;
const MAX_MCP = 131_072; // opaque media refs, NOT binary upload
const STANDARD_AUTH_METADATA = '/.well-known/oauth-authorization-server';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const same = (a: string,b: string) => {
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length && timingSafeEqual(left,right);
};
const html = (text: string) => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const requiredString = (v: string|null, max=300) => v && v.length>0 && v.length<=max ? v : null;
const safeId = (v: unknown): v is string => typeof v==='string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(v);

type StoredConsent = {
  id: string; ownerId: string; tenantId: string; userId: string; sessionHash: string;
  csrfHash: string; clientId: string; redirectUri: string; state: string;
  codeChallenge: string; scopes: string[]; expiresAt: number;
};
export type CustomerFacebookHttpTool = {
  name: CustomerFacebookTool;
  description: string;
  /** EXACT committed LCG10 zod input, not a new permissive schema. */
  inputSchema: ZodTypeAny;
  /** Inject LCG10 `createCustomerFacebookMcpHandlers` method, never admin tools. */
  invoke: (context: ReturnType<typeof customerFacebookMcpToolContext>, args: unknown, trustedAuthorization?: unknown) => Promise<unknown>;
  /** Must fetch immutable Page/job from trusted Store by principal + ref. */
  loadStoredResource?: (principal: CustomerMcpPrincipal, args: unknown) => unknown;
};
export type CustomerFacebookMcpHttpOptions = {
  store: Store;
  /** Trusted configured HTTPS public issuer, not req.headers.host or forwarded header. */
  issuer: string;
  /** Existing LCG1 auth client registry MUST be the same as this handler's registry. */
  registeredClients: readonly TrustedCustomerMcpOAuthClient[];
  tools: readonly CustomerFacebookHttpTool[];
  loopApproval?:ReturnType<typeof createLoopApprovalFlow>;
  clock?: () => number;
};
const isCustomerTool = (name: string): name is CustomerFacebookTool =>
  Object.prototype.hasOwnProperty.call(CUSTOMER_FACEBOOK_TOOL_SCOPES,name);

function status(res: ServerResponse, code: number, data: unknown, headers: Record<string,string>={}) {
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});
  res.end(JSON.stringify(data));
}
async function body(req: IncomingMessage, maximum: number): Promise<string> {
  const claim = Number(req.headers['content-length']||0);
  if (Number.isFinite(claim) && claim > maximum) throw new HttpFailure(413,'Request too large');
  let size=0;
  const chunks: Buffer[]=[];
  for await(const part of req){
    const buf=Buffer.isBuffer(part)?part:Buffer.from(part);
    size+=buf.length;
    if(size>maximum) throw new HttpFailure(413,'Request too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
class HttpFailure extends Error { constructor(readonly statusCode: number,message:string){super(message);} }
function exactForm(req:IncomingMessage): boolean {
  return /^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers['content-type']||''));
}
function isTrustedOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  if (origin === undefined) return true;
  if (origin === expectedOrigin) return true;
  if (origin === "https://chatgpt.com" || origin === "https://chat.openai.com") return true;
  if (origin === "null") return true;
  return false;
}

function checkCors(req: IncomingMessage, expectedOrigin: string): void {
  const origin = req.headers.origin;
  if (!isTrustedOrigin(origin, expectedOrigin)) throw new HttpFailure(403, "Untrusted request origin");
}

/**
 * Returns a mountable Node HTTP handler, never listens or opens provider sockets.
 * In production an HTTPS server/ingress MUST use `issuer` as its configured
 * external origin and reject non-TLS forwarding; this handler cannot infer TLS.
 */
function findCustomerUser(store: Store, usernameOrId: string): RecordData | undefined {
  let user = store.findUser(usernameOrId) || store.user(usernameOrId);
  if (!user) {
    try {
      const row = store.db.prepare("SELECT payload FROM starli_main.users WHERE username=? COLLATE NOCASE OR id=?").get(usernameOrId, usernameOrId) as {payload: string} | undefined;
      if (row) {
        user = JSON.parse(String(row.payload));
        store.saveUser(user!);
      }
    } catch {
      // starli_main not attached, ignore
    }
  }
  return user;
}

function getCustomerSession(store: Store, req: IncomingMessage): Context | null {
  const cookieHeader = String(req.headers.cookie || "");
  const ctx = sessionContext(store, cookieHeader);
  refresh(ctx);
  if (ctx.user && !ctx.user.disabled && ctx.user.role === "USER" && ctx.sessionHash) {
    return ctx;
  }
  const cookies = parseCookies(cookieHeader);
  if (cookies.starli_session) {
    const tokenHash = hashToken(cookies.starli_session);
    try {
      const row = store.db.prepare("SELECT user_id, expires_at FROM starli_main.sessions WHERE token_hash=? AND expires_at>?").get(tokenHash, Date.now()) as {user_id: string; expires_at: number} | undefined;
      if (row) {
        store.db.prepare("INSERT OR REPLACE INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)").run(tokenHash, row.user_id, row.expires_at);
        const user = findCustomerUser(store, String(row.user_id));
        if (user && !user.disabled && user.role === "USER") {
          return {
            store,
            user,
            sessionHash: tokenHash,
            setCookie: () => {},
            ip: req.socket.remoteAddress || "local",
          };
        }
      }
    } catch {
      // starli_main not attached, ignore
    }
  }
  return null;
}

export function createCustomerFacebookMcpHttpHandler(options: CustomerFacebookMcpHttpOptions) {
  const {store,registeredClients,tools}=options;
  const clock=options.clock ?? (()=>Date.now());
  const issuer=new URL(options.issuer);
  if(issuer.protocol!=='https:' || issuer.username || issuer.password || issuer.search || issuer.hash ||
    issuer.pathname!=='/' || issuer.toString()!==`${issuer.origin}/`)
    throw new Error('Customer MCP requires a fixed HTTPS origin issuer');
  const configuredClients=registeredClients.filter(c=>c.enabled && c.clientId && c.redirectUris.length>0);
  if(!configuredClients.length || new Set(configuredClients.map(c=>c.clientId)).size!==configuredClients.length)
    throw new Error('Customer MCP requires a unique trusted OAuth client registry');
  const minimumTools=['facebook_pages_publish_now','facebook_pages_schedule','facebook_pages_list','facebook_pages_cancel'];
  if(tools.length<4 || tools.length>Object.keys(CUSTOMER_FACEBOOK_TOOL_SCOPES).length || new Set(tools.map(t=>t.name)).size!==tools.length ||
    tools.some(t=>!isCustomerTool(t.name)||!t.inputSchema||typeof t.invoke!=='function') ||
    minimumTools.some(n=>!tools.some(t=>t.name===n)))
    throw new Error('Customer MCP requires mandatory original customer tools and only allowlisted additions');
  for(const tool of tools) {
    if(['facebook_pages_publish_now','facebook_pages_schedule','facebook_pages_cancel',
       'facebook_pages_select','facebook_pages_clear',
       'social_loop_create','social_loop_get','social_loop_pause','social_loop_resume',
       'social_loop_update','social_loop_cancel','social_loop_history'].includes(tool.name) && typeof tool.loadStoredResource!=='function')
      throw new Error('Customer Page/job mutations require trusted resource resolvers');
  }
  const byName=new Map(tools.map(t=>[t.name,t]));
  // Never advertise or issue consent for an unregistered capability.
  // Four-tool legacy clients retain read/publish; upload-enabled clients add media.write.
  const advertisedScopes=CUSTOMER_FACEBOOK_SCOPES.filter(scope=>
    tools.some(tool=>CUSTOMER_FACEBOOK_TOOL_SCOPES[tool.name]===scope));
  const auth=new CustomerFacebookMcpAuth(store,registeredClients,clock);
  const paths={
    authorization:'/customer/oauth/authorize',token:'/customer/oauth/token',
    revoke:'/customer/oauth/revoke',mcp:'/customer/mcp',
    authorizationMetadata:'/.well-known/oauth-authorization-server/customer',
    resourceMetadata:'/.well-known/oauth-protected-resource/customer/mcp'
  } as const;
  const uri=(path:string)=>new URL(path,issuer).href;
  const resource=uri(paths.mcp),resourceMetadata=uri(paths.resourceMetadata);
  function audit(kind:string,outcome:'PASS'|'DENIED'|'FAILED',ownerId?:string,tool?:string) {
    store.put(AUDITS,{id:randomUUID(),ownerId:ownerId??'system',at:new Date(clock()).toISOString(),
      kind,outcome,tool:tool && isCustomerTool(tool)?tool:undefined},ownerId??'system');
  }
  /** Durable, windowed SQLite limiter; not an in-memory per-process rate limiter. */
  function limit(key:string,max:number,windowMs:number) {
    const now=clock(),id=hash(`${key}:${Math.floor(now/windowMs)}`);
    store.db.exec('BEGIN IMMEDIATE');
    try {
      const existing=store.get(RATELIMITS,id);
      const count=Number(existing?.count||0);
      if(count>=max){store.db.exec('COMMIT');return false;}
      store.put(RATELIMITS,{id,count:count+1,expiresAt:(Math.floor(now/windowMs)+1)*windowMs},'system');
      store.db.exec('COMMIT');
      return true;
    }catch(err){if(store.db.isTransaction)store.db.exec('ROLLBACK');throw err;}
  }
  function limitRequest(req:IncomingMessage,scope:string,max=40,perMs=60_000){
    // Never accept untrusted X-Forwarded-For; trusted proxy must enforce its own edge limits.
    const peer=req.socket.remoteAddress||'unknown';
    if(!limit(`${scope}:${peer}`,max,perMs)) throw new HttpFailure(429,'Request limit exceeded');
  }
  function customerCookie(req: IncomingMessage) {
    const session = getCustomerSession(store, req);
    if (!session || !session.user || session.user.disabled || session.user.role !== "USER" || !session.sessionHash) {
      throw new HttpFailure(401, "Customer login required");
    }
    return session;
  }
  function client(clientId:string,redirectUri:string){
    const known=configuredClients.find(c=>c.clientId===clientId);
    const clean=redirectUri.trim();
    const isExact=Boolean(known?.redirectUris.includes(clean));
    const isChatGptConnector=Boolean((known?.clientId==='chatgpt'||known?.clientId==='starlidigital-customer-pilot')&&
      (clean.startsWith('https://chatgpt.com/connector/oauth/')||clean.startsWith('https://chat.openai.com/connector/oauth/')));
    if(!known||(!isExact&&!isChatGptConnector)||!clean.startsWith('https://'))
      throw new HttpFailure(400,'Unknown customer OAuth client or callback');
  }
  function validateAuthorize(url:URL){
    const clientId=requiredString(url.searchParams.get('client_id'),128);
    const redirectUri=requiredString(url.searchParams.get('redirect_uri'),2048);
    const challenge=requiredString(url.searchParams.get('code_challenge'),128);
    const state=requiredString(url.searchParams.get('state'),512);
    const scope=requiredString(url.searchParams.get('scope'),300);
    if(!clientId||!redirectUri||!state||!challenge||!scope||url.searchParams.get('response_type')!=='code'||
       url.searchParams.get('code_challenge_method')!=='S256'||!/^[-_a-zA-Z0-9]{43}$/.test(challenge)||
       !/^[A-Za-z0-9_.~:-]{12,512}$/.test(state))
      throw new HttpFailure(400,'Invalid customer OAuth authorization request');
    client(clientId,redirectUri);
    const scopes=scope.split(' ');
    if(scopes.length<1||scopes.length>advertisedScopes.length||new Set(scopes).size!==scopes.length||
      scopes.some(s=>!advertisedScopes.includes(s as typeof CUSTOMER_FACEBOOK_SCOPES[number])))
      throw new HttpFailure(400,'Unsupported customer OAuth scope');
    return{clientId,redirectUri,challenge,state,scopes};
  }
  function renderCustomerLoginPage(res: ServerResponse, url: URL, error?: string, statusCode = 401) {
    res.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff"
    });
    const formAction = `${paths.authorization}${url.search}`;
    res.end(`<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <title>Autentificare Starli Digital ? ChatGPT MCP</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0c10; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #16181f; border: 1px solid #232733; border-radius: 12px; padding: 32px; width: 100%; max-width: 420px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p { color: #8c93a8; font-size: 14px; margin-top: 0; margin-bottom: 20px; line-height: 1.5; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; color: #c0c6d8; }
    input { width: 100%; box-sizing: border-box; background: #0f1015; border: 1px solid #2a2e3d; border-radius: 8px; color: #fff; padding: 12px; font-size: 14px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #6366f1; }
    button { width: 100%; background: #6366f1; color: #fff; font-weight: 600; border: none; border-radius: 8px; padding: 12px; font-size: 14px; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #4f46e5; }
    .error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 10px; border-radius: 6px; font-size: 13px; margin-bottom: 16px; }
    .badge { display: inline-block; background: #242938; color: #a5b4fc; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Starli Digital ? Customer Facebook MCP</div>
    <h1>Autentificare Client</h1>
    <p>Conecteaz? contul t?u Starli Digital la ChatGPT pentru operarea asistentului dedicat Facebook Pages.</p>
    ${error ? `<div class="error">${html(error)}</div>` : ""}
    <form method="post" action="${formAction}">
      <label for="username">Nume utilizator sau Email</label>
      <input id="username" name="username" type="text" required autofocus placeholder="ex. velour" autocomplete="username">
      <label for="password">Parol?</label>
      <input id="password" name="password" type="password" required autocomplete="current-password">
      <button type="submit">Autentificare ?i Continuare</button>
    </form>
  </div>
</body>
</html>`);
  }

  function renderConsentHtml(user: RecordData, request: ReturnType<typeof validateAuthorize>, nonce: string, csrf: string, actionPath: string) {
    const username = html(String(user.username || user.id));
    const clientId = html(request.clientId);
    const scopeNames = request.scopes.map(s => {
      if (s === "facebook.pages.read") return "Citire pagini Facebook ?i statistici (facebook.pages.read)";
      if (s === "facebook.pages.publish") return "Publicare ?i programare post?ri pe Facebook (facebook.pages.publish)";
      if (s === "facebook.media.write") return "?nc?rcare imagini media private (facebook.media.write)";
      return html(s);
    });
    return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <title>Conectare ChatGPT ? Starli Digital Facebook MCP</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0c10; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #16181f; border: 1px solid #232733; border-radius: 12px; padding: 32px; width: 100%; max-width: 440px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p { color: #8c93a8; font-size: 14px; margin-top: 0; margin-bottom: 20px; line-height: 1.5; }
    .user-info { background: #0f1015; border: 1px solid #232733; border-radius: 8px; padding: 12px; font-size: 13px; margin-bottom: 16px; color: #c0c6d8; }
    .scope-box { background: #0f1015; border: 1px solid #232733; border-radius: 8px; padding: 14px; font-size: 13px; margin-bottom: 20px; color: #c0c6d8; }
    .scope-box ul { margin: 8px 0 0 18px; padding: 0; }
    .scope-box li { margin-bottom: 6px; }
    .btn-allow { width: 100%; background: #6366f1; color: #fff; font-weight: 600; border: none; border-radius: 8px; padding: 12px; font-size: 14px; cursor: pointer; transition: background 0.15s; margin-bottom: 10px; }
    .btn-allow:hover { background: #4f46e5; }
    .btn-deny { width: 100%; background: transparent; color: #8c93a8; font-weight: 500; border: 1px solid #2a2e3d; border-radius: 8px; padding: 10px; font-size: 13px; cursor: pointer; transition: background 0.15s; }
    .btn-deny:hover { background: #1a1d26; color: #fff; }
    .badge { display: inline-block; background: #242938; color: #a5b4fc; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Starli Digital ? Control Acces MCP</div>
    <h1>Conecteaz? ChatGPT la Facebook Pages</h1>
    <div class="user-info">
      Autentificat ca <strong>${username}</strong> (Client). Conector: <code>${clientId}</code>
    </div>
    <div class="scope-box">
      Permisiuni solicitate:
      <ul>
        ${scopeNames.map(s => `<li>${s}</li>`).join("")}
      </ul>
    </div>
    <form method="post" action="${actionPath}">
      <input type="hidden" name="request_id" value="${nonce}">
      <input type="hidden" name="csrf_token" value="${csrf}">
      <button type="submit" name="decision" value="allow" class="btn-allow">Autorizeaz? aceste permisiuni client</button>
      <button type="submit" name="decision" value="deny" class="btn-deny">Refuz?</button>
    </form>
  </div>
</body>
</html>`;
  }

  async function consentGet(req: IncomingMessage, res: ServerResponse, url: URL) {
    limitRequest(req, "customer-consent-get", 12);
    const request = validateAuthorize(url);
    const session = getCustomerSession(store, req);
    if (!session) {
      renderCustomerLoginPage(res, url);
      return;
    }
    if (session.user!.role !== "USER") {
      renderCustomerLoginPage(res, url, "Acces interzis: Doar clien?ii Starli pot conecta asistentul Customer MCP.", 401);
      return;
    }
    const ctx = session;
    const nonce = secret(), csrf = secret();
    const pending: StoredConsent = {
      id: hash(nonce), ownerId: ctx.user!.id, tenantId: ctx.user!.id,
      userId: ctx.user!.id, sessionHash: ctx.sessionHash!, csrfHash: hash(csrf),
      clientId: request.clientId, redirectUri: request.redirectUri, state: request.state,
      codeChallenge: request.challenge, scopes: request.scopes, expiresAt: clock() + 5 * 60_000
    };
    store.put(CONSENTS, pending, pending.ownerId);
    audit("consent-offered", "PASS", pending.ownerId);
    // Chromium applies form-action to the POST's redirect as well.
    const callbackOrigin = new URL(request.redirectUri).origin;
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callbackOrigin}; base-uri 'none'; frame-ancestors 'none'`,
      "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "X-Content-Type-Options": "nosniff"
    });
    res.end(renderConsentHtml(ctx.user!, request, nonce, csrf, paths.authorization));
  }

  async function loginPost(req: IncomingMessage, res: ServerResponse, url: URL, data: URLSearchParams, loopApproval=false) {
    limitRequest(req, "customer-login-post", 15);
    if (!isTrustedOrigin(req.headers.origin, issuer.origin)) {
      throw new HttpFailure(403, "Untrusted request origin");
    }
    if(!loopApproval)validateAuthorize(url);
    const username = (data.get("username") || "").trim().toLowerCase().replace(/@starlidigital\.ro$/, "");
    const password = data.get("password") || "";
    if (!username || !password || password.length > 128) {
      renderCustomerLoginPage(res, url, "Introdu numele de utilizator ?i parola.", 401);
      return;
    }
    const user = findCustomerUser(store, username);
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = verifyPassword(password, user?.passwordHash || dummy);
    if (!user || !valid || user.disabled) {
      audit("customer-login", "DENIED", user?.id || "unknown");
      renderCustomerLoginPage(res, url, "Nume de utilizator sau parol? incorect?.", 401);
      return;
    }
    if (user.role !== "USER") {
      audit("customer-login", "DENIED", user.id);
      renderCustomerLoginPage(res, url, "Acces interzis: Doar clien?ii Starli pot conecta asistentul Customer MCP.", 401);
      return;
    }
    const token = randomBytes(32).toString("hex");
    const sessionHash = hashToken(token);
    const expiresAt = clock() + 7 * 86_400_000;
    store.db.prepare("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)").run(sessionHash, user.id, expiresAt);
    audit("customer-login", "PASS", user.id);
    const isHttps = issuer.protocol === "https:";
    const cookieHeader = `starli_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${isHttps ? "; Secure" : ""}`;
    const redirectTarget = `${paths.authorization}?${url.searchParams.toString()}`;
    res.writeHead(303, {
      "Location": redirectTarget,
      "Set-Cookie": cookieHeader,
      "Cache-Control": "no-store",
      "Referrer-Policy": "same-origin"
    });
    res.end();
  }

  async function consentPost(req: IncomingMessage, res: ServerResponse, data: URLSearchParams) {
    limitRequest(req, "customer-consent-post", 20);
    if (!isTrustedOrigin(req.headers.origin, issuer.origin)) throw new HttpFailure(403, "Consent origin mismatch");
    const ctx = customerCookie(req);
    const requestId = data.get("request_id"), csrf = data.get("csrf_token");
    const decision = data.get("decision");
    if (!requestId || !/^[A-Za-z0-9_-]{43}$/.test(requestId) || !csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf) ||
      (decision !== "allow" && decision !== "deny")) throw new HttpFailure(403, "Invalid consent submission");
    const id = hash(requestId);
    store.db.exec("BEGIN IMMEDIATE");
    let pending: StoredConsent | undefined;
    try {
      pending = store.get(CONSENTS, id) as StoredConsent | undefined;
      if (!pending || pending.id !== id || pending.ownerId !== ctx.user!.id ||
        pending.tenantId !== ctx.user!.id || pending.userId !== ctx.user!.id ||
        pending.sessionHash !== ctx.sessionHash || pending.expiresAt <= clock() ||
        !same(pending.csrfHash, hash(csrf))) throw new HttpFailure(403, "Consent expired or rejected");
      store.remove(CONSENTS, id);
      store.db.exec("COMMIT");
    } catch (err) {
      if (store.db.isTransaction) store.db.exec("ROLLBACK");
      throw err;
    }
    if (decision === "deny") {
      audit("customer-consent", "DENIED", ctx.user!.id);
      throw new HttpFailure(403, "Customer declined authorization");
    }
    const code = auth.authorizeCustomerConnection(ctx, {
      clientId: pending.clientId, redirectUri: pending.redirectUri, codeChallenge: pending.codeChallenge,
      codeChallengeMethod: "S256", scopes: pending.scopes, consentConfirmed: true
    });
    audit("customer-consent", "PASS", ctx.user!.id);
    const target = new URL(pending.redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", pending.state);
    res.writeHead(303, { Location: target.href, "Cache-Control": "no-store", "Referrer-Policy": "same-origin" });
    res.end();
  }
  async function oauthToken(req:IncomingMessage,res:ServerResponse){
    limitRequest(req,'customer-token',30);
    if(!exactForm(req)) throw new HttpFailure(415,'Expected form content');
    const data=new URLSearchParams(await body(req,MAX_FORM));
    const clientId=data.get('client_id');
    if(!clientId) throw new HttpFailure(400,'OAuth client required');
    const grant=data.get('grant_type');
    let tokens;
    if(grant==='authorization_code'){
      const redirectUri=data.get('redirect_uri'),code=data.get('code'),verifier=data.get('code_verifier');
      if(!redirectUri||!code||!verifier) throw new HttpFailure(400,'OAuth PKCE grant is incomplete');
      tokens=auth.exchangeCode({clientId,redirectUri,code,codeVerifier:verifier});
    }else if(grant==='refresh_token'){
      const renewal=data.get('refresh_token');
      if(!renewal) throw new HttpFailure(400,'OAuth refresh token required');
      tokens=auth.refreshToken({clientId,refreshToken:renewal});
    }else throw new HttpFailure(400,'Unsupported customer OAuth grant');
    audit('customer-token-issued','PASS');
    status(res,200,tokens,{'Pragma':'no-cache'});
  }
  async function oauthRevoke(req:IncomingMessage,res:ServerResponse){
    limitRequest(req,'customer-revoke',15);
    if(!exactForm(req)) throw new HttpFailure(415,'Expected form content');
    await body(req,MAX_FORM); // no client-controlled token or owner selection
    const principal=auth.authenticateBearer(req.headers.authorization);
    auth.revokeCustomerConnection(principal);
    audit('customer-token-revoked','PASS',principal.ownerId);
    status(res,200,{revoked:true});
  }
  async function customerMcp(req:IncomingMessage,res:ServerResponse){
    limitRequest(req,'customer-mcp',90);
    if(req.method!=='POST') throw new HttpFailure(405,'Customer MCP accepts POST only');
    const principal=auth.authenticateBearer(req.headers.authorization);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))
      throw new HttpFailure(415,'MCP request must be JSON');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const jsonText=await body(req,MAX_MCP);
    let parsedBody:unknown;
    try{parsedBody=JSON.parse(jsonText);}catch{throw new HttpFailure(400,'Invalid MCP JSON');}
    if(!parsedBody||typeof parsedBody!=='object'||Array.isArray(parsedBody))
      throw new HttpFailure(400,'MCP message must be an object');
    const server=new McpServer({name:'starlidigital-facebook-customer-mcp',version:'0.2.0'});
    const exposedTools=listCustomerFacebookTools(principal,[...byName.keys()]);
    for(const name of exposedTools){
      const spec=byName.get(name)!;
      server.registerTool(name,{description:spec.description,inputSchema:spec.inputSchema},async(args:unknown)=>{
        // Every request/tool execution validates current bearer, live USER, scope,
        // and same-tenant Page/job fetched from trusted storage (NOT caller JSON).
        try{
          const approved=authenticateFacebookCustomerToolCall({auth,authorization:req.headers.authorization,
            toolName:name,toolArguments:args,
            ...(spec.loadStoredResource && !(name==='facebook_media_upload' && (args as {action?:unknown})?.action==='BEGIN')
              ?{loadStoredResource:(identity)=>spec.loadStoredResource!(identity,args)}:{})});
          const result=await spec.invoke(customerFacebookMcpToolContext(approved.principal),args,req.headers.authorization);
          const output=JSON.stringify(result);
          if(!output||output.length>65_536||/"(?:access_?token|refresh_?token|page_?token|client_?secret|password|credential_?reference|private_?key)"\s*:/i.test(output))
            throw new HttpFailure(500,'MCP tool output contains unsupported private data');
          audit('mcp-tool','PASS',approved.principal.ownerId,name);
          return {content:[{type:'text' as const,text:output}]};
        }catch{
          audit('mcp-tool','FAILED',principal.ownerId,name);
          return {isError:true,content:[{type:'text' as const,text:JSON.stringify({error:'Customer action unavailable or denied'})}]};
        }
      });
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
    try{
      await server.connect(transport);
      await transport.handleRequest(req,res,parsedBody);
      if((parsedBody as {method?:unknown}).method==='tools/list'&&res.statusCode===200){
        audit('mcp-tools-listed','PASS',principal.ownerId,
          exposedTools.includes('facebook_reel_render_spec')?'facebook_reel_render_spec':undefined);
      }
    }finally{
      await server.close();
    }
  }
  const handle=async(req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    try{
      if(typeof req.url!=='string'||req.url.length>4096) throw new HttpFailure(414,'Request URL too long');
      const url=new URL(req.url,issuer);
      if(url.origin!==issuer.origin) throw new HttpFailure(400,'Invalid request URL');
      if(req.method==='OPTIONS'){
        checkCors(req,issuer.origin);
        const originHeader = req.headers.origin;
        const allowOrigin = originHeader && isTrustedOrigin(originHeader, issuer.origin) && originHeader !== "null" ? originHeader : issuer.origin;
        res.writeHead(204,{'Cache-Control':'no-store','Access-Control-Allow-Origin':allowOrigin,
          'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':'Authorization, Content-Type, MCP-Protocol-Version'});res.end();return;
      }
      if(!isTrustedOrigin(req.headers.origin, issuer.origin))
        throw new HttpFailure(403,'Untrusted request origin');
      if((url.pathname===paths.authorizationMetadata || url.pathname===STANDARD_AUTH_METADATA || url.pathname==='/.well-known/openid-configuration')&&req.method==='GET'){
        status(res,200,{issuer:issuer.origin,authorization_endpoint:uri(paths.authorization),
          token_endpoint:uri(paths.token),revocation_endpoint:uri(paths.revoke),
          response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
          code_challenge_methods_supported:['S256'],scopes_supported:[...advertisedScopes],
          token_endpoint_auth_methods_supported:['none']});return;
      }
      if(url.pathname===paths.resourceMetadata&&req.method==='GET'){
        status(res,200,{resource,authorization_servers:[issuer.origin],
          bearer_methods_supported:['header'],scopes_supported:[...advertisedScopes]});return;
      }
      if(url.pathname===paths.authorization){
        const loopRequest=url.searchParams.get('loop_approval');
        if(loopRequest!==null){
          const flow=options.loopApproval;
          if(!flow||!/^loop-request-[a-f0-9]{64}$/.test(loopRequest))throw new HttpFailure(404,'Loop approval unavailable');
          limitRequest(req,'customer-loop-approval',30);
          if(req.method==='GET'){
            const ctx=getCustomerSession(store,req);
            if(!ctx){renderCustomerLoginPage(res,url);return;}
            let html:string;
            try{html=flow.render(loopRequest,ctx.user!.id,ctx.sessionHash!);}
            catch{throw new HttpFailure(403,'Loop approval unavailable');}
            res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
              'Content-Security-Policy':"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
              'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
            res.end(html);return;
          }
          if(req.method!=='POST'||!exactForm(req))throw new HttpFailure(415,'Expected form content');
          const data=new URLSearchParams(await body(req,MAX_FORM));
          if(data.has('username')||data.has('password')){await loginPost(req,res,url,data,true);return;}
          if(req.headers.origin!==issuer.origin||data.get('decision')!=='allow')
            throw new HttpFailure(403,'Loop approval rejected');
          const ctx=customerCookie(req);
          try{
            const loop=await flow.approve(loopRequest,ctx.user!.id,ctx.sessionHash!,data.get('csrf_token')??'');
            audit('customer-loop-approved','PASS',ctx.user!.id);
            status(res,200,{state:loop.state,loopId:loop.id,localTime:loop.localTime,timezone:loop.timezone});
          }catch{throw new HttpFailure(403,'Loop approval unavailable');}
          return;
        }

        if(req.method==='GET'){await consentGet(req,res,url);return;}
        if(req.method==='POST'){
          limitRequest(req,'customer-authorize-post',30);
          if(!exactForm(req)) throw new HttpFailure(415,'Expected form content');
          const raw=await body(req,MAX_FORM);
          const data=new URLSearchParams(raw);
          if(data.has('username') || data.has('password')){
            await loginPost(req,res,url,data);
            return;
          }
          await consentPost(req,res,data);
          return;
        }
      }
      if(url.pathname===paths.token&&req.method==='POST'){await oauthToken(req,res);return;}
      if(url.pathname===paths.revoke&&req.method==='POST'){await oauthRevoke(req,res);return;}
      if(url.pathname===paths.mcp){
        if(req.method!=='POST') throw new HttpFailure(405,'Customer MCP POST required');
        await customerMcp(req,res);return;
      }
      status(res,404,{error:'not_found'});
    }catch(err){
      const unauth=err instanceof CustomerMcpAuthError && err.code==='UNAUTHENTICATED';
      const invalid=err instanceof CustomerMcpAuthError;
      const code=err instanceof HttpFailure?err.statusCode:unauth?401:invalid?403:500;
      audit('customer-http','DENIED');
      if(!res.headersSent)status(res,code,{error:code===500?'Customer MCP request failed':
        err instanceof HttpFailure?err.message:'Customer authorization denied'},
        code===401?{'WWW-Authenticate':`Bearer resource_metadata="${resourceMetadata}"`}:{});
      else if(!res.writableEnded)res.end();
    }
  };
  return {handle,auth,paths,resourceUrl:resource,oauthIssuer:issuer.origin};
}
