import test from 'node:test';
import assert from 'node:assert/strict';
import {makeNextProjectFiles,validateNextProjectFiles} from '../src/next-template.js';
import {withNextSiteSeo} from '../src/next-seo.js';
const fixture=()=>makeNextProjectFiles({page:'export const metadata={title:"Atelier ceramică",description:"Piese ceramice din Brașov"}; export default function Page(){return <main><h1>Atelier de ceramică</h1><p>Descoperă atelierul nostru din Brașov.</p></main>}',css:'body{margin:0}',title:'Atelier',description:'Atelier de ceramică',extraFiles:[{path:'app/contact/page.tsx',content:'export const metadata={title:"Contact atelier"};export default function Page(){return <main><h1>Contact</h1><p>Discută despre piesa ta.</p></main>}'}]});
test('SEO uses an explicitly configured origin, distinct canonical routes and real sitemap entries',()=>{
 const original=fixture(),files=withNextSiteSeo(original,'https://atelier.example');validateNextProjectFiles(files);
 assert.ok(files.find(f=>f.path==='app/page.tsx')!.content.includes('canonical:"https://atelier.example/"'));
 assert.ok(files.find(f=>f.path==='app/contact/page.tsx')!.content.includes('canonical:"https://atelier.example/contact/"'));
 assert.ok(!files.find(f=>f.path==='app/layout.tsx')!.content.includes('canonical:'));
 const sitemap=files.find(f=>f.path==='public/sitemap.xml')!.content;
 assert.ok(sitemap.includes('https://atelier.example/contact/'));
 assert.ok(!sitemap.includes('/servicii/'));
 assert.ok(files.find(f=>f.path==='public/robots.txt')!.content.includes('Sitemap: https://atelier.example/sitemap.xml'));
 assert.ok(!original.some(f=>f.path==='public/sitemap.xml'));
 assert.equal(withNextSiteSeo(files,'https://atelier.example').length,files.length);
});
test('SEO never invents a domain or accepts credentials, query strings or path-based origins',()=>{
 for(const url of ['http://atelier.example','https://user:pass@atelier.example','https://atelier.example/contact','https://atelier.example/?token=secret','https://localhost'])assert.throws(()=>withNextSiteSeo(fixture(),url));
});
