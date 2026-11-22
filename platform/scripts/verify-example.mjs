import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {makeNextProjectFiles} from '../server/src/next-template.ts';
import {verifyNextProject} from '../server/src/next-worker.ts';
const folder='output/next-cu-imagini';
const files=makeNextProjectFiles({page:readFileSync(folder+'/app/page.tsx','utf8'),css:readFileSync(folder+'/app/globals.css','utf8'),title:'Lut și Lumină — atelier de ceramică în Brașov',description:'Ateliere creative de grup și obiecte ceramice lucrate manual.'});
for(const name of ['hero','logo'])files.push({path:`public/assets/${name}.png`,encoding:'base64',content:readFileSync(`${folder}/public/assets/${name}.png`).toString('base64')});
for(const file of files.filter(f=>!f.encoding)){mkdirSync(folder+'/'+file.path.split('/').slice(0,-1).join('/'),{recursive:true});writeFileSync(folder+'/'+file.path,file.content);}
process.env.NEXT_WORKER_ENABLED='true';
try{
 const result=await verifyNextProject(files);
 writeFileSync('output/next-cu-imagini-preview.html',result.previewHtml);
 writeFileSync('output/next-verification.json',JSON.stringify({...result,previewHtml:undefined,source:folder,verifiedAt:new Date().toISOString()},null,2));
 console.log(JSON.stringify({status:result.validationStatus,provider:result.validationProvider,files:files.length,previewBytes:Buffer.byteLength(result.previewHtml)}));
}catch(error){writeFileSync('output/next-verification.json',JSON.stringify({validationStatus:'FAILED',error:error.message,source:folder},null,2));throw error;}
