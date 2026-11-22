import {posix} from 'node:path';
import type {BackendSpecification,GeneratedBackendFile,StaticValidationReport,BackendField,BackendReleaseFileManifest} from './domain.js';
import {BACKEND_TEMPLATE_VERSION} from './domain.js';
import {FIXED_DEPENDENCIES,FIXED_DEV_DEPENDENCIES,FIXED_SCRIPTS,sha256,stableJson,validateSpecification} from './policy.js';

const prismaType=(field:BackendField)=>({string:'String',int:'Int',float:'Float',boolean:'Boolean',dateTime:'DateTime',json:'Json',uuid:'String'} as const)[field.type]+(field.required?'':'?')+(field.unique?' @unique':'');
const zodType=(field:BackendField)=>{
 const base=({string:'z.string().max(500)',int:'z.number().int()',float:'z.number()',boolean:'z.boolean()',dateTime:'z.coerce.date()',json:'z.unknown()',uuid:'z.string().uuid()'} as const)[field.type];
 return field.required?base:`${base}.optional()`;
};
const clientName=(name:string)=>name[0].toLowerCase()+name.slice(1);
const routeName=(name:string)=>name.replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase();
const safeFilePath=(path:string)=>path.length>0&&path.length<=180&&path===posix.normalize(path)&&!path.startsWith('/')&&!path.startsWith('../')&&!path.includes('/../')&&/^[A-Za-z0-9._/-]+$/.test(path);

export function generateStarterBackend(input:BackendSpecification):GeneratedBackendFile[]{
 const spec=validateSpecification(input);
 const pkg={name:'starli-generated-backend',version:'0.0.0',private:true,type:'module',engines:{node:'24.x'},scripts:FIXED_SCRIPTS,dependencies:FIXED_DEPENDENCIES,devDependencies:FIXED_DEV_DEPENDENCIES};
 const prismaModels=spec.models.map(model=>`model ${model.name} {\n  id String @id @default(uuid())\n${model.fields.map(field=>`  ${field.name} ${prismaType(field)}`).join('\n')}\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n}`).join('\n\n');
 const schemas=spec.models.map(model=>`export const ${model.name}Input=z.object({\n${model.fields.map(field=>`  ${field.name}: ${zodType(field)},`).join('\n')}\n});`).join('\n\n');
 const routes=spec.models.map(model=>{
  const client=clientName(model.name),path=routeName(model.name);
  return `router.get('/${path}',async(_req,res,next)=>{try{res.json(await prisma.${client}.findMany({take:100,orderBy:{createdAt:'desc'}}));}catch(error){next(error);}});\nrouter.get('/${path}/:id',async(req,res,next)=>{try{const item=await prisma.${client}.findUnique({where:{id:req.params.id}});if(!item)return res.status(404).json({error:'NOT_FOUND'});res.json(item);}catch(error){next(error);}});\nrouter.post('/${path}',async(req,res,next)=>{try{const data=${model.name}Input.parse(req.body);res.status(201).json(await prisma.${client}.create({data}));}catch(error){next(error);}});`;
 }).join('\n\n');
 const openapi={openapi:'3.1.0',info:{title:spec.displayName,version:'1.0.0'},paths:Object.fromEntries(spec.models.flatMap(model=>{
   const path='/api/'+routeName(model.name);return [[path,{get:{summary:`List ${model.name}`,responses:{'200':{description:'OK'}}},post:{summary:`Create ${model.name}`,responses:{'201':{description:'Created'},'400':{description:'Invalid input'}}}}],[path+'/{id}',{get:{summary:`Get ${model.name}`,parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],responses:{'200':{description:'OK'},'404':{description:'Not found'}}}}]];
 }))};
 const files:GeneratedBackendFile[]=[
  {path:'package.json',content:JSON.stringify(pkg,null,2)+'\n'},
  {path:'tsconfig.json',content:JSON.stringify({compilerOptions:{target:'ES2023',module:'NodeNext',moduleResolution:'NodeNext',strict:true,esModuleInterop:true,skipLibCheck:true,outDir:'dist',types:['node']},include:['src/**/*.ts','test/**/*.ts']},null,2)+'\n'},
  {path:'.env.example',content:'DATABASE_URL=secret-reference-only\nPORT=3000\nNODE_ENV=development\n'},
  {path:'prisma/schema.prisma',content:`generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\n${prismaModels}\n`},
  {path:'src/config.ts',content:`import {z} from 'zod';\nconst Env=z.object({DATABASE_URL:z.string().min(1),PORT:z.coerce.number().int().min(1024).max(65535).default(3000),NODE_ENV:z.enum(['development','test','production']).default('development')});\nexport const env=Env.parse(process.env);\n`},
  {path:'src/db.ts',content:`import {PrismaClient} from '@prisma/client';\nexport const prisma=new PrismaClient();\n`},
  {path:'src/schemas.ts',content:`import {z} from 'zod';\n${schemas}\n`},
  {path:'src/routes.ts',content:`import {Router} from 'express';\nimport {prisma} from './db.js';\nimport {${spec.models.map(model=>model.name+'Input').join(',')}} from './schemas.js';\nexport const router=Router();\n${routes}\n`},
  {path:'src/app.ts',content:`import express from 'express';\nimport pinoHttp from 'pino-http';\nimport {ZodError} from 'zod';\nimport {router} from './routes.js';\nexport const app=express();\napp.disable('x-powered-by');\napp.use(express.json({limit:'256kb'}));\n${spec.features?.requestLogging===false?'':"app.use(pinoHttp());"}\napp.get('/health',(_req,res)=>res.json({status:'ok'}));\napp.get('/readiness',async(_req,res)=>{res.json({status:'ready'});});\napp.get('/openapi.json',(_req,res)=>res.sendFile('openapi.json',{root:process.cwd()}));\napp.use('/api',router);\napp.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(error instanceof ZodError)return res.status(400).json({error:'VALIDATION_ERROR',issues:error.issues.map(issue=>({path:issue.path,message:issue.message}))});console.error('request_failed',{error:error instanceof Error?error.name:'UnknownError'});return res.status(500).json({error:'INTERNAL_ERROR'});});\n`},
  {path:'src/index.ts',content:`import {app} from './app.js';\nimport {env} from './config.js';\nconst server=app.listen(env.PORT,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_started',port:env.PORT})));\nconst shutdown=()=>server.close(()=>process.exit(0));\nprocess.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);\n`},
  {path:'openapi.json',content:JSON.stringify(openapi,null,2)+'\n'},
  {path:'test/health.test.ts',content:`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport request from 'supertest';\nprocess.env.DATABASE_URL='postgresql://example.invalid/test';\nprocess.env.NODE_ENV='test';\nconst {app}=await import('../src/app.js');\ntest('health endpoint',async()=>{const res=await request(app).get('/health');assert.equal(res.status,200);assert.deepEqual(res.body,{status:'ok'});});\n`},
  {path:'starli-backend.json',content:JSON.stringify({templateVersion:BACKEND_TEMPLATE_VERSION,nodeVersion:'24',specificationHash:sha256(stableJson(spec)),managedRuntime:true,database:'postgresql',migrationExecution:'disabled'},null,2)+'\n'}
 ];
 return files.sort((a,b)=>a.path.localeCompare(b.path));
}

