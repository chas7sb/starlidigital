import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename, realpath, stat, mkdir } from 'node:fs/promises';
import { resolve, dirname, extname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(resolve(root, 'state/config.json'), 'utf8'));
const base = '/openpencil/';
const port = Number(process.env.OPENPENCIL_WEB_PORT || 17601);
const mcpPort = Number(process.env.OPENPENCIL_MCP_PORT || 17600);
const site = await realpath(resolve(root, 'site'));
const documents = await realpath(resolve(root, 'documents'));
const limit = 64 * 1024 * 1024;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const failures = new Map();

function equal(a, b) {
  const first = Buffer.from(a || '');
  const second = Buffer.from(b || '');
  return first.length === second.length && timingSafeEqual(first, second);
}
function session() {
  const expires = String(Date.now() + 12 * 60 * 60 * 1000);
  return `${expires}.${createHmac('sha256', config.sessionKey).update(expires).digest('hex')}`;
}
function validSession(cookie) {
  const value = (cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('openpencil_session='))?.slice(19);
  if (!value) return false;
  const [expires, signature] = value.split('.');
  if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
  return equal(signature, createHmac('sha256', config.sessionKey).update(expires).digest('hex'));
}
function authorized(req, res) {
  if (validSession(req.headers.cookie)) return true;
  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ') && equal(authorization.slice(7), config.mcpToken)) return true;
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
  const recent = failures.get(ip);
  if (recent && recent.count >= 15 && Date.now() - recent.time < 60000) return false;
  if (authorization.startsWith('Basic ')) {
    const credentials = Buffer.from(authorization.slice(6), 'base64').toString();
    if (equal(credentials, `${config.username}:${config.password}`)) {
      failures.delete(ip);
      if (res) {
        const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
        res.setHeader('Set-Cookie', `openpencil_session=${session()}; Path=${base}; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`);
      }
      return true;
    }
    failures.set(ip, { count: (recent?.count || 0) + 1, time: Date.now() });
  }
  return false;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
}
function reply(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function proxy(req, res, target) {
  const upstream = http.request({ host: '127.0.0.1', port: mcpPort, path: target, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${mcpPort}`, authorization: `Bearer ${config.mcpToken}` } }, response => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
  upstream.on('error', () => { if (!res.headersSent) reply(res, 502, 'OpenPencil MCP is starting'); else res.destroy(); });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}
async function file(res, path, allowedRoot, method) {
  const resolved = await realpath(path);
  const within = relative(allowedRoot, resolved);
  if (isAbsolute(within) || within === '..' || within.startsWith('../') || within.startsWith('..\\')) return reply(res, 403, 'Forbidden');
  const info = await stat(resolved);
  if (!info.isFile()) return reply(res, 404, 'Not found');
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream',
    'Content-Length': info.size, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (method === 'HEAD') return res.end();
  createReadStream(resolved).pipe(res);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/_health') return reply(res, 200, JSON.stringify({ status: 'ok', version: '0.16.0' }), 'application/json');
  if (!url.pathname.startsWith(base)) return reply(res, 404, 'Not found');
  if (!authorized(req, res)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="StarliDigital OpenPencil", charset="UTF-8"');
    return reply(res, 401, 'Sign in to StarliDigital OpenPencil');
  }
  if (!sameOrigin(req)) return reply(res, 403, 'Origin refused');
  try {
    const relative = decodeURIComponent(url.pathname.slice(base.length));
    if (relative.startsWith('_automation/')) {
      const route = '/' + relative.slice('_automation/'.length);
      if (!['/health', '/mcp', '/rpc'].includes(route)) return reply(res, 404, 'Not found');
      return proxy(req, res, route + url.search);
    }
    if (relative.startsWith('documents/')) {
      const name = relative.slice('documents/'.length);
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,160}\.fig$/i.test(name) || name.includes('..')) return reply(res, 400, 'Use a .fig filename without folders');
      const target = resolve(documents, name);
      if (req.method === 'PUT') {
        let count = 0;
        const chunks = [];
        for await (const chunk of req) {
          count += chunk.length;
          if (count > limit) return reply(res, 413, 'File exceeds 64 MiB');
          chunks.push(chunk);
        }
        if (!count) return reply(res, 400, 'Empty document');
        const temporary = resolve(documents, `.${randomBytes(12).toString('hex')}.tmp`);
        await writeFile(temporary, Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
        return reply(res, 200, '{"saved":true}', 'application/json');
      }
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, 'Method not allowed');
      return await file(res, target, documents, req.method);
    }
    if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, 'Method not allowed');
    if (relative.includes('..') || relative.includes('\0')) return reply(res, 400, 'Invalid path');
    const target = relative === '' || relative.startsWith('share/') ? resolve(site, 'index.html') : resolve(site, relative);
    return await file(res, target, site, req.method);
  } catch (error) {
    if (!res.headersSent) reply(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : 'Request failed');
    else res.destroy();
  }
});
const sockets = new WebSocketServer({ noServer: true, maxPayload: limit });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== `${base}_automation` || !authorized(req) || !sameOrigin(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  sockets.handleUpgrade(req, socket, head, downstream => {
    const upstream = new WebSocket(`ws://127.0.0.1:${mcpPort}`, { maxPayload: limit });
    const queue = [];
    upstream.on('open', () => { for (const data of queue) upstream.send(data); queue.length = 0; });
    downstream.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { downstream.close(1008, 'Invalid message'); return; }
      if (message.type === 'register') message.token = config.mcpToken;
      else if (message.type !== 'response') { downstream.close(1008, 'Only editor responses are accepted'); return; }
      const encoded = JSON.stringify(message);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(encoded);
      else if (queue.length < 10) queue.push(encoded);
    });
    upstream.on('message', data => { if (downstream.readyState === WebSocket.OPEN) downstream.send(data.toString()); });
    upstream.on('error', () => downstream.close(1011, 'MCP unavailable'));
    downstream.on('error', () => upstream.close());
    upstream.on('close', () => downstream.close());
    downstream.on('close', () => upstream.close());
  });
});
server.listen(port, '127.0.0.1', () => console.log(`OpenPencil web gateway listening on 127.0.0.1:${port}`));
process.on('SIGTERM', () => { for (const client of sockets.clients) client.close(); server.close(() => process.exit(0)); });
