import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store, RecordData } from '../store.js';
import { verifyPassword, refresh, type Context } from '../security.js';
import {registeredClients,authorizeRequest,tokenExchangeAllowed} from './trusted_clients.js';

export interface OAuthAuthRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export function handleOAuthMetadata(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify({
    issuer: 'https://api.starlidigital.ro',
    authorization_endpoint: 'https://api.starlidigital.ro/oauth/authorize',
    token_endpoint: 'https://api.starlidigital.ro/oauth/token',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['read', 'write', 'admin'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
  }, null, 2));
}

export async function handleOAuthAuthorize(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  context: Context
) {
  const url = new URL(req.url || '/', 'https://api.starlidigital.ro');
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  const scope = url.searchParams.get('scope') || 'read';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';

  // Client registration/redirect URI/scopes are server-owned, never supplied
  // by a model, unknown OAuth client, or a new tenant. Fail before login form.
  try {
    authorizeRequest({
      response_type: url.searchParams.get('response_type') || '',
      client_id: clientId, redirect_uri: redirectUri, scope, state,
      code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod
    },registeredClients());
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('OAuth client or callback is not registered');
    return;
  }

  // Handle POST submission of login form
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const params = new URLSearchParams(body);
      const username = (params.get('username') || '').trim().toLowerCase();
      const password = params.get('password') || '';

      const user = store.findUser(username);
      if (!user || user.disabled || !verifyPassword(password, user.passwordHash)) {
        renderLoginPage(res, url.search, 'Nume de utilizator sau parolă incorectă.',clientId);
        return;
      }

      if (user.role !== 'ADMIN') {
        renderLoginPage(res, url.search, 'Acces interzis: această conexiune necesită autentificare de administrator Starli.',clientId);
        return;
      }

      // Full development/admin scope must be consciously acknowledged
      // on the Control Plane sign-in page before any authorization code exists.
      if (clientId==='starliapp-native-mcp-development' &&
          params.get('approve_development_admin')!=='yes') {
        renderLoginPage(res,url.search,
         'Confirmă explicit accesul de dezvoltare READ / WRITE / ADMIN.',clientId);
        return;
      }

      // Generate authorization code
      const authCode = randomBytes(24).toString('hex');
      const codeRecord = {
        id: authCode,
        userId: user.id,
        clientId,
        redirectUri,
        scope,
        state,
        codeChallenge,
        codeChallengeMethod,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      };
      store.put('oauth_codes', codeRecord);

      const targetUrl = new URL(redirectUri);
      targetUrl.searchParams.set('code', authCode);
      if (state) targetUrl.searchParams.set('state', state);

      res.writeHead(302, { Location: targetUrl.toString() });
      res.end();
    });
    return;
  }

  // If already authenticated as admin via session cookie
  refresh(context);
  if (context.user && context.user.role === 'ADMIN' &&
      clientId!=='starliapp-native-mcp-readonly' &&
      clientId!=='starliapp-native-mcp-development') {
    renderConsentPage(res, context.user, clientId, scope, redirectUri, state, codeChallenge, codeChallengeMethod);
    return;
  }

  renderLoginPage(res, url.search, undefined,clientId);
}

export async function handleOAuthToken(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store
) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_request' }));
      return;
    }

    const grantType = params.get('grant_type');
    const code = params.get('code');
    const codeVerifier = params.get('code_verifier');
    const redirectUri = params.get('redirect_uri');
    const clientId = params.get('client_id');

    if (grantType !== 'authorization_code' || !code) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unsupported_grant_type' }));
      return;
    }

    const codeRecord = store.get('oauth_codes', code) as any;
    if (!codeRecord || Date.now() > codeRecord.expiresAt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Code invalid or expired' }));
      return;
    }

    // Registered client, exact redirect URI and PKCE are all mandatory.
    // A previously issued grant for another client or redirect cannot be
    // redeemed here. No tokens are minted on any validation failure.
    try {
      if (!tokenExchangeAllowed(codeRecord, {
          client_id:clientId,redirect_uri:redirectUri,code_verifier:codeVerifier
        },registeredClients())) {
        throw new Error('OAuth client code binding failed');
      }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'invalid_grant' }));
      return;
    }

    // Verify S256 PKCE
    if (codeRecord.codeChallenge) {
      if (!codeVerifier) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Code verifier required' }));
        return;
      }
      const computedChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');
      if (computedChallenge !== codeRecord.codeChallenge) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'PKCE challenge verification failed' }));
        return;
      }
    }

    // Consume code once
    store.remove('oauth_codes', code);

    // Issue Bearer Access Token
    const accessToken = 'starli_mcp_' + randomBytes(32).toString('hex');
    const tokenRecord = {
      id: accessToken,
      userId: codeRecord.userId,
      scope: codeRecord.scope || 'read write admin',
      clientId: codeRecord.clientId,
      expiresAt: Date.now() + 30 * 86400 * 1000, // 30 days
      createdAt: new Date().toISOString(),
    };
    store.put('oauth_tokens', tokenRecord);

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    });
    res.end(JSON.stringify({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 30 * 86400,
      scope: tokenRecord.scope,
    }));
  });
}

