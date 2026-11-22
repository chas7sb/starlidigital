<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {CompanyClient} from '$lib/utils/company-workspace';
 import {companyPanels,type CompanyPanelId} from './panels';
 import CompanyRoles from './CompanyRoles.svelte';
 export let companyId:string;
 export let rolesAvailable=false;
 let client:CompanyClient,bindings:any={},selected:CompanyPanelId='people',data:any=null,error='',busy=false,alive=true;
 $: visiblePanels=companyPanels.filter(p=>p.id==='people'?rolesAvailable:bindings[p.id]?.available===true);
 let name='',definition='{\n  "name": "",\n  "description": "",\n  "operations": []\n}',notice='';
 async function load(){try{const d=await client.request('/panels');if(!alive)return;if(d.version!=='starli.company.panels.v1')throw Error('Company panel registry is unavailable.');bindings=d.panels;await choose(selected);}catch{if(alive){bindings={};data=null;}}}
 async function choose(id:CompanyPanelId){selected=id;data=null;notice='';error='';const path=bindings[id]?.readPath;if(!path)return;try{const d=await client.request(path);if(alive&&selected===id)data=d;}catch(e){if(alive&&selected===id)error=(e as Error).message;}}
 async function saveIntegration(){const b=bindings.integrations;if(b?.capabilities?.author!==true||!b.authorPath||busy)return;busy=true;try{const parsed=JSON.parse(definition);await client.request(b.authorPath,'POST',{name,definition:parsed},crypto.randomUUID());if(alive)notice='Integration draft saved. Review its permissions before use.';}catch(e){if(alive)error=e instanceof SyntaxError?'Definition must be valid JSON.':(e as Error).message;}finally{if(alive)busy=false;}}
 onMount(()=>{client=new CompanyClient(companyId,()=>localStorage.token||'');void load();});onDestroy(()=>{alive=false;client?.close();definition='';data=null;});
</script>
<section class="company-tools" aria-label="Company apps and administration"><h2>Company</h2>{#if visiblePanels.length>1}<div class="panels">{#each visiblePanels as panel}<button class:selected={selected===panel.id} on:click={()=>choose(panel.id)}><strong>{panel.name}</strong><small>{panel.description}</small></button>{/each}</div>{/if}
 {#if selected==='people'&&rolesAvailable}<CompanyRoles {companyId}/>{:else if data}<p>{data.summary||''}</p>{#if selected==='domains'}<p>{data.zoneName||'No authorized zone returned.'}</p><dl>{#each data.records||[] as record}<div><dt>{record.type} · {record.name}</dt><dd>{record.content} · TTL {record.ttl}</dd></div>{/each}</dl>{#if bindings.domains?.capabilities?.manage!==true}<p>Read-only zone access.</p>{/if}
 {:else}{#each data.items||[] as item}<article><strong>{item.name||item.title}</strong><p>{item.description||item.role||''}</p></article>{/each}{/if}
 {:else}<p>No company apps are connected.</p>{/if}
 {#if selected==='integrations'}<details><summary>Author an integration draft</summary><p>Your draft is separate from shared company connections. Publishing or executing requires the returned server capabilities.</p><label>Integration name<input bind:value={name}/></label><label>Structured definition<textarea rows="9" bind:value={definition}/></label><button class="sd-button" disabled={busy||!name.trim()||bindings.integrations?.capabilities?.author!==true} on:click={saveIntegration}>Save integration draft</button></details>{/if}
 {#if notice}<p role="status">{notice}</p>{/if}{#if error}<p role="status">{error}</p>{/if}
</section>
<style>h2,h3{font-weight:700}h3{margin-top:18px}.panels{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:12px 0}.panels button{display:flex;flex-direction:column;text-align:left;gap:6px;padding:12px;border:1px solid var(--sd-line);border-radius:12px}.selected{background:var(--sd-selected)}small,p,dt,dd{font-size:12px;color:var(--sd-muted)}label{display:block;margin:10px 0}textarea,input{width:100%;border:1px solid var(--sd-line);background:var(--sd-card);border-radius:8px;padding:10px;color:inherit}article,dl div{padding:12px;border-bottom:1px solid var(--sd-line);overflow-wrap:anywhere}details{margin-top:16px}summary{cursor:pointer}</style>
