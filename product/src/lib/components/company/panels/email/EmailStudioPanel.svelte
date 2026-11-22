<script>
 import {onDestroy} from 'svelte';
 export let panel;
 export let host;
 let selected='',busy=false,error='',notice='';
 const clone=value=>JSON.parse(JSON.stringify(value));
 $: saved=panel.data;
 $: draft=panel.draft?.document||(panel.draft?.schema==='starli.email/1'?panel.draft:null);
 $: document=draft||saved;
 $: dirty=!!panel.draft;
 $: conflict=dirty&&panel.draft.expectedRevision!==panel.revision;
 $: if(document?.blocks?.length&&!document.blocks.some(b=>b.id===selected))selected=document.blocks[0].id;
 $: block=document?.blocks?.find(b=>b.id===selected);
 $: prefix='email-'+encodeURIComponent(panel.key);
 $: unavailable=panel.state!=='ready'||panel.abort?.signal.aborted;
 function update(change){if(busy||unavailable||conflict)return;const next=clone(document);change(next);host.draft(panel.key,{document:next,expectedRevision:dirty?panel.draft.expectedRevision:panel.revision});error='';notice='Unsaved changes';}
 function field(key,value){update(next=>next[key]=value);}
 function recipients(key,value){field(key,value.split(/[,\n]/).map(v=>v.trim()).filter(Boolean));}
 function sectionField(key,value){update(next=>next.blocks.find(b=>b.id===selected)[key]=value);}
 function discard(){host.draft(panel.key,null);error='';notice='Showing the latest saved version.';}
 async function save(){
  if(!dirty||conflict||busy||unavailable)return;
  if(!document.subject.trim()||!document.to.length){error='Add a subject and at least one recipient.';return;}
  busy=true;error='';notice='Saving…';
  try{await host.edit(panel.key,clone(document));if(!panel.abort?.signal.aborted)notice='Version saved.';}
  catch(e){if(!panel.abort?.signal.aborted)error=e.status===409?'This email changed. Your edits are kept. Load the latest version before saving.':e.status===403?'You no longer have access to this email.':e.message||'Could not save this email.';}
  finally{busy=false;}
 }
 onDestroy(()=>{selected='';error='';notice='';});
</script>

