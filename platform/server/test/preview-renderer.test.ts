import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderNextPreviewHtml} from '../src/preview-renderer.js';
import {makeNextProjectFiles} from '../src/next-template.js';
const make=(page:string,css='body{color:#123}')=>makeNextProjectFiles({page,css,title:'Atelier',description:'Proiect de verificare pentru preview.'});
test('preview rejects recursive components and multiplicative map expansion within a bounded evaluation',()=>{
 const recursive=make('export default function Page(){return <main><h1>Atelier</h1><Page/><p>Componentă recursivă pentru verificarea limitei.</p></main>}');assert.throws(()=>renderNextPreviewHtml(recursive),/recursiv|complexitate/);
 const nested='a.map(()=>'.repeat(8)+'<b>ok</b>'+')'.repeat(8);const expansion=make(`const a=[0,1,2,3,4,5,6,7,8,9];export default function Page(){return <main><h1>Atelier</h1>{${nested}}</main>}`);assert.throws(()=>renderNextPreviewHtml(expansion),/complexitate|dimensiune/);
});
test('preview asset replacement preserves absolute and relative CSS/JSX references',()=>{
 const files=make('export default function Page(){return <main><h1>Atelier</h1><img src="/assets/hero.png" alt="Hero"/><img src="./assets/hero.png" alt="Hero"/></main>}', 'body{background:url("/assets/hero.png")}main{background:url("./assets/hero.png")}');files.push({path:'public/assets/hero.png',content:Buffer.from('89504e470d0a1a0a','hex').toString('base64'),encoding:'base64'});
 const html=renderNextPreviewHtml(files);assert.match(html,/url\("data:image\/png;base64,/);assert.doesNotMatch(html,/(?:\/|\.\/)data:image/);assert.doesNotMatch(html,/assets\/hero\.png/);
});

test('preview renders the requested generated route and rejects paths outside approved project pages',()=>{
 const files=make('export default function Page(){return <main><h1>Pagina de acasă</h1><p>Informații despre atelier și serviciile oferite.</p></main>}');
 files.push({path:'components/Navbar.tsx',content:'export default function Navbar(){return <nav><a href="/">Acasă</a><a href="/contact/">Contact</a></nav>}'});
 files.push({path:'app/contact/page.tsx',content:'import Navbar from "../../components/Navbar";export default function Contact(){return <main><Navbar/><h1>Contactează atelierul</h1><form><input name="nume"/></form></main>}'});
 const html=renderNextPreviewHtml(files,{path:'/contact/'});assert.match(html,/Contactează atelierul/);assert.match(html,/<nav>/);assert.doesNotMatch(html,/Pagina de acasă/);assert.match(html,/script-src 'none'/);
 for(const path of ['/app/admin','/../contact','https://example.com/','/servicii'])assert.throws(()=>renderNextPreviewHtml(files,{path}),/există/);
 assert.match(renderNextPreviewHtml(files,{path:'/'}),/Pagina de acasă/);
});
