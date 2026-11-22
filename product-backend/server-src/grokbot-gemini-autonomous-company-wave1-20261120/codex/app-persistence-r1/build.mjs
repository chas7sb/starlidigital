import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {dirname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));const [binding,out='claimed-r3']=process.argv.slice(2);
if(!binding||!/^[A-Za-z0-9_-]+$/.test(out)) throw new Error('usage: node build.mjs /absolute/binding.json output-name');
const b=JSON.parse(readFileSync(resolve(binding),'utf8'));
for(const k of ['companyId','projectId','requestId','graphId','taskId','bindingSource']) if(typeof b[k]!=='string'||!b[k]) throw new Error('BINDING_REQUIRED_'+k);
if(!Array.isArray(b.taskIds)||!b.taskIds.length) throw new Error('TASK_IDS_REQUIRED');
const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('GB3_BINDING_'))delete env[k];
const r=spawnSync(process.execPath,['--max-old-space-size=768',resolve(root,'generator/generate.mjs'),'--spec','appspec/doglove.appspec.r3.json','--binding-file',resolve(binding),'--out','generated/'+out,'--execution-class','COMBINED_CANDIDATE'],{cwd:root,env,stdio:'inherit'});process.exit(r.status??1);
