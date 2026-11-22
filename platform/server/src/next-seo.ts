import ts from 'typescript';
import {validateNextProjectFiles,type SourceFile} from './next-template.js';

/** Apply only after the actual public origin is known; never infer it from a lead's old website. */
export function withNextSiteSeo(input:SourceFile[],siteUrl:string):SourceFile[]{
 const url=new URL(siteUrl);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!url.hostname.includes('.')||url.hostname==='localhost')throw new Error('Configurează originea HTTPS reală a website-ului, fără cale sau parametri.');
 const origin=url.origin;
 const files=input.filter(f=>!['public/robots.txt','public/sitemap.xml'].includes(f.path)).map(f=>({...f}));
 const pages=files.filter(f=>/^app\/(?:[a-z-]+\/)?page\.tsx$/.test(f.path));
 for(const file of [...pages,...files.filter(f=>f.path==='app/layout.tsx')]){
  const source=ts.createSourceFile(file.path,file.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let initializer:ts.Expression|undefined;
  for(const statement of source.statements)if(ts.isVariableStatement(statement)&&statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.name.text==='metadata')initializer=declaration.initializer;
  if(!initializer)continue;
  const path=file.path==='app/page.tsx'?'/':file.path.replace(/^app/,'').replace(/page\.tsx$/,'');
  const canonical=file.path==='app/layout.tsx'?'':`,alternates:{canonical:${JSON.stringify(origin+path)}}`;
  const replacement=`{...(${initializer.getText(source)}),metadataBase:new URL(${JSON.stringify(origin)})${canonical}}`;
  file.content=file.content.slice(0,initializer.getStart(source))+replacement+file.content.slice(initializer.end);
 }
 const paths=pages.map(f=>f.path==='app/page.tsx'?'/':f.path.replace(/^app/,'').replace(/page\.tsx$/,''));
 const xml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 files.push({path:'public/robots.txt',content:`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`});
 files.push({path:'public/sitemap.xml',content:`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path=>`<url><loc>${xml(origin+path)}</loc></url>`).join('')}</urlset>\n`});
 validateNextProjectFiles(files);return files;
}