export function validateGeneratedSource(files:GeneratedBackendFile[]):StaticValidationReport{
 const errors:string[]=[],warnings:string[]=[];
 if(files.length<8||files.length>40)errors.push('Unexpected generated file count.');
 const paths=new Set<string>();let totalBytes=0;
 for(const file of files){
  if(!safeFilePath(file.path))errors.push(`Unsafe generated path: ${file.path}`);
  if(paths.has(file.path))errors.push(`Duplicate generated path: ${file.path}`);paths.add(file.path);
  if(typeof file.content!=='string')errors.push(`Generated file is not text: ${file.path}`);else totalBytes+=Buffer.byteLength(file.content,'utf8');
  if(file.content.length>256000)errors.push(`Generated file too large: ${file.path}`);
  if(/(?:node:child_process|child_process|execSync\(|spawn\(|eval\(|new Function\(|\/var\/run\/docker\.sock|\/etc\/|file:\/\/|postinstall|preinstall)/.test(file.content))errors.push(`Forbidden runtime primitive in ${file.path}`);
 }
 if(totalBytes>1000000)errors.push('Generated source tree is too large.');
 for(const required of ['package.json','prisma/schema.prisma','src/app.ts','src/index.ts','src/config.ts','src/routes.ts','openapi.json','test/health.test.ts','starli-backend.json'])if(!paths.has(required))errors.push(`Missing required file: ${required}`);
 try{
  const pkg=JSON.parse(files.find(file=>file.path==='package.json')?.content||'{}');
  if(stableJson(pkg.dependencies)!==stableJson(FIXED_DEPENDENCIES)||stableJson(pkg.devDependencies)!==stableJson(FIXED_DEV_DEPENDENCIES)||stableJson(pkg.scripts)!==stableJson(FIXED_SCRIPTS))errors.push('Dependency or script policy mismatch.');
  if(pkg.engines?.node!=='24.x')errors.push('Node runtime policy mismatch.');
 }catch{errors.push('Invalid package.json.');}
 const prisma=files.find(file=>file.path==='prisma/schema.prisma')?.content||'';
 if(!prisma.includes('provider = "postgresql"')||!prisma.includes('url      = env("DATABASE_URL")'))errors.push('Prisma datasource policy mismatch.');
 if(/binaryTargets|directUrl|shadowDatabaseUrl|previewFeatures/.test(prisma))errors.push('Unsupported Prisma configuration.');
 return {valid:errors.length===0,errors,warnings,fileCount:files.length,totalBytes};
}

export const sourceHash=(files:GeneratedBackendFile[])=>sha256(stableJson(files));

export function releaseFileManifest(files:GeneratedBackendFile[]):BackendReleaseFileManifest[]{
 const validation=validateGeneratedSource(files);if(!validation.valid)throw new Error('Cannot create release manifest from invalid generated source.');
 return files.map(file=>({path:file.path,sha256:sha256(file.content),bytes:Buffer.byteLength(file.content,'utf8')})).sort((a,b)=>a.path.localeCompare(b.path));
}
