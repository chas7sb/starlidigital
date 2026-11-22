/** Isolated staging composition of the first-party HTTPS GraphQL job addon.
 * Root supplies an exact proxy route on the existing API origin. No generic forwarding.
 */
import {createRequire}from'node:module';import{createServer}from'node:http';import{readFileSync,lstatSync,writeFileSync}from'node:fs';import{generateKeyPairSync,createPrivateKey}from'node:crypto';
import{CompanyNoteJobs,companyNoteGraphQL}from'./company-note-jobs.mjs';
import{SignedNativeChannel,nativeHooks,verifyEnrolledPhysical,workerReplySigner,publisherIdentitySigner}from'./native-authority.mjs';
const require=createRequire(import.meta.url);const {createYoga,createSchema}=require('graphql-yoga');const {parse}=require('graphql');
const COMPANY=process.env.STARLI_COMPANY_ID;
if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(COMPANY||''))throw Error('STARLI_COMPANY_ID_REQUIRED');
const ROOT=process.env.STARLI_COMPUTER_STATE;
if(!ROOT||!ROOT.startsWith('/'))throw Error('STARLI_COMPUTER_PRIVATE_STATE_REQUIRED');
const PRIVATE=ROOT+'/private';
function privateBytes(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o027)||![0,process.getuid()].includes(s.uid))throw Error('PRIVATE_FILE_REQUIRED');return readFileSync(path)}
const config=JSON.parse(privateBytes(PRIVATE+'/config.json'));
const COMPUTER=config.computerId, WORKER='company-note-worker';
if(config.companyId!==COMPANY || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(COMPUTER)||config.workerId!==WORKER)throw Error('ENROLLMENT_REQUIRED');
const nativeKey=privateBytes(PRIVATE+'/transport.key');
const nativePort=Number(process.env.STARLI_NATIVE_PORT || 8190);
if(![8190,18447].includes(nativePort))throw Error('NATIVE_BINDING_DENIED');
const host=JSON.parse(privateBytes(PRIVATE+'/host-verification.json'));
if(host.company!==COMPANY||host.computer!==COMPUTER||typeof host.kid!=='string'||!/^([a-f0-9]{64})$/.test(host.keyHex))throw Error('COMPANY_HOST_VERIFIER_REQUIRED');
const enrollments=new Map([[host.kid,{company:COMPANY,computer:COMPUTER,key:Buffer.from(host.keyHex,'hex')}]]);
const privateKey=createPrivateKey(privateBytes(PRIVATE+'/reply-private.pem'));
async function send(path,envelope){
 if(path!=='/internal/company-computer/job-authority')throw Error('FIXED_NATIVE_AUTHORITY_PATH');
 const start=performance.now();
 const {phase,operationId}=envelope.message.payload;
 const trace=(reason)=>console.error(JSON.stringify({event:'computer.native_authority',phase,operation:operationId.slice(0,12),reason,millis:Math.round(performance.now()-start)}));
 let response;
 try{response=await fetch('http://127.0.0.1:'+nativePort+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope),redirect:'error',signal:AbortSignal.timeout(6500)});}
 catch(error){trace(error.name==='TimeoutError'?'timeout':'transport');throw error}
 if(response.status!==200){trace('http_'+response.status);throw Error('NATIVE_AUTHORITY_DENIED')}let text='';for await(const part of response.body){text+=Buffer.from(part).toString();if(Buffer.byteLength(text)>16384)throw Error('NATIVE_REPLY_LIMIT')}return JSON.parse(text);
}
const hooks=nativeHooks({channel:new SignedNativeChannel(nativeKey),send,verifyPhysical:(job,receipt)=>verifyEnrolledPhysical(job,receipt,enrollments)});
const jobs=new CompanyNoteJobs(ROOT+'/state/notes.sqlite',{...hooks,signReply:workerReplySigner(privateKey,'company-note-reply-v1')});
if(process.argv.includes('--register-publisher')){
 const proof=JSON.parse(privateBytes(PRIVATE+'/publisher-registration-approval.json'));
 const identity={id:'company-frame-publisher-v1',company:COMPANY,computer:COMPUTER,worker:'company-frame-publisher',role:'publisher'};
 const token=jobs.register(identity,proof,(i,p)=>p.approved===true&&p.companyId===i.company&&p.computerId===i.computer&&p.workerId===i.worker&&p.role==='publisher');
 writeFileSync(PRIVATE+'/publisher-credential.json',JSON.stringify({...identity,token}),{mode:0o600,flag:'wx'});jobs.close();console.log('Dedicated stage frame publisher registered privately.');
}else if(process.argv.includes('--register')){
 // Only the locally reviewed operator command can enter this branch; no enrollment resolver exists.
 const proof=JSON.parse(privateBytes(PRIVATE+'/registration-approval.json'));
 const verify=(identity,p)=>p.approved===true&&p.companyId===identity.company&&p.computerId===identity.computer&&p.workerId===identity.worker;
 for(const role of ['producer','worker']){
  const token=jobs.register({id:'company-pilot-'+role+'-v1',company:COMPANY,computer:COMPUTER,worker:WORKER,role},proof,verify);
  writeFileSync(PRIVATE+'/'+role+'-credential.json',JSON.stringify({role,companyId:COMPANY,computerId:COMPUTER,workerId:WORKER,token}),{mode:0o600,flag:'wx'});
 }
 jobs.close();console.log('Stage company producer and worker registered; credentials written privately.');
}else{
 const addon=companyNoteGraphQL(jobs);
 for(const [name,resolve] of Object.entries(addon.resolvers.Mutation)){
  addon.resolvers.Mutation[name]=async function(parent,args,...rest){
   try{return await resolve(parent,args,...rest)}
   catch(error){
    let action=name, op=args.operationId;
    if(typeof args.message==='string'){try{const m=JSON.parse(args.message);action=['authorize','claim','complete'].includes(m.action)?m.action:'exchange';op=m.operationId}catch{}}
    const reason=Number.isSafeInteger(error?.errcode)?'sqlite_'+error.errcode:/^[A-Z][A-Z_]{1,55}$/.test(error?.message)?error.message:error?.name==='TimeoutError'?'timeout':'denied';
    console.error(JSON.stringify({event:'computer.job_denied',action,operation:typeof op==='string'&&/^[a-f0-9]{64}$/.test(op)?op.slice(0,12):null,reason}));
    throw error;
   }
  };
 }
 const yoga=createYoga({schema:createSchema({typeDefs:['type Query { pilotReady:Boolean! }',addon.typeDefs,'type Mutation { _unused:Boolean }'],resolvers:{Query:{pilotReady:()=>false},...addon.resolvers}}),graphqlEndpoint:'/graphql',graphiql:false,logging:false,maskedErrors:true});
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||!['/graphql','/internal/company-note/publisher-identity'].includes(req.url)){res.writeHead(404);res.end();return}
  if(Number(req.headers['content-length']||0)>24576){res.writeHead(413);res.end();return}
  try{
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>24576){res.writeHead(413);res.end();return}chunks.push(chunk)}
   const raw=Buffer.concat(chunks);const body=JSON.parse(raw.toString('utf8'));
   if(req.url==='/internal/company-note/publisher-identity'){
    if(!body||Object.keys(body).sort().join()!=='request,token')throw Error('FIXED_INTROSPECTION_REQUIRED');
    const result=jobs.publisherIdentity(body.token,body.request,publisherIdentitySigner(privateKey,'company-note-reply-v1'));
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
   }
   if(!body||typeof body.query!=='string'||Object.keys(body).some(k=>!['query','variables','operationName'].includes(k)))throw Error('FIXED_GRAPHQL_REQUEST_REQUIRED');
   const parsed=parse(body.query);if(parsed.definitions.length!==1)throw Error('ONE_MUTATION_REQUIRED');
   const operation=parsed.definitions[0];if(operation.kind!=='OperationDefinition'||operation.operation!=='mutation'||operation.selectionSet.selections.length!==1)throw Error('FIXED_MUTATION_REQUIRED');
   const field=operation.selectionSet.selections[0];const method=field.name?.value;
   const roles={companyComputerNoteExchange:'worker',companyComputerNoteSubmit:'producer',companyComputerNoteStatus:'producer'};
   if(field.kind!=='Field'||!Object.hasOwn(roles,method))throw Error('FIXED_MUTATION_REQUIRED');
   const tokenName=roles[method]==='worker'?'deviceToken':'serviceToken',argument=field.arguments?.find(a=>a.name.value===tokenName)?.value;
   const token=argument?.kind==='Variable'?body.variables?.[argument.name.value]:argument?.kind==='StringValue'?argument.value:null;
   jobs.principal(token,roles[method]);
   const request=new Request('http://127.0.0.1:18446/graphql',{method:'POST',headers:{'Content-Type':'application/json'},body:raw});
   const reply=await yoga.fetch(request);const output=[];let total=0;for await(const chunk of reply.body){total+=chunk.length;if(total>32768)throw Error('REPLY_LIMIT');output.push(Buffer.from(chunk))}
   res.writeHead(reply.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(Buffer.concat(output));
  }catch{if(!res.headersSent)res.writeHead(403,{'Cache-Control':'no-store'});res.end('{"code":"COMPANY_STAGE_DENIED"}')}

 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxRequestsPerSocket=32;server.listen(18446,'127.0.0.1');
}
