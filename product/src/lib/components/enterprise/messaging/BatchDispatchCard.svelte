<script lang="ts">
 export let items:any[]=[];export let bots:any[]=[];export let settled=false;
 const labels:Record<string,string>={QUEUED:'Queued',SUBMITTED:'Running',ANSWERED:'Answered',FAILED:'Failed',CANCELLED:'Cancelled',DENIED:'Not permitted',UNKNOWN:'Outcome unconfirmed',INTERRUPTED:'Interrupted'};
</script>
<section class="batch" aria-label="Bot replies" aria-live="polite"><strong>{settled?'Bot reply results':'Bot reply queue'}</strong><div>{#each items as item(item.agentId)}<p><span>{bots.find(bot=>bot.id===item.agentId)?.name||'Bot'}</span><small class:failed={['FAILED','DENIED','UNKNOWN','INTERRUPTED'].includes(item.status)}>{labels[item.status]||'Status unconfirmed'}</small></p>{/each}</div></section>
<style>.batch{white-space:normal;border:1px solid #dfe7f2;border-radius:10px;padding:12px 14px;margin-top:12px;background:#f8faff;font-size:12px;color:#334e75;min-width:230px}.batch strong{font-size:11px;font-weight:650}.batch p{display:flex;justify-content:space-between;gap:20px;margin:8px 0 0}.batch small{font-size:10px;color:#526780;background:#eaf1ff;border-radius:5px;padding:2px 6px}.batch small.failed{color:#9f1239;background:#fff1f3}</style>
