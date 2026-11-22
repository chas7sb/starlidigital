/** Safe project compilation: project code is parsed/bundled, never imported or executed on this host. */
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const trustedRoot='/srv/starlidigital/current';
const require=createRequire(trustedRoot+'/package.json');
const esbuild=require('esbuild');
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const first=await lines.next();if(first.done)throw Error('SOURCE_SNAPSHOT_REQUIRED');
const request=JSON.parse(first.value);
const files=new Map<string,any>();
const diagnostics:any[]=[];
function diagnostic(message:string,file?:string,line?:number,column?:number,severity='error',code?:string){
 const fixed=code||(/Server|server|Next server/.test(message)?'SERVER_RUNTIME_UNSUPPORTED':/dependency|module/.test(message)?'MODULE_UNSUPPORTED':/not found|missing/.test(message)?'SOURCE_IMPORT_ERROR':'SOURCE_SYNTAX_ERROR');
 const codes=new Set(['ENTRY_NOT_FOUND','SERVER_RUNTIME_UNSUPPORTED','MODULE_UNSUPPORTED','SOURCE_IMPORT_ERROR','SOURCE_SYNTAX_ERROR','BROWSER_ROUTE_UNSUPPORTED','ROUTE_LIMIT','DUPLICATE_ROUTE','COMPILATION_FAILED']);
 const safeCode=codes.has(fixed)?fixed:'COMPILATION_FAILED';
 let safeMessage=({ENTRY_NOT_FOUND:'No supported browser entry found. Add index.html, app/page.js|jsx|ts|tsx, pages/index.js|jsx|ts|tsx, or src/main.tsx.',SERVER_RUNTIME_UNSUPPORTED:'This source requires a server or Next.js runtime; browser compilation does not execute it.',MODULE_UNSUPPORTED:'This import is not in the trusted browser dependency allowlist.',SOURCE_IMPORT_ERROR:'A required import is absent from the source snapshot.',SOURCE_SYNTAX_ERROR:'Browser source syntax is invalid.',BROWSER_ROUTE_UNSUPPORTED:'Dynamic page routes require explicit parameters and are unavailable in browser preview.',ROUTE_LIMIT:'Browser preview supports at most 30 static pages.',DUPLICATE_ROUTE:'Multiple source files define the same browser route.',COMPILATION_FAILED:'Browser compilation failed.'}as Record<string,string>)[safeCode];
 if(safeCode==='SOURCE_SYNTAX_ERROR'){
  const expected=/^Expected "([^"]{1,20})"/.exec(message)?.[1];
  if(expected&&[';',')','}',']','(', '{','[',':',',','=','identifier','end of file'].includes(expected))safeMessage='Expected '+JSON.stringify(expected)+' in browser source.';
  else if(/^Unexpected/.test(message))safeMessage='Unexpected token in browser source.';
  else if(/^Unterminated/.test(message))safeMessage='Unterminated source token.';
 }
 if(safeCode==='MODULE_UNSUPPORTED'||safeCode==='SERVER_RUNTIME_UNSUPPORTED'){
  const name=/(?:module|dependency is unavailable:)\s+([A-Za-z0-9_@./-]{1,100})/.exec(message)?.[1];
  if(name&&!name.startsWith('/')&&!name.includes('..'))safeMessage+=' Import: '+name+'.';
 }
 const relative=file?.replace(/^project:/,'');
 const safeFile=relative&&relative.length<=180&&!relative.startsWith('/')&&!relative.includes('\\')&&!relative.split('/').includes('..')&&/^[A-Za-z0-9_@.()\[\] /-]+$/.test(relative)?relative:undefined;
 return {code:safeCode,message:safeMessage.slice(0,240),file:safeFile,line:typeof line==='number'&&Number.isInteger(line)&&line>0&&line<100000?line:undefined,column:typeof column==='number'&&Number.isInteger(column)&&column>=0&&column<100000?column:undefined,severity:severity==='warning'?'warning':'error'};
}
function boundedDiagnostics(rows:any[]){const out:any[]=[];let size=2;for(const row of rows){const bytes=Buffer.byteLength(JSON.stringify(row))+1;if(out.length>=10||size+bytes>4096)break;out.push(row);size+=bytes;}return out;}
function failure(code:string,message:string,file?:string){const error:any=new Error(message);error.code=code;error.file=file;throw error;}
const scriptExtensions=['tsx','jsx','ts','js'];
function sourceEntry(prefix:string,base:string){return scriptExtensions.map(ext=>prefix+'/'+base+'.'+ext).find(p=>files.has(p))||null;}
function sourceLocation(contents:string,index:number){const prefix=contents.slice(0,index);const rows=prefix.split('\n');return {line:rows.length,column:rows[rows.length-1].length};}
function browserOnlyError(file:any){
 const serverExport=/export\s+(?:(?:async\s+)?function\s+|(?:const|let|var)\s+)(?:getServerSideProps|getStaticProps|getStaticPaths)\b|export\s*\{[^}]*\b(?:getServerSideProps|getStaticProps|getStaticPaths)\b|\.getInitialProps\s*=|export\s+default\s+async\b/;
 const found=serverExport.exec(file.content);
 return found?{text:'Server data functions and async server pages require an isolated Next.js runtime.',location:{file:file.path,...sourceLocation(file.content,found.index)},detail:{code:'SERVER_RUNTIME_UNSUPPORTED'}}:null;
}
function normalized(value:string){const p=path.posix.normalize(value);if(!value||value.startsWith('/')||value.includes('\\')||p==='..'||p.startsWith('../')||p!==value||value.split('/').some(p=>p==='.git'||p==='node_modules'||p==='.env'||p.startsWith('.env.')))throw Error('INVALID_PROJECT_PATH');return value;}
for(const file of request.files||[]){
 const name=normalized(String(file.path||''));
 if(files.has(name))throw Error('DUPLICATE_PROJECT_PATH');
 if(typeof file.content!=='string'||file.content.length>350000)throw Error('PROJECT_FILE_TOO_LARGE');
 files.set(name,file);
}
if(files.size>200||[...files.values()].reduce((n,f)=>n+f.content.length,0)>2500000)throw Error('PROJECT_SOURCE_LIMIT');
const extensions=['','.tsx','.ts','.jsx','.js','.mjs','.json','.css','/index.tsx','/index.ts','/index.jsx','/index.js'];
function resolveFile(candidate:string){for(const ext of extensions)if(files.has(candidate+ext))return candidate+ext;return null;}
const allowedPackages=['react','react-dom','lucide-react','clsx','tailwind-merge'];
const projectImports:string[]=[];
const fontNames=new Set<string>(['Inter','Roboto','Poppins','Montserrat','Geist','Geist_Mono']);
for(const f of files.values())for(const match of f.content.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]next\/font\/google['"]/g))for(const part of match[1].split(',')){const name=part.trim().split(/\s+/)[0];if(/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name))fontNames.add(name);}
const linkShim=`import React from 'react';export default function Link({href,children,onClick,...props}){const target=typeof href==='string'?href:href?.pathname||'/';return React.createElement('a',{...props,href:target,onClick:e=>{onClick?.(e);if(!e.defaultPrevented&&target.startsWith('/')&&!target.startsWith('//')){e.preventDefault();window.dispatchEvent(new CustomEvent('starli:navigate',{detail:target}));}}},children)};`;
const imageShim=`import React from 'react';export default function Image({src,alt,fill,priority,quality,loader,unoptimized,placeholder,blurDataURL,...props}){return React.createElement('img',{...props,src:typeof src==='string'?src:src?.src,alt:alt||'',style:fill?{position:'absolute',inset:0,width:'100%',height:'100%',...props.style}:props.style});}`;
const navigationShim=`import {useSyncExternalStore} from 'react';const subscribe=f=>{window.addEventListener('starli:navigate',f);return()=>window.removeEventListener('starli:navigate',f)};export const usePathname=()=>useSyncExternalStore(subscribe,()=>window.__STARLI_PATH__||'/');export const useSearchParams=()=>new URLSearchParams();export const useParams=()=>({});export const useRouter=()=>({push:p=>window.dispatchEvent(new CustomEvent('starli:navigate',{detail:p})),replace:p=>window.dispatchEvent(new CustomEvent('starli:navigate',{detail:p})),back:()=>window.dispatchEvent(new CustomEvent('starli:navigate',{detail:'/'})),forward:()=>{},refresh:()=>window.dispatchEvent(new CustomEvent('starli:navigate',{detail:window.__STARLI_PATH__||'/'})),prefetch:()=>{}});export const redirect=p=>{throw Error('Server redirects need an isolated Next.js runtime')};export const notFound=()=>{throw Error('Page not found')};`;
const shims:Record<string,string>={
 'next/link':linkShim,'next/image':imageShim,'next/navigation':navigationShim,
 'next/font/google':[...fontNames].map(n=>`export const ${n}=()=>({className:'',variable:'',style:{fontFamily:'system-ui,sans-serif'}});`).join('\n')
};
shims['next/router']=navigationShim+';export default useRouter;';
shims['next/head']="import React from 'react';export default function Head({children}){React.useEffect(()=>{for(const child of React.Children.toArray(children)){if(child?.type==='title')document.title=String(child.props.children||'')}},[children]);return null;}";
const assets=new Map<string,string>();
function assetUrl(file:any){const ext=path.posix.extname(file.path).toLowerCase();const types:any={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'};return 'data:'+(types[ext]||'application/octet-stream')+';base64,'+(file.encoding==='base64'?file.content:Buffer.from(file.content).toString('base64'));}
for(const f of files.values())if(f.path.startsWith('public/')&&/\.(png|jpe?g|webp|gif|svg|ico|woff2?)$/i.test(f.path))assets.set('/'+f.path.slice(7),assetUrl(f));
const resolveProject=(args:any)=>{
  if(args.path in shims)return {path:args.path,namespace:'shim'};
  if(args.path==='next')return {path:'next',namespace:'shim'};
  if(args.path.startsWith('node:')||['fs','path','child_process','process','net','tls','http','https','os','worker_threads','vm','module'].includes(args.path))return {errors:[{text:'Server/Node module '+args.path+' requires an isolated backend runtime.'}]};
  if(args.path.startsWith('next/'))return {errors:[{text:'Next server module '+args.path+' requires an isolated Next.js runtime.'}]};
  if(args.path.startsWith('.')||args.path.startsWith('@/')||args.path.startsWith('~/')||args.path.startsWith('/')){
   let candidate=args.path.startsWith('@/')?path.posix.join([...files.keys()].some(p=>p.startsWith('src/'))?'src':'',args.path.slice(2)):args.path.startsWith('~/')?args.path.slice(2):args.path.startsWith('/')?'public'+args.path:path.posix.join(path.posix.dirname(args.importer.startsWith('/')?args.importer.slice(1):args.importer),args.path);
   if(candidate==='..'||candidate.startsWith('../'))return {errors:[{text:'Project import escapes its source snapshot.'}]};
   const resolved=resolveFile(candidate);if(!resolved)return {errors:[{text:'Project file not found: '+candidate}]};
   return {path:resolved,namespace:'project'};
  }
  if(allowedPackages.some(p=>args.path===p||args.path.startsWith(p+'/'))&&!args.path.split('/').includes('..')){
   try{return {path:require.resolve(args.path)};}catch{return {errors:[{text:'Trusted preview dependency is not installed: '+args.path}]};}
  }
  return {errors:[{text:'Preview dependency is unavailable: '+args.path+'. This compiler does not install or execute packages.'}]};
 };
const plugin={name:'starli-project-snapshot',setup(build:any){
 build.onResolve({filter:/.*/,namespace:'project'},resolveProject);
 build.onResolve({filter:/.*/,namespace:'shim'},(args:any)=>args.path==='react'?{path:require.resolve('react')}:{errors:[{text:'Unsupported shim import'}]});
 build.onLoad({filter:/.*/,namespace:'shim'},(args:any)=>({contents:args.path==='next'?'export {};':shims[args.path],loader:'js'}));
 build.onLoad({filter:/.*/,namespace:'project'},(args:any)=>{
  const file=files.get(args.path);if(!file)return {errors:[{text:'Source file missing from snapshot'}]};
  const ext=path.posix.extname(args.path).toLowerCase();
  const unsupported=browserOnlyError(file);if(unsupported)return {errors:[unsupported]};
  if(['.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.woff','.woff2'].includes(ext))return {contents:file.encoding==='base64'?Buffer.from(file.content,'base64'):Buffer.from(file.content),loader:'dataurl'};
  if(/^[\s;]*['"]use server['"]/.test(file.content))return {errors:[{text:'Server actions require an isolated backend runtime.'}]};
  if(ext==='.css'&&/@(?:plugin|config|source)\b/.test(file.content))return {errors:[{text:'Custom Tailwind plugins, configuration execution, and host source scanning are disabled in preview.'}]};
  const loader:any={'.tsx':'tsx','.ts':'ts','.jsx':'jsx','.js':'jsx','.mjs':'js','.cjs':'js','.json':'json','.css':'css'};
  if(!loader[ext])return {errors:[{text:'Unsupported browser source type: '+ext}]};
  let contents=file.content;
  if(ext==='.css')contents=contents.replace(/@import\s+['"]tailwindcss(?:\/[^'"]+)?['"];?/g,'').replace(/@tailwind\s+(base|components|utilities);?/g,'');
  for(const [asset,data]of assets)contents=contents.split(asset).join(data);
  return {contents,loader:loader[ext],resolveDir:'/'};
 });
}};
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
async function bundle(entry:string){return esbuild.build({stdin:{contents:entry,sourcefile:'starli-entry.tsx',loader:'tsx',resolveDir:'/'},bundle:true,write:false,platform:'browser',format:'iife',target:['es2020'],jsx:'automatic',outfile:'/virtual/preview.js',minify:false,sourcemap:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'entry-resolver',setup(build:any){build.onResolve({filter:/.*/},(args:any)=>{if(args.path.startsWith('starli-entry:'))return {path:args.path.slice(13),namespace:'project'};if(!args.importer||args.importer.endsWith('/starli-entry.tsx')||args.importer==='starli-entry.tsx')return resolveProject(args);});}},plugin]});}
function csp(){return "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";}
function safeHtml(html:string){return html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,'').replace(/<head\b[^>]*>/i,m=>m+'<meta http-equiv="Content-Security-Policy" content="'+csp()+'"><meta name="robots" content="noindex,nofollow">');}
async function cssCompile(css:string){
 if(!/@theme|@apply|@import|@tailwind/.test(css)&&![...files.values()].some(f=>/className\s*=/.test(f.content)))return css;
 const tailwindRequire=createRequire('/srv/starlidigital/webui-current/package.json');
 const {compile}=tailwindRequire('tailwindcss');
 const theme=await readFile('/srv/starlidigital/webui-current/node_modules/tailwindcss/theme.css','utf8');
 const preflight=await readFile('/srv/starlidigital/webui-current/node_modules/tailwindcss/preflight.css','utf8');
 const source=theme+'\n'+preflight+'\n@tailwind utilities;\n'+css.replace(/@import\s+["']tailwindcss[^"']*["'];?/g,'').replace(/@tailwind\s+[^;]+;/g,'');
 const compiler=await compile(source,{loadModule:async()=>{throw Error('Preview plugins are disabled')},loadStylesheet:async()=>{throw Error('External CSS imports require a bundled local file')}});
 const candidates=new Set<string>();
 for(const file of files.values())if(/\.(tsx?|jsx?|html|css)$/.test(file.path))for(const match of file.content.matchAll(/[^\s<>"'`{};]+/g)){if(match[0].length<180)candidates.add(match[0]);if(candidates.size>30000)throw Error('TAILWIND_CANDIDATE_LIMIT');}
 return compiler.build([...candidates]);
}
let html='',framework='',routes:string[]=[],limitations=['Browser compilation does not execute or verify server routes, databases, package scripts, or application tests.','Preview runs customer JavaScript only inside the sandboxed browser iframe, with network API calls disabled.'];
try{
 const appPrefix=sourceEntry('app','page')?'app':sourceEntry('src/app','page')?'src/app':null;
 const pagesPrefix=sourceEntry('pages','index')?'pages':sourceEntry('src/pages','index')?'src/pages':null;
 const htmlFile=files.get('index.html')||files.get('public/index.html');
 if(appPrefix){
  framework='NEXT_BROWSER_PREVIEW';limitations.push('Next image optimization, font fetching, server rendering and server actions require a live isolated Next.js runtime.');
  const pages=[...files.keys()].filter(p=>p.startsWith(appPrefix+'/')&&/\/page\.(tsx|jsx|js|ts)$/.test(p)&&!p.includes('[')&&!p.includes('('));
  if(pages.length>30)failure('ROUTE_LIMIT','Browser preview supports at most 30 static pages.');
  routes=pages.map(p=>p.slice(appPrefix.length).replace(/\/page\.[^/]+$/,'')||'/');
  const imports:string[]=["import React from 'react';","import {createRoot} from 'react-dom/client';"];
  const wrappers:string[]=[];
  pages.forEach((p,i)=>{
   imports.push(`import Page${i} from 'starli-entry:${p}';`);
   let element=`React.createElement(Page${i})`;
   const dir=path.posix.dirname(p);const segments=dir.split('/');
   for(let depth=segments.length;depth>=appPrefix.split('/').length;depth--){
    const parent=segments.slice(0,depth).join('/');
    const layout=resolveFile(parent+'/layout');
    if(layout){const alias='Layout'+i+'_'+depth;imports.push(`import ${alias} from 'starli-entry:${layout}';`);element=`React.createElement(${alias},{},${element})`;}
   }
   wrappers.push(JSON.stringify(routes[i])+':()=>'+element);
  });
  const globals=[...files.keys()].filter(p=>p===appPrefix+'/globals.css'||p===appPrefix+'/global.css');
  globals.forEach(p=>imports.push(`import 'starli-entry:${p}';`));
  const initial=routes.includes(request.route)?request.route:'/';
  imports.push(`const pages={${wrappers.join(',')}};window.__STARLI_PATH__=${JSON.stringify(initial)};function Preview(){const [route,setRoute]=React.useState(window.__STARLI_PATH__);React.useEffect(()=>{const navigate=e=>{const next=String(e.detail||'/').split('?')[0].split('#')[0];window.__STARLI_PATH__=next;setRoute(next)};window.addEventListener('starli:navigate',navigate);return()=>window.removeEventListener('starli:navigate',navigate)},[]);return pages[route]?pages[route]():React.createElement('p',{},'This page is not in the browser preview: '+route)};createRoot(${resolveFile(appPrefix+'/layout')?'document':"document.getElementById('root')"}).render(React.createElement(Preview));`);
  // Entry imports are fixed virtual source names; user code is not imported by Node.
  const result=await bundle(imports.join('\n'));
  const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text||'';
  const css=await cssCompile(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
  html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(request.name||'Project preview')+'</title><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head><body><div id="root"></div><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
  diagnostics.push(...result.warnings.map((w:any)=>diagnostic(w.text,w.location?.file,w.location?.line,w.location?.column,'warning')));
 }else if(pagesPrefix){
  framework='NEXT_PAGES_BROWSER_PREVIEW';
  limitations.push('Next Pages browser preview uses empty pageProps; server data functions, SSR, API routes and custom _document are unavailable.');
  const documentEntry=sourceEntry(pagesPrefix,'_document');
  if(documentEntry)failure('SERVER_RUNTIME_UNSUPPORTED','Custom Next _document requires an isolated server runtime.',documentEntry);
  const pageFiles=[...files.keys()].filter(p=>p.startsWith(pagesPrefix+'/')&&/\.(tsx|jsx|ts|js)$/.test(p)&&!p.startsWith(pagesPrefix+'/api/')&&!path.posix.basename(p).startsWith('_'));
  if(pageFiles.some(p=>p.includes('[')))failure('BROWSER_ROUTE_UNSUPPORTED','Dynamic Next page routes need explicit parameters and are not supported in browser preview.',pageFiles.find(p=>p.includes('[')));
  if(pageFiles.length>30)failure('ROUTE_LIMIT','Browser preview supports at most 30 static pages.');
  const pageMap=new Map<string,string>();
  for(const p of pageFiles){
   const route='/'+p.slice(pagesPrefix.length+1).replace(/\.(tsx|jsx|ts|js)$/,'').replace(/(?:^|\/)index$/,'');
   const normalizedRoute=route.replace(/\/$/,'')||'/';
   if(pageMap.has(normalizedRoute))failure('DUPLICATE_ROUTE','Multiple source files define the same browser route.',p);
   pageMap.set(normalizedRoute,p);
  }
  routes=[...pageMap.keys()].sort();
  const imports=["import React from 'react';","import {createRoot} from 'react-dom/client';"];
  const wrapper=sourceEntry(pagesPrefix,'_app');
  if(wrapper)imports.push("import AppWrapper from 'starli-entry:"+wrapper+"';");
  const entries:string[]=[];
  [...pageMap.entries()].forEach(([route,p],i)=>{
   imports.push("import Page"+i+" from 'starli-entry:"+p+"';");
   entries.push(JSON.stringify(route)+':Page'+i);
  });
  const initial=routes.includes(request.route)?request.route:'/';
  imports.push('const pages={'+entries.join(',')+'};window.__STARLI_PATH__='+JSON.stringify(initial)+';'+
   "function Preview(){const [route,setRoute]=React.useState(window.__STARLI_PATH__);React.useEffect(()=>{const navigate=e=>{const next=String(e.detail||'/').split('?')[0].split('#')[0];window.__STARLI_PATH__=next;setRoute(next)};window.addEventListener('starli:navigate',navigate);return()=>window.removeEventListener('starli:navigate',navigate)},[]);const Component=pages[route];if(!Component)return React.createElement('p',{},'This page is not in the browser preview: '+route);return "+
   (wrapper?"React.createElement(AppWrapper,{Component,pageProps:{}})":"React.createElement(Component,{})")+
   ";}createRoot(document.getElementById('root')).render(React.createElement(Preview));");
  const result=await bundle(imports.join('\n'));
  const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text||'';
  const css=await cssCompile(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
  html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(request.name||'Project preview')+'</title><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head><body><div id="root"></div><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
  diagnostics.push(...result.warnings.map((w:any)=>diagnostic(w.text,w.location?.file,w.location?.line,w.location?.column,'warning')));
 }else if(htmlFile){
  framework='HTML_BROWSER_PREVIEW';html=htmlFile.content;
  const scripts:string[]=[];
  html=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(full,attrs,body)=>{
   const src=/\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
   if(src){const target=resolveFile(path.posix.join(path.posix.dirname(htmlFile.path),src.replace(/^\//,'')))||resolveFile(src.replace(/^\//,''));if(!target)throw Error('Script file is not in the project snapshot: '+src);scripts.push(`import 'starli-entry:${target}';`);}
   else if(body.trim())scripts.push(body);
   return '';
  });
  html=html.replace(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi,(full,href)=>{
   if(!/rel\s*=\s*["']stylesheet["']/i.test(full))return full;
   const target=resolveFile(path.posix.join(path.posix.dirname(htmlFile.path),href.replace(/^\//,'')))||resolveFile(href.replace(/^\//,''));
   if(!target)throw Error('Stylesheet is not in the project snapshot: '+href);
   scripts.push(`import 'starli-entry:${target}';`);return '';
  });
  if(scripts.length){
   const result=await bundle(scripts.join('\n'));const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text||'';const css=await cssCompile(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
   html=html.replace(/<\/head\s*>/i,'<style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head>').replace(/<\/body\s*>/i,'<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body>');
   diagnostics.push(...result.warnings.map((w:any)=>diagnostic(w.text,w.location?.file,w.location?.line,w.location?.column,'warning')));
  }
 }else{
  const entry=['src/main.tsx','src/main.jsx','src/index.tsx','src/index.jsx','src/App.tsx','src/App.jsx','App.tsx','App.jsx'].find(p=>files.has(p));
  if(!entry)failure('ENTRY_NOT_FOUND','No supported browser entry found. Add index.html, app/page.js|jsx|ts|tsx, pages/index.js|jsx|ts|tsx, or src/main.tsx.');
  framework='REACT_BROWSER_PREVIEW';
  let source=`import 'starli-entry:${entry}';`;
  if(/(?:^|\/)App\.[jt]sx$/.test(entry))source=`import React from 'react';import {createRoot} from 'react-dom/client';import App from 'starli-entry:${entry}';createRoot(document.getElementById('root')).render(React.createElement(App));`;
  const result=await bundle(source);const js=result.outputFiles.find(f=>f.path.endsWith('.js'))?.text||'';const css=await cssCompile(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'');
  html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head><body><div id="root"></div><script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
  diagnostics.push(...result.warnings.map((w:any)=>diagnostic(w.text,w.location?.file,w.location?.line,w.location?.column,'warning')));
 }
 for(const [asset,data]of assets)html=html.split(asset).join(data);
 if(!/<head\b/i.test(html))throw Error('Preview requires a complete HTML document with a head element.');
 if(html.length>5000000)throw Error('COMPILED_PREVIEW_LIMIT');
 html=safeHtml(html);
 const runtimeError=`<script>window.addEventListener('error',function(e){var p=document.createElement('pre');p.style.cssText='position:fixed;bottom:0;left:0;right:0;max-height:35vh;overflow:auto;padding:16px;background:#18181b;color:#fca5a5;z-index:2147483647;font:12px monospace;white-space:pre-wrap';p.textContent='Browser preview error: '+String(e.message||'Unknown error');document.body.appendChild(p)});</script>`;
 html=html.replace(/<script\b/i,runtimeError+'<script');
 process.stdout.write(JSON.stringify({ok:true,framework,routes,html,diagnostics:boundedDiagnostics(diagnostics),diagnosticCount:diagnostics.length,checks:[{name:'Browser syntax and imports',status:'PASSED'},{name:'Package scripts and application tests',status:'NOT_RUN'},{name:'Server runtime and APIs',status:'UNAVAILABLE'}],limitations})+'\n');
}catch(error:any){
 const errors=Array.isArray(error.errors)?error.errors.map((e:any)=>diagnostic(e.text,e.location?.file?.replace(/^project:/,''),e.location?.line,e.location?.column,'error',e.detail?.code)):[diagnostic(String(error.message||'Project compilation failed'),error.file,undefined,undefined,'error',error.code)];
 process.stdout.write(JSON.stringify({ok:false,framework:framework||'UNKNOWN',diagnostics:boundedDiagnostics([...diagnostics,...errors]),diagnosticCount:diagnostics.length+errors.length,checks:[{name:'Browser syntax and imports',status:'FAILED'}],limitations})+'\n');
}
await new Promise<void>(resolve=>process.stdout.write('',()=>resolve()));
process.exit();
