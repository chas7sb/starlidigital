import {readFileSync,writeFileSync} from 'node:fs';
import {Store,now} from '../server/src/store.ts';
import {projectArchive} from '../web/src/project-archive.ts';
const paths=['app/page.tsx','app/globals.css','app/layout.tsx','package.json','tsconfig.json','next-env.d.ts','next.config.ts','public/assets/hero.png','public/assets/logo.png'];
const files=paths.map(path=>path.endsWith('.png')?{path,encoding:'base64',content:readFileSync('output/next-cu-imagini/'+path).toString('base64')}:{path,content:readFileSync('output/next-cu-imagini/'+path,'utf8')});
const report=JSON.parse(readFileSync('output/next-verification.json','utf8'));
if(report.validationStatus!=='PASSED')throw new Error('Proiectul demonstrativ nu a trecut verificarea.');
writeFileSync('output/lut-si-lumina-nextjs.zip',projectArchive(files));
const store=new Store();try{
 const admin=store.findUser('alex');if(!admin||admin.role!=='ADMIN')throw new Error('Administratorul nu există.');
 const previous=store.get('projects','qa-next-lut-lumina');
 store.put('projects',{id:'qa-next-lut-lumina',ownerId:admin.id,name:'Demo verificare · Lut și Lumină',brief:'Proiect demonstrativ pentru verificare tehnică. Afacere fictivă de ceramică în Brașov; nu este un client sau un proiect comercial. Sursa și imaginile au fost generate prin API și compilate în workerul izolat.',files,previewHtml:readFileSync('output/next-cu-imagini-preview.html','utf8'),status:'PREVIEW',validationStatus:'PASSED',validationProvider:'DOCKER',buildLog:report.buildLog,buildError:null,createdAt:previous?.createdAt||now(),updatedAt:now(),sources:[],research:null,deploymentUrl:null});
 console.log('Proiectul demonstrativ verificat este disponibil în dashboardul administratorului.');
}finally{store.close();}
