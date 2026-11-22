import {readFileSync,realpathSync} from 'node:fs';import {join,resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {treeDigest} from '../app-persistence-r1/server/app-server.ts';import {deriveFrontend} from './syntax-transform.mjs';
import {validateAppSchema} from './schema.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),fail=x=>{throw Error(x)};
export function loadModelBuild(dir){
 dir=realpathSync(dir);const receipt=JSON.parse(readFileSync(join(dir,'APP_BUILD_RECEIPT.json'))),raw=readFileSync(join(dir,'appspec.json'));
 if(receipt.schema!=='MODEL_APP_BUILD_RECEIPT_V1'||!Number.isSafeInteger(receipt.buildRevision)||!Number.isSafeInteger(receipt.specRevision)||receipt.buildRevision!==receipt.specRevision||!/^[a-f0-9]{64}$/.test(receipt.artifactDigest)||sha(raw)!==receipt.specSha256)fail('MODEL_BUILD_RECEIPT_INVALID');
 const spec=JSON.parse(raw);if(spec.schemaVersion!==1||spec.appId!==receipt.appId||spec.specRevision!==receipt.specRevision||JSON.stringify(spec.binding)!==JSON.stringify(receipt.binding))fail('MODEL_BUILD_SPEC_INVALID');
 const actual=treeDigest(join(dir,'dist'));if(actual.digest!==receipt.artifactDigest||JSON.stringify(actual.files)!==JSON.stringify(receipt.distFiles))fail('MODEL_BUILD_DIST_MISMATCH');
 const dist=new Map();for(const f of actual.files){const path=join(dir,'dist',f.path);if(realpathSync(path)!==path)fail('MODEL_BUILD_SYMLINK_DENIED');dist.set('/'+f.path,readFileSync(path))}
 const prov=receipt.nativeProvenance,expected=['backend/app.json','backend/routes.json','frontend/App.jsx','frontend/api.mjs'];
 if(prov?.provider!=='OPENROUTER_MODEL'||prov.modelCalls!==2||JSON.stringify(prov.sourceFiles?.map(f=>f.path).sort())!==JSON.stringify(expected))fail('MODEL_BUILD_SOURCE_REQUIRED');
 if(JSON.stringify(JSON.parse(dist.get('/_native/BUILD-PROVENANCE.json')))!==JSON.stringify(prov))fail('MODEL_BUILD_PROVENANCE_MISMATCH');
 for(const f of prov.sourceFiles){const p=join(dir,'native-source',f.path);if(realpathSync(p)!==p||sha(readFileSync(p))!==f.sha256||!readFileSync(p).equals(dist.get('/_native/'+f.path)))fail('MODEL_BUILD_SOURCE_CHANGED')}
 const transformed=deriveFrontend(readFileSync(join(dir,'native-source/frontend/App.jsx')));if(JSON.stringify(transformed.receipt)!==JSON.stringify(prov.syntaxTransform))fail('SYNTAX_TRANSFORM_RECEIPT_MISMATCH');if(transformed.receipt&&(!transformed.bytes.equals(readFileSync(join(dir,'derived-source/frontend/App.jsx')))||!transformed.bytes.equals(dist.get('/_native/DERIVED-App.jsx'))))fail('DERIVED_MODEL_SOURCE_CHANGED');
 const here=dirname(fileURLToPath(import.meta.url));
 for(const [file,key] of Object.entries({'native-start.mjs':'runtimeSha256','schema.mjs':'schemaSha256','collections.mjs':'collectionsSha256','model-build-loader.mjs':'loaderSha256','syntax-transform.mjs':'syntaxTransformSha256'})){
  const bytes=readFileSync(join(here,file));if(sha(bytes)!==prov.hostAdapter[key]||!bytes.equals(dist.get('/_native/'+file)))fail('TRUSTED_MODEL_HOST_SOURCE_CHANGED');
 }
 const schema=validateAppSchema(JSON.parse(readFileSync(join(dir,'native-source/backend/app.json'))),JSON.parse(readFileSync(join(dir,'native-source/backend/routes.json'))));
 return {dir,receipt,spec,dist,schema};
}
