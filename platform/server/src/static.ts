import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('../../web/dist/',import.meta.url)));
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.webmanifest':'application/manifest+json'};
export function webAvailable() { return process.env.SERVE_WEB!=='false'&&existsSync(resolve(root,'index.html')); }
export function safeStaticPath(pathname:string) {
  let decoded:string;try{decoded=decodeURIComponent(pathname);}catch{return null;}
  if(decoded.includes('\0')||decoded.includes('\\'))return null;
  const candidate=resolve(root,'.'+decoded);return candidate===root||candidate.startsWith(root+sep)?candidate:null;
}
export async function serveWeb(req:IncomingMessage,res:ServerResponse) {
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;let file=safeStaticPath(pathname);
  if(!file){res.writeHead(400);res.end('Invalid path');return;}
  try{if(!(await stat(file)).isFile())file=resolve(root,'index.html');}catch{if(extname(pathname)){res.writeHead(404);res.end('Not found');return;}file=resolve(root,'index.html');}
  try{
    const metadata=await stat(file);res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.setHeader('Content-Length',metadata.size);
    res.setHeader('Cache-Control',extname(file)==='.html'?'no-cache':/-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(file)?'public, max-age=31536000, immutable':'public, max-age=3600');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self'; connect-src 'self' ws: wss:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(file);stream.on('error',()=>{if(!res.headersSent)res.writeHead(500);res.end();});stream.pipe(res);
  }catch{res.writeHead(503);res.end('Web build unavailable');}
}
