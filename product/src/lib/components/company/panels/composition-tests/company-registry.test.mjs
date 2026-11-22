import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildCompanyPanelRegistry,loadCompanyPanelRegistry} from '../company-registry.mjs';
const version='starli.panel.v1';const manifest=(type,kind)=>({version,type,resourceKinds:[kind],scopes:['company']});
test('peer editor replaces preview once, and missing email stays unavailable',()=>{
 const result=buildCompanyPanelRegistry({request:async()=>{},nativeManifestEnvelope:{version,manifests:[manifest('resource.sheet','sheet'),manifest('resource.document','knowledge')]}});
 assert.deepEqual(result.availability.map(p=>p.type),['resource.document','resource.sheet']);assert.equal(result.registry.get('resource.sheet').manifest.editable,true);assert.throws(()=>result.registry.get('resource.email'));
});
test('HTTP 200 SPA fallback is never accepted as a mounted native service',async()=>{
 await assert.rejects(loadCompanyPanelRegistry({companyId:'c',request:async()=>new Response('<html>app</html>',{status:200,headers:{'Content-Type':'text/html'}})}),/unavailable/);
});
test('native route availability, scope and kind are validated before registration',async()=>{
 assert.throws(()=>buildCompanyPanelRegistry({request:async()=>{},nativeManifestEnvelope:{version:'bad',manifests:[]}}));
 const result=buildCompanyPanelRegistry({request:async()=>{},nativeManifestEnvelope:{version,manifests:[manifest('resource.email','file'),{...manifest('resource.sheet','sheet'),scopes:['personal']} ]}});assert.equal(result.availability.length,0);
 await assert.rejects(loadCompanyPanelRegistry({companyId:'c',request:async()=>new Response(null,{status:401})}));
});