<section class="email-native w-full min-w-0 text-sm text-gray-900 dark:text-gray-100" aria-label="Email Studio" aria-busy={busy}>
 {#if document?.schema==='starli.email/1'}
  <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
   <div><h2 class="text-base font-semibold">Email Studio</h2><p class="mt-1 text-xs text-gray-500 dark:text-gray-400">Version {panel.revision}{dirty?' · Unsaved changes':''}</p></div>
   <div class="flex flex-wrap gap-2"><button type="button" class="secondary" disabled={!dirty||busy||unavailable} on:click={discard}>Load latest saved version</button><button type="button" class="primary" disabled={!dirty||conflict||busy||unavailable} on:click={save}>{busy?'Saving…':'Save version'}</button></div>
  </header>
  {#if conflict}<p class="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" role="alert">A newer version is available. Your edits are kept. Load the latest saved version before editing again.</p>{/if}
  <fieldset disabled={busy||unavailable||conflict} class="m-0 min-w-0 border-0 p-0">
   <legend class="sr-only">Email details and content</legend>
   <div class="details-grid">
    <div class="wide"><label for={prefix+'-to'}>To</label><input id={prefix+'-to'} type="text" inputmode="email" autocomplete="off" value={document.to.join(', ')} on:change={e=>recipients('to',e.currentTarget.value)} aria-describedby={prefix+'-recipient-help'}/><p id={prefix+'-recipient-help'} class="help">Separate email addresses with commas.</p></div>
    <div><label for={prefix+'-cc'}>Cc</label><input id={prefix+'-cc'} type="text" inputmode="email" autocomplete="off" value={document.cc.join(', ')} on:change={e=>recipients('cc',e.currentTarget.value)}/></div>
    <div><label for={prefix+'-bcc'}>Bcc</label><input id={prefix+'-bcc'} type="text" inputmode="email" autocomplete="off" value={document.bcc.join(', ')} on:change={e=>recipients('bcc',e.currentTarget.value)}/></div>
    <div class="wide"><label for={prefix+'-subject'}>Subject</label><input id={prefix+'-subject'} maxlength="300" value={document.subject} on:input={e=>field('subject',e.currentTarget.value)}/></div>
    <div class="wide"><label for={prefix+'-preheader'}>Preview text</label><input id={prefix+'-preheader'} maxlength="500" value={document.preheader} on:input={e=>field('preheader',e.currentTarget.value)} aria-describedby={prefix+'-preview-help'}/><p id={prefix+'-preview-help'} class="help">The short summary shown beside the subject in an inbox.</p></div>
   </div>
   <div class="content-grid mt-5 border-t border-gray-200 pt-5 dark:border-gray-800">
    <nav aria-label="Email sections"><h3 class="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Sections</h3><ul class="m-0 space-y-1 p-0" style="list-style:none">
     {#each document.blocks as item,index(item.id)}<li><button type="button" class="section-button" class:selected={selected===item.id} aria-pressed={selected===item.id} aria-controls={prefix+'-section-editor'} on:click={()=>selected=item.id}><span class="text-xs text-gray-500 dark:text-gray-400">{index+1}</span><span class="min-w-0 truncate">{item.type==='button'?'Call to action':item.type==='image'?'Image':item.type==='divider'?'Divider':item.type==='signature'?'Signature':item.type==='heading'?'Heading':'Text'}</span></button></li>{/each}
    </ul></nav>
    <div id={prefix+'-section-editor'} class="min-w-0" aria-label="Selected section">
     {#if block}<h3 class="mb-3 text-sm font-medium">{block.type==='button'?'Call to action':block.type==='image'?'Image':block.type==='signature'?'Signature':block.type==='heading'?'Heading':block.type==='divider'?'Divider':'Text'}</h3>
      {#if 'text' in block}<label for={prefix+'-text'}>{block.type==='button'?'Button label':'Content'}</label><textarea id={prefix+'-text'} rows={block.type==='heading'||block.type==='button'?2:7} maxlength="8000" value={block.text} on:input={e=>sectionField('text',e.currentTarget.value)}></textarea>{/if}
      {#if block.type==='button'}<label class="mt-4" for={prefix+'-href'}>Button destination</label><input id={prefix+'-href'} type="url" value={block.href} on:input={e=>sectionField('href',e.currentTarget.value)} aria-describedby={prefix+'-link-help'}/><p id={prefix+'-link-help'} class="help">Use a secure https:// link.</p>{/if}
      {#if block.type==='image'}<label for={prefix+'-alt'}>Image description</label><textarea id={prefix+'-alt'} rows="3" maxlength="500" value={block.alt} on:input={e=>sectionField('alt',e.currentTarget.value)} aria-describedby={prefix+'-alt-help'}></textarea><p id={prefix+'-alt-help'} class="help">Describe the image for screen readers and people reading with images turned off.</p><p class="mt-4 text-xs text-gray-500 dark:text-gray-400">Saved company image retained.</p>{/if}
      {#if block.type==='divider'}<p class="text-gray-500 dark:text-gray-400">A divider separates the surrounding sections.</p>{/if}
     {/if}
    </div>
   </div>
  </fieldset>
  <footer class="mt-5 border-t border-gray-200 pt-4 dark:border-gray-800"><p class="text-xs text-gray-500 dark:text-gray-400">{document.attachments.length} attachment{document.attachments.length===1?'':'s'} · Sending requires a separate review and approval.</p></footer>
 {:else}<p role="status" class="text-gray-500 dark:text-gray-400">Email content is unavailable.</p>{/if}
 {#if error}<p class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>{/if}
 <p class="mt-3 text-xs text-gray-500 dark:text-gray-400" role="status" aria-live="polite" aria-atomic="true">{notice}</p>
</section>

<style>
 .email-native{font-family:inherit;line-height:1.5}.details-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.wide{grid-column:1/-1}.content-grid{display:grid;grid-template-columns:minmax(8rem,11rem) minmax(0,1fr);gap:1.25rem}label{display:block;font-size:.8125rem;font-weight:500;margin-bottom:.375rem}input,textarea{display:block;width:100%;box-sizing:border-box;background:transparent;color:inherit;border:1px solid rgb(229 231 235);border-radius:.75rem;padding:.625rem .75rem;font:inherit;outline:none}textarea{resize:vertical;min-height:3rem}input:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid #64748b;outline-offset:3px}.help{margin-top:.375rem;font-size:.75rem;color:#6b7280}button{font:inherit;cursor:pointer;min-height:2.5rem;border-radius:.75rem;padding:.5rem .75rem}button:disabled{opacity:.5;cursor:default}.secondary{background:transparent;color:inherit;border:1px solid #d1d5db}.primary{background:#111827;color:white;border:1px solid #111827}.section-button{display:flex;align-items:center;gap:.625rem;width:100%;text-align:left;background:transparent;color:inherit;border:1px solid transparent}.section-button:hover{background:rgb(156 163 175 / .1)}.section-button.selected{background:rgb(156 163 175 / .15);border-color:rgb(156 163 175 / .5)}:global(.dark) .email-native input,:global(.dark) .email-native textarea,:global(.dark) .email-native .secondary{border-color:#374151}:global(.dark) .email-native .help{color:#9ca3af}:global(.dark) .email-native .primary{background:#f3f4f6;color:#111827;border-color:#f3f4f6}@media(max-width:600px){.details-grid,.content-grid{grid-template-columns:minmax(0,1fr)}.wide{grid-column:auto}}
</style>
