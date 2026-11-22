import {readFileSync,writeFileSync} from 'node:fs';
import {Store} from '../server/src/store.ts';
const store=new Store();try{if(store.list('projects').some(p=>['BUILDING','VERIFYING','DEPLOYING'].includes(p.status)))throw new Error('Există proiecte în lucru. Nu repornesc serverul.');}finally{store.close();}
let env=readFileSync('.env','utf8');
for(const [key,value]of Object.entries({PUBLIC_APP_URL:'http://127.0.0.1:4119',ALLOWED_ORIGINS:'http://127.0.0.1:4119,http://localhost:4119,http://127.0.0.1:5188,http://localhost:5188'})){env=env.replace(new RegExp('^'+key+'=.*\\r?\\n','gm'),'');env+=key+'='+value+'\n';}
writeFileSync('.env',env);console.log('Adresa locală principală este http://127.0.0.1:4119/.');
