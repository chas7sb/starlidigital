import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const require=createRequire(join(process.env.APPDATA,'npm/node_modules/vercel/package.json'));
const config=await import(pathToFileURL(require.resolve('@vercel/cli-config')).href);
const auth=await import(pathToFileURL(require.resolve('@vercel/cli-auth/credentials-store.js')).href);
const settings=(config.default||config);const credentialStore=(auth.default||auth);
const directory=settings.getGlobalPathConfig();const credentials=await credentialStore.readCliAuthConfig(directory);
if(!credentials?.token)throw new Error('Vercel CLI authentication is not ready.');
const project=JSON.parse(readFileSync('web/.vercel/project.json'));
const expiresAt=Date.now()+90*86400000;
const response=await fetch('https://api.vercel.com/v3/user/tokens?teamId='+encodeURIComponent(project.orgId),{method:'POST',headers:{Authorization:`Bearer ${credentials.token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Starlidigital production API',expiresAt}),signal:AbortSignal.timeout(20000)});
const body=await response.json();if(!response.ok||typeof body.bearerToken!=='string'){console.log(JSON.stringify({created:false,http:response.status,reason:body.error?.code||'provider_rejected'}));process.exit(1);}
let env=readFileSync('.env','utf8');for(const[key,value]of Object.entries({VERCEL_TOKEN:body.bearerToken,VERCEL_TEAM_ID:project.orgId})){env=env.replace(new RegExp('^'+key+'=.*(?:\\r?\\n|$)','gm'),'');env+=`${key}=${JSON.stringify(value)}\n`;}
writeFileSync('.env',env);console.log(JSON.stringify({created:true,expiresAt:new Date(expiresAt).toISOString(),team:project.orgId,credential:'saved privately'}));
