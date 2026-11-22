<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';import {GraphClient,GraphError,type Graph} from './graph-client';import './automations.css';
 export let companyId:string;export let actorId:string;export let conversationId:string;export let graphId:string;export let accessSignal:AbortSignal;
 const dispatch=createEventDispatcher<{close:void;denied:{status:number}}>();
 let mounted=false,key='',watched:AbortSignal|undefined,client:GraphClient|undefined,graph:Graph|null=null,generation=0,busy=false,error='',confirmed=false,session='',timer:ReturnType<typeof setTimeout>|undefined;
 $: if(mounted&&(key!==[companyId,actorId,conversationId,graphId].join('\0')||watched!==accessSignal)){reset();key=[companyId,actorId,conversationId,graphId].join('\0');watched=accessSignal;watched.addEventListener('abort',lost,{once:true});if(watched.aborted)lost();else{session=localStorage.getItem('token')||'';client=new GraphClient(companyId,conversationId,graphId,()=>localStorage.getItem('token')||'',watched);void load();}}
 function reset(){generation++;clearTimeout(timer);client?.close();client=undefined;watched?.removeEventListener('abort',lost);graph=null;confirmed=false;busy=false;error='';}
 function lost(){reset();dispatch('close');}
 function fail(e:unknown){confirmed=false;if(e instanceof GraphError&&(e.status===401||e.status===403)){lost();dispatch('denied',{status:e.status});return;}error=e instanceof Error?e.message:'The saved workflow could not be checked.';}
 function schedule(){clearTimeout(timer);if(graph&&['RUNNING','VALIDATING'].includes(graph.state))timer=setTimeout(()=>void load(),2000);}
 async function load(){if(!client||busy)return;const c=client,n=generation;busy=true;error='';try{const next=await c.get();if(n!==generation)return;if(graph?.graphHash!==next.graphHash||graph?.revision!==next.revision)confirmed=false;graph=next;schedule();}catch(e){if(n===generation)fail(e);}finally{if(n===generation)busy=false;}}
 async function run(){if(!client||!graph||!confirmed||busy)return;const c=client,n=generation,review=graph;busy=true;confirmed=false;error='';try{const next=await c.run(review);if(n!==generation)return;graph=next;schedule();}catch(e){if(n===generation){fail(e);graph=null;}}finally{if(n===generation)busy=false;}}
 function sessionCheck(){if(client&&session!==(localStorage.getItem('token')||''))lost();}
 function storage(e:StorageEvent){if(e.key===null||e.key==='token')lost();}
 onMount(()=>{mounted=true;const interval=setInterval(sessionCheck,500);window.addEventListener('storage',storage);return()=>clearInterval(interval);});onDestroy(()=>{reset();window.removeEventListener('storage',storage);});
 const labels:Record<string,string>={DRAFT:'Awaiting bot validation',VALIDATING:'Validating workflow',VALIDATED:'Ready for your review',RUNNING:'Running',COMPLETED:'Completed',FAILED:'Failed',CANCELED:'Canceled',UNKNOWN:'Outcome uncertain'};
</script>
<section class="starli-automations graph-card" aria-label="Workflow review">
 <span class="sa-eyebrow">STARLI WORKFLOW</span><h3>{graph?labels[graph.state]:'Checking saved workflow…'}</h3>
 {#if error}<p class="sa-error" role="alert">{error}</p>{/if}
 {#if graph}
 <p class="sa-muted">This workflow belongs to this company and this conversation.</p>
 <ol>{#each graph.graph.nodes as node}<li><strong>{node.id}</strong><span>{node.type.split('.').pop()}</span><details><summary>Review parameters</summary><pre>{JSON.stringify(node.parameters,null,2)}</pre></details></li>{/each}</ol>
 {#if graph.graph.edges.length}<details><summary>Connections</summary><ul>{#each graph.graph.edges as edge}<li>{edge.from} → {edge.to}{edge.output?` · output ${edge.output}`:''}</li>{/each}</ul></details>{/if}
 {#if !graph.capabilities.externalConnectors}<p class="sa-muted">External account actions are not enabled for this workflow.</p>{/if}
 {#if !graph.capabilities.backgroundTriggers}<p class="sa-muted">Runs only after a separate one-time approval. No automatic trigger is active.</p>{/if}
 {#if graph.state==='VALIDATED'&&graph.actions.canRun}<label class="review"><input type="checkbox" bind:checked={confirmed} disabled={busy}/> I reviewed these steps and parameters and approve one run.</label><button class="sa-primary" disabled={!confirmed||busy} on:click={run}>Run once</button>{/if}
 {#if graph.state==='RUNNING'}<p role="status">Execution has started. Checking the saved result…</p>{:else if graph.state==='UNKNOWN'}<p role="status">The result is uncertain. Check the saved status before taking further action.</p>{:else if graph.state==='COMPLETED'}<p role="status">The workflow engine confirmed completion.</p>{/if}
 {/if}
 <button disabled={busy} on:click={()=>void load()}>Refresh status</button>
</section>
<style>.graph-card{max-width:740px;margin:12px 0;padding:20px;border:1px solid #e6ebf4;border-radius:12px;background:#fafbfd}.graph-card h3{margin:8px 0}.graph-card ol{padding-left:22px}.graph-card li{margin:10px 0}.graph-card li>span{display:block;color:#71809a;font-size:13px}.graph-card pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;background:#f6f8fc;padding:10px;font-size:12px}.graph-card details{margin:8px 0}.graph-card .review{display:flex;gap:10px;align-items:flex-start;margin:16px 0}.graph-card button{margin:8px 8px 0 0}@media(max-width:500px){.graph-card{padding:15px;max-width:100%;min-width:0}}</style>
