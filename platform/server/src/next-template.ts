import ts from 'typescript';
export type SourceFile={path:string;content:string;encoding?:'base64'};
export const NEXT_DEPENDENCIES={next:'16.4.3',react:'19.3.1','react-dom':'19.3.1'};
export const NEXT_DEV_DEPENDENCIES={'@types/node':'24.10.0','@types/react':'19.1.6','@types/react-dom':'19.1.6',typescript:'5.9.3'};
const scripts={dev:'next dev',build:'next build',start:'next start'};
const legacyConfig="import type { NextConfig } from 'next';\nconst config: NextConfig = {output:'export',trailingSlash:true,assetPrefix:'./',images:{unoptimized:true}};\nexport default config;\n";
const config="import type { NextConfig } from 'next';\nconst config: NextConfig = {output:'export',trailingSlash:true,images:{unoptimized:true}};\nexport default config;\n";

export const CORE_NEXT_PATHS = ['app/page.tsx','app/globals.css','app/layout.tsx','package.json','tsconfig.json','next-env.d.ts','next.config.ts'] as const;
export const OPTIONAL_NEXT_PATHS = ['app/despre/page.tsx','app/servicii/page.tsx','app/contact/page.tsx','components/Navbar.tsx','components/Footer.tsx'] as const;
export const IMAGE_NEXT_PATHS = ['public/assets/hero.png','public/assets/logo.png'] as const;
export const SEO_NEXT_PATHS = ['public/robots.txt','public/sitemap.xml'] as const;

