import {PanelHost,VERSION} from './index.mjs';
import {httpAdapter} from './http-adapter.mjs';
import {referenceRegistry} from './reference-registry.mjs';
// Assembly-owned imports and native session fetch; never supplied by assistant.
export function createPanelOverlay({request,storage,extensions=[],onAvailability=()=>{}}){
 if(typeof request!=='function'||!storage)throw Error('Native session request and scoped storage required');
 const registry=referenceRegistry();for(const {manifest,loader,load=loader} of extensions)registry.register(manifest,async()=>{
  const response=await request('/api/v1/panels/manifests',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('Native extension route unavailable.');const body=await response.json();
  if(body.version!==VERSION||!body.manifests?.some(m=>m.type===manifest.type&&m.version===VERSION&&m.resourceKinds?.length&&m.resourceKinds.every(k=>manifest.resourceKinds?.includes(k))))throw Error('Native extension route could not be verified.');
  return load();
 });
 const host=new PanelHost(registry,httpAdapter(request),storage);let generation=0;
 let availability={version:VERSION,state:'unverified',routes:[],panels:[]};
 const publish=value=>{availability=value;onAvailability(value);return value;};
 return {host,get availability(){return availability;},
  async switchScope(scope){const epoch=++generation;publish({version:VERSION,state:'loading',routes:[],panels:[]});await host.switchScope(scope);if(epoch!==generation)return;
   try{const response=await request('/api/v1/panels/manifests',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(!response.ok)throw Error('Native panel routes are unavailable.');const body=await response.json();if(epoch!==generation)return;if(body.version!==VERSION||!Array.isArray(body.manifests))throw Error('Panel route contract unavailable.');
    const panels=[];for(const manifest of body.manifests){try{const trusted=registry.get(manifest.type).manifest;if(manifest.version===VERSION&&manifest.resourceKinds?.every(k=>trusted.resourceKinds?.includes(k)))panels.push({type:manifest.type,state:'native-route-verified',resourceKinds:manifest.resourceKinds});}catch{}}
    return publish({version:VERSION,state:'native-route-verified',companyId:scope.ownerId,routes:['/api/v1/panels/manifests'],panels,browserAcceptance:'unverified'});
   }catch{if(epoch===generation)return publish({version:VERSION,state:'unavailable',routes:[],panels:[],message:'Native panel routes could not be verified.'});}
  },
  async openAssistantOutput(output){const epoch=generation;const panel=await host.assistantOutput(output);if(epoch===generation&&panel?.state==='ready')publish({...availability,resourceOpen:{ref:panel.ref,revision:panel.revision,state:'server-authorized'}});return panel;},
  destroy(){generation++;host.destroy();publish({version:VERSION,state:'closed',routes:[],panels:[]});}
 };
}
