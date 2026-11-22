<script>
 import {onMount} from 'svelte';
 export let panel;export let host;export let approval=null;
 let state=null,busy=false,error='',uncertain=false,epoch=0,seen=0;
 const supported=name=>typeof host.emailRequest==='function'&&host.emailCapabilities?.includes(name);
 $: currentDelivery=state?.deliveries?.find(d=>d.revision===panel.revision);
 $: canSend=supported('controlled-send')&&supported('controlled-state')&&!busy&&!uncertain&&!panel.draft&&!currentDelivery&&approval?.approvalId&&approval.revision===panel.revision;
 async function refresh(){if(!supported('controlled-state')||busy)return;const version=++epoch;busy=true;error='';try{const result=await host.emailRequest(panel.ref.id,'controlled-state',{});if(version!==epoch||panel.abort.signal.aborted)return;state=result;if(result.deliveries.length)uncertain=false;}catch(e){error=e.message;}finally{busy=false;}}
 async function send(){if(!canSend)return;const version=++epoch;busy=true;error='';try{const result=await host.emailRequest(panel.ref.id,'controlled-send',{expectedRevision:panel.revision,approvalId:approval.approvalId});if(version!==epoch||panel.abort.signal.aborted)return;state={...state,deliveries:[...(state?.deliveries||[]),{...result,revision:panel.revision}]};}catch(e){uncertain=true;error=e.status===409?'Email changed. Review the latest version.':'Delivery outcome is uncertain. Check delivery status before continuing.';}finally{busy=false;}await refresh();}
 $: if(seen&&seen!==panel.revision){seen=panel.revision;void refresh();}
 onMount(()=>{seen=panel.revision;void refresh();});
</script>
{#if supported('controlled-state')}
 <section class="controlled" aria-label="Controlled test delivery" aria-busy={busy}>
  <h3>Controlled test mailbox</h3><p>This isolated action sends only the reviewed message to the server-configured synthetic SMTP sink.</p>
  {#if supported('controlled-send')}<button disabled={!canSend} on:click={send}>Send approved version to test mailbox</button>{/if}
  <button disabled={busy} on:click={refresh}>Check delivery status</button>
  {#if !approval&&!currentDelivery}<p>Review and approve the saved version first.</p>{/if}
  {#if currentDelivery}<p role="status">Version {currentDelivery.revision}: {currentDelivery.status||currentDelivery.state}. Operation {currentDelivery.operationId}</p>{/if}
  {#if state?.sent?.length}<h4>Sent</h4><ul>{#each state.sent as message(message.id)}<li>{message.subject} · {message.status} · {message.attachmentCount} attachment{message.attachmentCount===1?'':'s'}</li>{/each}</ul>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
 </section>
{/if}
<style>.controlled{margin-top:1rem;padding:1rem;border:1px solid #d1d5db;border-radius:1rem;font-size:.875rem}h3,h4{font-weight:600}p{margin:.6rem 0;overflow-wrap:anywhere}button{font:inherit;margin:.3rem .5rem .3rem 0;padding:.6rem .85rem;border:1px solid #cbd5e1;border-radius:.75rem;background:transparent;cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid #64748b;outline-offset:3px}[role=alert]{color:#b91c1c}</style>
