import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';import {join,resolve,relative,dirname} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {createHash,createHmac,timingSafeEqual} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {treeDigest} from '../app-persistence-r1/server/app-server.ts';import {buildReceiptCanonicalPayload} from '../../gemini1/orchestration-r6/executor-receipt-issuer.mjs';
import {loadModelBuild as loadVerifiedBuild} from './model-build-loader.mjs';import {validateAppSchema} from './schema.mjs';
const root=dirname(fileURLToPath(import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex'),fail=x=>{throw Error(x)};
export async function resolveNativeBuild(c){
 const e=c.execution;if(!e||e.executionClass!=='NATIVE_NONPRODUCTION'||e.provider!=='OPENROUTER_MODEL'||e.modelCalls!==2||e.outputs?.length!==2||e.files?.length!==4)fail('NATIVE_EXECUTION_REQUIRED');
 for(const k of ['nativeRoot','companyId','projectId','requestId','graphId','sourceMessageId','outputDir'])if(!c[k])fail('CONTEXT_REQUIRED_'+k);
 const native=realpathSync(c.nativeRoot);if(!native.startsWith('/tmp/grokbot1-w1-'))fail('DISPOSABLE_NATIVE_ROOT_REQUIRED');
 const runtime=join(native,'native-worker-runtime'),ar=realpathSync(join(runtime,'artifacts')),source=realpathSync(e.buildDir);
 if(!source.startsWith(ar+'/')||e.graphId!==c.graphId)fail('BUILD_SOURCE_SCOPE_MISMATCH');
 const db=new DatabaseSync(join(runtime,'graphs.sqlite'),{readOnly:true});let graph,links;
 try{graph=db.prepare('SELECT * FROM orchestration_graphs WHERE graph_id=?').get(c.graphId);links=db.prepare('SELECT * FROM delegation_links WHERE graph_id=?').all(c.graphId)}finally{db.close()}
 for(const [k,v] of Object.entries({company_id:c.companyId,project_id:c.projectId,request_id:c.requestId,source_message_id:c.sourceMessageId,machinery_run_id:e.machineryRunId}))if(graph?.[k]!==v)fail('CANONICAL_GRAPH_MISMATCH_'+k);
 if(['STOP_REQUESTED','STOPPED','REVOKED'].includes(graph.graph_state)||links.length!==2)fail('CANONICAL_GRAPH_INACTIVE');
 const tasks=links.map(l=>l.task_id).sort();if(c.taskIds&&JSON.stringify([...c.taskIds].sort())!==JSON.stringify(tasks))fail('TASK_IDS_MISMATCH');
 const key=readFileSync(join(runtime,'.receipt-key')),files=new Map(),proof=[];
 for(const o of e.outputs){
  const r=o.receipt,p=o.provenance,link=links.find(l=>l.task_id===r?.taskId);
  if(!link||link.server_provenance_verified!==1||link.artifact_digest!==o.artifactDigest||link.execution_class!=='NATIVE_NONPRODUCTION')fail('CANONICAL_ADMITTED_OUTPUT_REQUIRED');
  for(const [k,v] of Object.entries({companyId:c.companyId,projectId:c.projectId,requestId:c.requestId,graphId:c.graphId,taskId:link.task_id,callId:link.call_id,childRunId:link.child_run_id,roomId:link.child_room_id,artifactDigest:o.artifactDigest,authorizationRevision:graph.authorization_revision,generation:graph.generation}))if(r[k]!==v)fail('EXECUTOR_RECEIPT_MISMATCH_'+k);
  const sig=createHmac('sha256',key).update(buildReceiptCanonicalPayload(r)).digest();const got=Buffer.from(r.hmac??'','hex');if(sig.length!==got.length||!timingSafeEqual(sig,got))fail('EXECUTOR_SIGNATURE_INVALID');
  const artifact=realpathSync(o.artifactPath);if(!artifact.startsWith(ar+'/'))fail('OUTPUT_ARTIFACT_ESCAPE');const bytes=readFileSync(artifact);if(sha(bytes)!==o.artifactDigest||JSON.stringify(JSON.parse(bytes))!==JSON.stringify(o.result))fail('OUTPUT_BYTES_MISMATCH');
  const result=JSON.parse(bytes);for(const [k,v] of Object.entries({companyId:c.companyId,projectId:c.projectId,requestId:c.requestId,graphId:c.graphId,workPackageId:r.taskId}))if(result.scope?.[k]!==v)fail('WORKER_SCOPE_MISMATCH_'+k);
  if(p.kind!=='PERSISTED_NATIVE_CAPABILITY_RESULT'||p.agencyReceiptId!==r.agencyReceiptId||p.workPackageId!==r.taskId||p.machineryRunId!==e.machineryRunId||result.provider!=='OPENROUTER_MODEL'||result.modelCalls!==1||result.nativeExecution?.executionClass!=='NATIVE_NONPRODUCTION')fail('WORKER_PROVENANCE_INVALID');
  const allowed=result.worker.kind==='FRONTEND'?['frontend/App.jsx','frontend/api.mjs']:result.worker.kind==='BACKEND'?['backend/app.json','backend/routes.json']:[];
  if(result.files.length!==2||!allowed.length)fail('WORKER_FILE_SET_INVALID');
  for(const f of result.files){if(!allowed.includes(f.path)||files.has(f.path))fail('WORKER_FILE_PATH_INVALID');const target=join(source,f.path);if(realpathSync(target)!==target)fail('SOURCE_SYMLINK_DENIED');const content=readFileSync(target);const pin=e.files.find(x=>x.path===target);if(content.toString()!==f.content||pin?.sha256!==sha(content)||pin?.agencyReceiptId!==r.agencyReceiptId||pin?.workerId!==result.worker.botId)fail('MATERIALIZED_SOURCE_MISMATCH');files.set(f.path,content)}
  proof.push({taskId:r.taskId,agencyReceiptId:r.agencyReceiptId,callId:r.callId,childRunId:r.childRunId,outputDigest:o.artifactDigest,workerId:result.worker.botId,workerKind:result.worker.kind,workerSourceHash:result.nativeExecution.workerSourceHash});
 }
 if(files.size!==4)fail('EXACT_FOUR_NATIVE_FILES_REQUIRED');
 const frontendOutput=e.outputs.find(o=>o.result.worker.kind==='FRONTEND'),backendOutput=e.outputs.find(o=>o.result.worker.kind==='BACKEND');
 if(frontendOutput?.result.backendDependency?.artifactDigest!==backendOutput?.artifactDigest||frontendOutput?.result.backendDependency?.agencyReceiptId!==backendOutput?.provenance.agencyReceiptId)fail('ACTUAL_BACKEND_DEPENDENCY_MISMATCH');

 const out=resolve(c.outputDir);if(existsSync(out)){
 const previous=loadVerifiedBuild(out),prior=previous.receipt.nativeProvenance;
 const expectedFiles=[...files].map(([path,b])=>({path,sha256:sha(b)}));
 if(!prior||prior.sourceMessageId!==c.sourceMessageId||prior.machineryRunId!==e.machineryRunId||JSON.stringify(prior.outputs)!==JSON.stringify(proof)||JSON.stringify(prior.sourceFiles)!==JSON.stringify(expectedFiles)||prior.hostAdapter.runtimeSha256!==sha(readFileSync(join(root,'native-start.mjs')))||prior.hostAdapter.builderSha256!==sha(readFileSync(fileURLToPath(import.meta.url)))||JSON.stringify(JSON.parse(previous.dist.get('/_native/BUILD-PROVENANCE.json')?.toString()??'null'))!==JSON.stringify(prior))fail('EXISTING_NATIVE_BUILD_MISMATCH');
 for(const [n,b]of files)if(!readFileSync(join(out,'native-source',n)).equals(b)||!previous.dist.get('/_native/'+n)?.equals(b))fail('EXISTING_NATIVE_SOURCE_MISMATCH');
 for(const [k,v]of Object.entries({companyId:c.companyId,projectId:c.projectId,requestId:c.requestId,graphId:c.graphId}))if(previous.spec.binding[k]!==v)fail('EXISTING_NATIVE_BINDING_MISMATCH');
 return {buildDir:out,receipt:previous.receipt};
 }mkdirSync(out,{recursive:true,mode:0o700});
 for(const [n,b] of files)for(const base of ['native-source','dist/_native']){const target=join(out,base,n);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,b)}
 const schema=validateAppSchema(JSON.parse(files.get('backend/app.json')),JSON.parse(files.get('backend/routes.json')));
 const entry="import React from 'react';import {createRoot} from 'react-dom/client';import App from './native-source/frontend/App.jsx';import {createAppApi} from './native-source/frontend/api.mjs';\nasync function mount(){const res=await fetch('/api/app/session',{credentials:'include',cache:'no-store'});if(!res.ok)throw Error('Session required: '+res.status);const {csrfToken}=await res.json();createRoot(document.getElementById('root')).render(React.createElement(App,{api:createAppApi({baseUrl:'',csrf:csrfToken})}));}mount().catch(e=>{document.getElementById('root').textContent=e.message});\n";
 writeFileSync(join(out,'host-entry.jsx'),entry);writeFileSync(join(out,'dist/_native/host-entry.jsx'),entry);
 const nm=resolve(root,'../../../../..','node_modules');const esbuild=await import(pathToFileURL(join(nm,'esbuild/lib/main.js')).href);
 const sourceImportGuard={name:'generated-source-import-boundary',setup(build){build.onResolve({filter:/.*/},args=>{if(args.importer.startsWith(join(out,'native-source'))&&!['react'].includes(args.path))throw Error('GENERATED_IMPORT_DENIED');if(args.importer===join(out,'host-entry.jsx')&&!['react','react-dom/client','./native-source/frontend/App.jsx','./native-source/frontend/api.mjs'].includes(args.path))throw Error('HOST_IMPORT_DENIED');return undefined;})}};
 mkdirSync(join(out,'dist/assets'),{recursive:true});await esbuild.build({entryPoints:[join(out,'host-entry.jsx')],outfile:join(out,'dist/assets/app.js'),bundle:true,minify:true,format:'esm',platform:'browser',nodePaths:[nm],plugins:[sourceImportGuard],jsx:'transform',define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 const title=schema.name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 writeFileSync(join(out,'dist/index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>body{margin:0;background:#f6f8fc;color:#17243d;font-family:system-ui,sans-serif}button,input,select,textarea{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>');
 const spec={schemaVersion:1,appId:c.buildId??'model-'+sha(c.graphId).slice(0,24),name:schema.name,specRevision:1,storage:{implementation:'SQLITE_DECLARATIVE_COLLECTIONS',generatedServerCodeExecuted:false},binding:{companyId:c.companyId,projectId:c.projectId,requestId:c.requestId,graphId:c.graphId,taskId:tasks[0],taskIds:tasks,principalKind:c.principalKind??'GUEST_TEMPORARY'}};
 const raw=JSON.stringify(spec,null,2)+'\n';writeFileSync(join(out,'appspec.json'),raw);
 const nativeProvenance={executionClass:'NATIVE_NONPRODUCTION',provider:e.provider,modelCalls:2,sourceMessageId:c.sourceMessageId,machineryRunId:e.machineryRunId,sourceFiles:[...files].map(([path,b])=>({path,sha256:sha(b)})),outputs:proof,hostAdapter:{entrySha256:sha(entry),builderSha256:sha(readFileSync(fileURLToPath(import.meta.url))),runtimeSha256:sha(readFileSync(join(root,'native-start.mjs'))),schemaSha256:sha(readFileSync(join(root,'schema.mjs'))),collectionsSha256:sha(readFileSync(join(root,'collections.mjs'))),loaderSha256:sha(readFileSync(join(root,'model-build-loader.mjs')))},transformation:'MODEL_FRONTEND_ESBUILD_AND_VALIDATED_DECLARATIVE_BACKEND'};
 writeFileSync(join(out,'dist/_native/BUILD-PROVENANCE.json'),JSON.stringify(nativeProvenance));
 for(const n of ['native-start.mjs','schema.mjs','collections.mjs','model-build-loader.mjs'])writeFileSync(join(out,'dist/_native/'+n),readFileSync(join(root,n)));
 const dist=treeDigest(join(out,'dist'));
 const receipt={schema:'MODEL_APP_BUILD_RECEIPT_V1',appId:spec.appId,specRevision:1,buildRevision:1,buildFingerprint:sha(JSON.stringify({spec:sha(raw),nativeProvenance,esbuild:esbuild.version})),specSha256:sha(raw),artifactDigest:dist.digest,binding:spec.binding,nativeProvenance,distFiles:dist.files,executionClass:'NATIVE_NONPRODUCTION'};
 writeFileSync(join(out,'APP_BUILD_RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n');loadVerifiedBuild(out);return {buildDir:out,receipt};
}
export function createNativeBuildResolver({nativeRoot,outputRoot}){if(!nativeRoot||!outputRoot)fail('TRUSTED_RESOLVER_ROOTS_REQUIRED');return async context=>resolveVerifiedBuild({...context,nativeRoot,outputDir:join(outputRoot,'native-'+sha(JSON.stringify([context.companyId,context.projectId,context.graphId,context.sourceMessageId,context.execution?.outputs?.map(o=>o.artifactDigest)])).slice(0,32))})}
function normalizeLifecycleContext(c,options={}){
 const outputDir=options.outputDir??c.outputDir;
 if(c.execution)return {...c,outputDir};
 if(!c.nativeRoot||!c.graphId)fail('TRUSTED_NATIVE_CONTEXT_REQUIRED');
 const runtime=realpathSync(join(c.nativeRoot,'native-worker-runtime'));
 const executionPath=realpathSync(c.executionPath??join(runtime,'execution-'+c.graphId.replace(/[^a-zA-Z0-9]/g,'_')+'.json'));
 if(!executionPath.startsWith(runtime+'/'))fail('NATIVE_EXECUTION_PATH_ESCAPE');
 const bytes=readFileSync(executionPath);if(c.executionDigest&&sha(bytes)!==c.executionDigest)fail('NATIVE_EXECUTION_DIGEST_MISMATCH');
 const execution=JSON.parse(bytes);
 if(c.nativeBuildDir&&realpathSync(c.nativeBuildDir)!==realpathSync(execution.buildDir))fail('NATIVE_BUILD_DIRECTORY_MISMATCH');
 if(c.nativeFiles&&JSON.stringify(c.nativeFiles)!==JSON.stringify(execution.files))fail('NATIVE_CONTEXT_FILES_MISMATCH');
 if(c.outputReceipts&&JSON.stringify(c.outputReceipts)!==JSON.stringify(execution.outputs.map(o=>({agencyReceiptId:o.provenance.agencyReceiptId,artifactDigest:o.artifactDigest}))))fail('NATIVE_CONTEXT_RECEIPTS_MISMATCH');
 return {...c,execution,outputDir};
}
export async function resolveVerifiedBuild(context,options={}){return (await resolveNativeBuild(normalizeLifecycleContext(context,options))).buildDir}
export async function resolveVerifiedAppBuild(context,options={}){const result=await resolveNativeBuild(normalizeLifecycleContext(context,options));return {...result,build:loadVerifiedBuild(result.buildDir)}}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const c=JSON.parse(readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(await resolveNativeBuild(c)))}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1}}
