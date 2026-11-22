import test from 'node:test';import assert from 'node:assert/strict';import {unzipSync,strFromU8} from 'fflate';
import {projectArchive} from '../../web/src/project-archive.js';
test('Next source ZIP preserves UTF-8 source and decodes image bytes',()=>{
 const png=Buffer.from('89504e470d0a1a0a','hex');
 const zip=projectArchive([{path:'app/page.tsx',content:'export default function Page(){return <h1>În România</h1>}'},{path:'public/assets/hero.png',content:png.toString('base64'),encoding:'base64'}]);
 const files=unzipSync(zip);assert.match(strFromU8(files['app/page.tsx']),/În România/);assert.deepEqual(Buffer.from(files['public/assets/hero.png']),png);
 assert.throws(()=>projectArchive([{path:'../secret',content:'x'}]));
});