function renderLoginPage(res: ServerResponse, query: string, error?: string, clientId?: string) {
  const firstParty=clientId==='starliapp-native-mcp-readonly';
  const development=clientId==='starliapp-native-mcp-development';
  const title=development?'StarliApp — Development MCP permissions':firstParty?'Autentificare StarliApp MCP':'Autentificare Starli Digital — ChatGPT MCP';
  const heading=development?'StarliApp Development MCP':firstParty?'Conectează StarliApp':'Autorizare ChatGPT';
  const details=development?
    'Acest cont primește acces MCP READ, WRITE și ADMIN. Poate modifica surse și invoca acțiuni administrative. Instrumentele pentru boți sunt autorizate separat.':
    firstParty?'Conectează un cont de administrator Starli Control Plane la StarliApp. Accesul este doar pentru citire. Instrumentele sunt aprobate separat înainte de folosirea lor de către boți.':
    'Conectează contul de administrator Starli Digital la ChatGPT pentru operarea asistentului MCP.';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0c10; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #16181f; border: 1px solid #232733; border-radius: 12px; padding: 32px; width: 100%; max-width: 400px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p { color: #8c93a8; font-size: 14px; margin-top: 0; margin-bottom: 24px; line-height: 1.5; }
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
    <div class="badge">Starli Control Plane</div>
    <h1>${heading}</h1>
    <p>${details}</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/oauth/authorize${query}">
      <label for="username">Utilizator Administrator</label>
      <input id="username" name="username" type="text" required autofocus placeholder="admin">
      <label for="password">Parolă</label>
      <input id="password" name="password" type="password" required>
      ${development ? '<label style="display:flex;gap:9px;align-items:flex-start"><input type="checkbox" name="approve_development_admin" value="yes" style="width:auto;margin-top:2px" required><span>Înțeleg și autorizez accesul READ, WRITE și ADMIN.</span></label>' : ''}
      <button type="submit">Autentificare și Autorizare</button>
    </form>
  </div>
</body>
</html>`);
}

function renderConsentPage(
  res: ServerResponse,
  user: RecordData,
  clientId: string,
  scope: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  codeChallengeMethod: string
) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <title>Autorizare Starli Digital</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0c10; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #16181f; border: 1px solid #232733; border-radius: 12px; padding: 32px; width: 100%; max-width: 440px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p { color: #8c93a8; font-size: 14px; margin-top: 0; margin-bottom: 20px; line-height: 1.5; }
    .scope-box { background: #0f1015; border: 1px solid #232733; border-radius: 8px; padding: 14px; font-size: 13px; margin-bottom: 24px; color: #c0c6d8; }
    .scope-box ul { margin: 8px 0 0 18px; padding: 0; }
    .scope-box li { margin-bottom: 4px; }
    button { width: 100%; background: #6366f1; color: #fff; font-weight: 600; border: none; border-radius: 8px; padding: 12px; font-size: 14px; cursor: pointer; }
    button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirmă accesul ChatGPT</h1>
    <p>Ești autentificat ca <strong>${user.username}</strong> (${user.email || 'Admin'}). Confirmi acordarea accesului către ChatGPT?</p>
    <div class="scope-box">
      Permisiuni solicitate:
      <ul>
        <li>Verificare stare platformă (<code>ops_health</code>)</li>
        <li>Acces CRM: prospecți, oportunități, note</li>
        <li>Creare drafturi de email (Alex Mailbox)</li>
      </ul>
    </div>
    <form method="POST" action="/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scope)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=${encodeURIComponent(codeChallengeMethod)}">
      <input type="hidden" name="username" value="${user.username}">
      <input type="hidden" name="confirmed" value="true">
      <button type="submit">Aprobă și Conectează la ChatGPT</button>
    </form>
  </div>
</body>
</html>`);
}
