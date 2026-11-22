import {PanelRegistry,VERSION} from './index.mjs';
import {sheetsManifest} from './sheets/panel-registration.mjs';
import {emailPanelManifest} from './email/registry.mjs';
const base=[['resource.document','knowledge','Document',true],['resource.tasks','task','Task',false],['resource.project','project','Project',false],['resource.file','file','Drive file',false]];
// Bind native fetch in trusted assembly code; neither token nor actor enters props.
function bindRequest(Component,request){return class extends Component{constructor(options){super({...options,props:{...options.props,request}});}};}
export function buildCompanyPanelRegistry({nativeManifestEnvelope,request,driveMounted=false}){
 if(typeof request!=='function'||nativeManifestEnvelope?.version!==VERSION||!Array.isArray(nativeManifestEnvelope.manifests))throw Error('Authenticated native manifest required');
 const registry=new PanelRegistry(),availability=[];
 function verified(manifest){return nativeManifestEnvelope.manifests.some(m=>m.version===VERSION&&m.type===manifest.type&&Array.isArray(m.resourceKinds)&&m.resourceKinds.length===manifest.resourceKinds.length&&m.resourceKinds.every(k=>manifest.resourceKinds.includes(k))&&m.scopes?.includes('company'));}
 function register(manifest,loader){if(!verified(manifest))return false;registry.register(manifest,loader);availability.push({type:manifest.type,resourceKinds:manifest.resourceKinds,state:'native-route-verified'});return true;}
 for(const [type,kind,title,editable] of base){
  const manifest={version:VERSION,type,title,scopes:['company'],capabilities:['read'],resourceKinds:[kind],editable};
  register(manifest,driveMounted&&['file','knowledge'].includes(kind)?async()=>({default:bindRequest((await import('./DriveResourcePanel.svelte')).default,request)}):()=>import('./ResourcePanel.svelte'));
 }
 register(sheetsManifest,()=>import('./sheets/SheetsPanel.svelte'));
 register(emailPanelManifest,()=>import('./email/ProductPanel.svelte'));
 const advertised=nativeManifestEnvelope.manifests.find(m=>m.type==='resource.email'&&m.version===VERSION&&m.scopes?.includes('company'));const emailActions=availability.some(m=>m.type==='resource.email')&&advertised?.workflowBinding?.version==='starli.email.workflow.v1'&&advertised.workflowBinding.route==='/api/v1/companies/{company}/email-studio/{rid}/{operation}'&&Array.isArray(advertised?.workflowActions)?['preview','review','approve','controlled-send','controlled-state'].filter(action=>advertised.workflowActions.includes(action)):[];
 return {registry,availability,emailActions,version:VERSION};
}
// Probe native product routes using the existing session-bound transport only.
export async function loadCompanyPanelRegistry({request,companyId}){
 const response=await request('/api/v1/panels/manifests',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});
 if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))throw Error('Native panel service unavailable');let nativeManifestEnvelope=await response.json();
 let driveMounted=false;
 try{const drive=await request('/api/v1/companies/'+encodeURIComponent(companyId)+'/drive',{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});if(drive.ok){const body=await drive.json();const owner=body.companyId??body.company;driveMounted=owner===companyId||owner===undefined&&body.contract==='starli.company-drive.v2'&&Array.isArray(body.data);}}catch{}
 let sheetsMounted=false;
 if(nativeManifestEnvelope?.manifests?.some(m=>m.type==='resource.sheet')){try{const metadata=await request('/sheets/editor.json',{cache:'no-store',headers:{Accept:'application/json'}});if(!metadata.ok||!metadata.headers.get('Content-Type')?.includes('application/json')||(await metadata.json()).contract!=='starli.sheets.editor.v1')throw Error();const page=await request('/sheets/index.html',{cache:'no-store'});if(!page.ok)throw Error();const html=await page.text(),asset=html.match(/src="\.\/(assets\/editor-[a-zA-Z0-9_-]+\.js)"/);if(!html.includes('<title>Starli Sheets</title>')||!asset)throw Error();const script=await request('/sheets/'+asset[1],{method:'HEAD',cache:'no-store'});sheetsMounted=script.ok&&!!script.headers.get('Content-Type')?.match(/javascript/);}catch{}}
 if(!sheetsMounted&&Array.isArray(nativeManifestEnvelope?.manifests))nativeManifestEnvelope={...nativeManifestEnvelope,manifests:nativeManifestEnvelope.manifests.filter(m=>m.type!=='resource.sheet')};
 return buildCompanyPanelRegistry({nativeManifestEnvelope,request,driveMounted});
}