function ensureClientDirective(code:string):string{
 if((/\bon[A-Z][A-Za-z]+\s*=/.test(code)||/\buse(?:State|Effect|Reducer|Ref|LayoutEffect)\s*\(/.test(code))&&!/^\s*['"]use client['"]\s*;?/.test(code))return "'use client';\n"+code;
 return code;
}

export function makeNextProjectFiles({page,css,title,description,extraFiles=[]}:{page:string;css:string;title:string;description:string;extraFiles?:{path:string;content:string}[]}):SourceFile[]{
 // Event handlers and hooks require a client boundary in the Next App Router.
 // Preserve static prerendering while making the generated component valid React.
 page=ensureClientDirective(page);
 const files:SourceFile[]=[
  {path:'app/page.tsx',content:page},
  {path:'app/globals.css',content:css},
  {path:'app/layout.tsx',content:`import type { Metadata } from 'next';\nimport type { ReactNode } from 'react';\nimport './globals.css';\nexport const metadata:Metadata={title:${JSON.stringify(title.slice(0,180))},description:${JSON.stringify(description.slice(0,320))}};\nexport default function RootLayout({children}:{children:ReactNode}){return <html lang="ro"><body>{children}</body></html>;}\n`},
  {path:'package.json',content:JSON.stringify({name:'starli-website',version:'1.0.0',private:true,scripts,dependencies:NEXT_DEPENDENCIES,devDependencies:NEXT_DEV_DEPENDENCIES},null,2)+'\n'},
  {path:'tsconfig.json',content:JSON.stringify({compilerOptions:{target:'ES2017',lib:['dom','dom.iterable','esnext'],allowJs:false,skipLibCheck:true,strict:true,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',resolveJsonModule:true,isolatedModules:true,jsx:'react-jsx',incremental:true,plugins:[{name:'next'}]},include:['next-env.d.ts','**/*.ts','**/*.tsx','.next/types/**/*.ts'],exclude:['node_modules']},null,2)+'\n'},
  {path:'next-env.d.ts',content:'/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n'},
  {path:'next.config.ts',content:config}
 ];
 for(const extra of extraFiles){
  if((OPTIONAL_NEXT_PATHS as readonly string[]).includes(extra.path)&&typeof extra.content==='string'&&extra.content.trim().length>=40){
   files.push({path:extra.path,content:ensureClientDirective(extra.content)});
  }
 }
 validateNextProjectFiles(files);return files;
}

export function isAllowedImportSpecifier(specifier:string):boolean{
 if(['react','next','next/link','./globals.css'].includes(specifier))return true;
 if(/^(?:\.\.?\/)+(?:components\/(?:Navbar|Footer)(?:\.tsx)?|app\/globals\.css)$/.test(specifier))return true;
 return false;
}

export function validateNextProjectFiles(value:unknown):asserts value is SourceFile[]{
 const maxFiles=CORE_NEXT_PATHS.length+OPTIONAL_NEXT_PATHS.length+IMAGE_NEXT_PATHS.length+SEO_NEXT_PATHS.length;
 if(!Array.isArray(value)||value.length<7||value.length>maxFiles)throw new Error('Proiectul Next.js trebuie să conțină șapte fișiere sursă și cel mult două imagini.');
 const allowedSourcePaths=new Set<string>([...CORE_NEXT_PATHS,...OPTIONAL_NEXT_PATHS,...SEO_NEXT_PATHS]);
 const allowedImagePaths=new Set<string>([...IMAGE_NEXT_PATHS]);
 const seen=new Set<string>();let bytes=0;
 for(const file of value){if(!file||typeof file.path!=='string'||typeof file.content!=='string'||(!allowedSourcePaths.has(file.path)&&!allowedImagePaths.has(file.path))||seen.has(file.path))throw new Error('Cale de fișier Next.js invalidă.');seen.add(file.path);bytes+=Buffer.byteLength(file.content);
  if(allowedImagePaths.has(file.path)){if(file.encoding!=='base64'||!/^[A-Za-z0-9+/]+={0,2}$/.test(file.content))throw new Error('Imagine PNG invalidă.');const image=Buffer.from(file.content,'base64');if(image.length>6*1024*1024||image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Imaginea trebuie să fie PNG și să aibă maximum 6 MB.');}
  else if(file.encoding!==undefined||file.content.length>180000)throw new Error('Codificarea fișierului sursă este invalidă.');
 }
 if(CORE_NEXT_PATHS.some(p=>!seen.has(p))||bytes>18*1024*1024)throw new Error('Proiectul Next.js este incomplet sau prea mare.');
 const get=(path:string)=>value.find(f=>f.path===path)!.content;
 let pkg:any;try{pkg=JSON.parse(get('package.json'));}catch{throw new Error('package.json invalid.');}
 if(JSON.stringify(pkg.dependencies)!==JSON.stringify(NEXT_DEPENDENCIES)||JSON.stringify(pkg.devDependencies)!==JSON.stringify(NEXT_DEV_DEPENDENCIES)||JSON.stringify(pkg.scripts)!==JSON.stringify(scripts)||pkg.private!==true||Object.keys(pkg).some(k=>!['name','version','private','scripts','dependencies','devDependencies'].includes(k)))throw new Error('Dependențele și comenzile Next.js trebuie să respecte template-ul platformei.');
 if(![config,legacyConfig].includes(get('next.config.ts')))throw new Error('Configurația Next.js a fost modificată în afara template-ului.');
 const page=get('app/page.tsx');if(page.length<100||!/(?:export\s+default\s+)/.test(page))throw new Error('Pagina React trebuie să exporte o componentă implicită.');
 const tsxPaths=value.filter(f=>f.path.endsWith('.tsx')).map(f=>f.path);
 for(const path of tsxPaths){
  const code=get(path);
  if(path.endsWith('/page.tsx')&&(code.length<60||!/(?:export\s+default\s+)/.test(code)))throw new Error(`Pagina React ${path} trebuie să exporte o componentă implicită.`);
  const source=ts.createSourceFile(path,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const diagnostics=(source as any).parseDiagnostics as ts.Diagnostic[];if(diagnostics.length)throw new Error(`Sintaxă TypeScript invalidă în ${path}.`);
  const visit=(node:ts.Node)=>{
   if(ts.isImportDeclaration(node)){const name=ts.isStringLiteral(node.moduleSpecifier)?node.moduleSpecifier.text:'';if(!isAllowedImportSpecifier(name))throw new Error('Importul nu este permis în template-ul Next.js.');}
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)throw new Error('Importurile dinamice nu sunt permise în acest template.');
   if(ts.isIdentifier(node)&&['eval','require','process','fetch','XMLHttpRequest','WebSocket','Function'].includes(node.text))throw new Error(`Codul conține o operațiune care nu este permisă în website-ul de prezentare: ${node.text} în ${path}.`);
   if(ts.isJsxAttribute(node)&&node.name.getText(source)==='dangerouslySetInnerHTML')throw new Error('HTML injectat nu este permis în componenta generată.');
   ts.forEachChild(node,visit);
  };visit(source);
 }
 if(/@import\b|javascript\s*:/i.test(get('app/globals.css')))throw new Error('CSS-ul conține resurse sau operațiuni nepermise.');
}
