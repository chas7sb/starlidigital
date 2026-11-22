<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 import {marked} from 'marked';
 import DOMPurify from 'dompurify';
 import CodeFileEditor from '../editors/CodeFileEditor.svelte';
 export let companyId:string;
 export let resource:{scope:'company';ownerId:string;kind:'file'|'knowledge'|'project';id:string};
 export let accessSignal:AbortSignal;
 const dispatch=createEventDispatcher();
 const controller=new AbortController();
 const token=localStorage.token||'';
 const company=companyId;
 const ref={...resource};
 let title='',body='',baseTitle='',baseBody='',revision=0,mime='',blobUrl='',error='',notice='';
 let codeDirty=false;
 let loading=true,saving=false,editing=false,conflict=false,canEdit=false;
 let timer:ReturnType<typeof setInterval>;
 let checking=false;
 let root:HTMLElement;
 $: dirty=title!==baseTitle||body!==baseBody;
 $: dispatch('dirty',{dirty:dirty||codeDirty});
 $: html=DOMPurify.sanitize(marked.parse(body,{async:false}) as string,{FORBID_TAGS:['img','iframe','object','embed','script','style','form','input','button']});
 $: specialized=ref.kind==='file'&&(/\.pdf$/i.test(title)||/^image\//.test(mime));
 function fresh(){if(controller.signal.aborted||accessSignal?.aborted||token!==localStorage.token||company!==companyId)throw Error('Workspace access changed.');}
 function clear(){controller.abort();title='';body='';baseTitle='';baseBody='';if(blobUrl)URL.revokeObjectURL(blobUrl);blobUrl='';dispatch('revoked');}
 async function request(suffix:string,options:RequestInit={}){
  fresh();
  const response=await fetch('/api/v1/'+suffix,{...options,signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})}});
  fresh();
  if(!response.ok){
   if([401,403,404].includes(response.status)){clear();throw Error('File access changed.');}
   if(response.status===409){conflict=true;throw Error('A newer revision exists. Your unsaved changes are kept.');}
   throw Error('The document service could not complete this request.');
  }
  return response;
 }
 async function snapshot(){
  const data=await(await request('panels/company/'+encodeURIComponent(company)+'/'+ref.kind+'/'+encodeURIComponent(ref.id)+'/snapshot')).json();
  if(data.ownerId!==company||data.scope!=='company'||data.ref?.id!==ref.id||data.ref?.kind!==ref.kind||data.value?.company!==company||!Number.isSafeInteger(data.revision))throw Error('The document scope could not be verified.');
  return data;
 }
 async function load(){
  loading=true;error='';notice='';
  try{
   const data=await snapshot();
   title=baseTitle=data.value.title||'Untitled';
   body=baseBody=data.value.body||'';
   revision=data.revision;
   mime=data.value.mime||'';
   const authority=await(await request('companies/'+encodeURIComponent(company)+'/capabilities')).json();
   canEdit=authority.company_id===company&&authority.capabilities?.includes('files.manage')===true;
   if(ref.kind==='file'&&(/\.pdf$/i.test(title)||/^image\//.test(mime))){
    const content=await request('companies/'+encodeURIComponent(company)+'/drive/'+encodeURIComponent(ref.id)+'/content?version='+revision);
    mime=(content.headers.get('Content-Type')||'application/octet-stream').split(';')[0];
    if(mime!=='application/pdf'&&!['image/png','image/jpeg','image/webp'].includes(mime))throw Error('This file requires a different viewer.');
    const blob=await content.blob();fresh();
    if(blobUrl)URL.revokeObjectURL(blobUrl);
    blobUrl=URL.createObjectURL(blob);
   }
   conflict=false;
  }catch(cause){if(!controller.signal.aborted)error=(cause as Error).message;}finally{loading=false;}
 }
 async function watch(){
  if(checking||saving||controller.signal.aborted||document.hidden)return;
  checking=true;
  try{
   const data=await snapshot();
   if(data.revision!==revision){
    if(dirty){conflict=true;notice='A newer saved revision is available.';}
    else await load();
   }
  }catch(cause){if(!controller.signal.aborted)error=(cause as Error).message;}finally{checking=false;}
 }
 async function save(){
  if(saving||!dirty||conflict||!canEdit||ref.kind!=='knowledge')return;
  saving=true;error='';
  const savedTitle=title,savedBody=body;
  try{
   const result=await(await request('companies/'+encodeURIComponent(company)+'/drive/'+encodeURIComponent(ref.id)+'/document',{method:'POST',body:JSON.stringify({version:revision,title:savedTitle,body:savedBody})})).json();
   if(result.contract!=='starli.company-drive.v2'||result.data?.company!==company||result.data?.id!==ref.id||result.data.version!==revision+1)throw Error('The saved revision could not be verified.');
   revision=result.data.version;baseTitle=savedTitle;baseBody=savedBody;notice='Saved';editing=false;
  }catch(cause){if(!controller.signal.aborted)error=(cause as Error).message;}finally{saving=false;}
 }
 function shortcut(event:KeyboardEvent){
  if(root?.contains(event.target as Node)&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){
   if(ref.kind==='knowledge'){event.preventDefault();void save();}
  }
 }
 function reload(){if((dirty||codeDirty)&&!confirm('Discard unsaved edits and load the latest revision?'))return;void load();}
 function close(){if(dirty&&!confirm('Close this document and discard unsaved edits?'))return;dispatch('close');}
 onMount(()=>{
  if(ref.scope!=='company'||ref.ownerId!==company){clear();return;}
  accessSignal?.addEventListener('abort',clear,{once:true});
  window.addEventListener('keydown',shortcut);
  const changed=(event:StorageEvent)=>{if(event.key==='token'||event.key===null)clear();};
  window.addEventListener('storage',changed);
  void load();timer=setInterval(()=>void watch(),2500);
  return()=>{window.removeEventListener('keydown',shortcut);window.removeEventListener('storage',changed);accessSignal?.removeEventListener('abort',clear);};
 });
 onDestroy(()=>{controller.abort();clearInterval(timer);if(blobUrl)URL.revokeObjectURL(blobUrl);body='';baseBody='';});
</script>
<aside class="file-pane" bind:this={root} aria-label="Document workspace">
 <header><div class="identity"><span class="file-symbol">▤</span><span>{title||'Opening document…'}</span></div><div class="actions">
  {#if notice}<span class="notice" role="status">{notice}</span>{/if}
  {#if ref.kind==='knowledge'&&canEdit}<button type="button" disabled={loading||saving} on:click={()=>editing=!editing}>{editing?'Preview':'Edit'}</button><button class="save" type="button" disabled={!dirty||saving||conflict} on:click={save}>{saving?'Saving…':'Save'}</button>{/if}
  {#if blobUrl}<a href={blobUrl} download={title} aria-label="Download document">↓</a>{/if}
  <button type="button" aria-label="Close document" on:click={close}>×</button>
 </div></header>
 <div class="content">
  {#if loading}<p class="state" role="status">Opening the current revision…</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else if ref.kind==='file'&&!specialized}<CodeFileEditor resource={{...ref,kind:'file'}} {companyId} {accessSignal} on:dirty={event=>codeDirty=event.detail.dirty} on:revoked={clear}/>
  {:else if specialized&&blobUrl}
   {#if mime.startsWith('image/')}<img class="image" src={blobUrl} alt={title}/>{:else}<iframe class="pdf" src={blobUrl} title={title}/>{/if}
  {:else if editing}
   <div class="document-edit"><input aria-label="Document title" bind:value={title}/><textarea aria-label="Document body" bind:value={body}/><p>Ctrl / ⌘ S to save</p></div>
  {:else}
   <article class="document"><div class="revision">Version {revision}</div><h1>{title}</h1><div class="document-body">{@html html}</div></article>
  {/if}
  {#if conflict}<div class="conflict" role="alert">This document changed elsewhere. Your edits are kept.<button type="button" on:click={reload}>Load latest revision</button></div>{/if}
 </div>
</aside>
<style>
 .file-pane{width:clamp(360px,43vw,740px);height:100dvh;flex:none;background:#fff;border-left:1px solid #e7edf6;display:flex;flex-direction:column;color:#23324e;font-family:inherit}
 header{height:72px;flex:none;border-bottom:1px solid #edf1f7;padding:0 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}.identity{display:flex;gap:10px;align-items:center;min-width:0;font-size:12px}.identity>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-symbol{color:#8494b1;font-size:17px}.actions{display:flex;gap:9px;align-items:center;flex:none}.actions button,.actions a{color:#6c7f9f;border:0;background:none;font:inherit;font-size:11px;cursor:pointer;padding:5px;text-decoration:none}.actions .save{color:#326af2}.actions button:disabled{opacity:.35}.notice{font-size:10px;color:#2d9c80}.content{flex:1;min-height:0;overflow:auto;position:relative}.document{padding:42px 36px 60px}.revision{font-size:10px;color:#8190a8;margin-bottom:22px}h1{font-size:27px;line-height:1.4;font-weight:500;letter-spacing:-.6px;margin:0 0 36px}.document-body{font-size:13px;line-height:1.9;color:#687a98;overflow-wrap:anywhere}.document-body :global(h2){font-size:16px;font-weight:500;color:#26395d;margin:28px 0 12px}.document-body :global(h3){font-size:14px;font-weight:500;color:#344767;margin:22px 0 9px}.document-body :global(p){margin:0 0 14px}.document-body :global(pre){background:#f5f7fa;padding:14px;border-radius:9px;overflow:auto}.document-body :global(table){width:100%;border-collapse:collapse}.document-body :global(td),.document-body :global(th){padding:8px;border-bottom:1px solid #e8edf4;text-align:left}.document-edit{height:100%;display:flex;flex-direction:column;padding:26px;gap:18px}.document-edit input{font:inherit;font-size:22px;border:0;border-bottom:1px solid #edf1f7;padding:10px 0;color:inherit;outline:none}.document-edit textarea{font:inherit;font-size:13px;line-height:1.8;flex:1;min-height:300px;resize:none;border:0;outline:none;color:#536985}.document-edit p{font-size:10px;color:#96a2b6}.pdf{border:0;width:100%;height:100%}.image{max-width:100%;height:auto;display:block;margin:20px auto}.state,.error{padding:28px;font-size:12px;color:#7e8ca5}.error{color:#a74040}.conflict{position:sticky;bottom:0;background:#fff7e8;padding:15px;font-size:12px;color:#916d32}.conflict button{display:block;background:none;border:0;color:#3067df;padding:8px 0;cursor:pointer}@media(max-width:800px){.file-pane{position:fixed;inset:0;width:100%;z-index:50}.document{padding:30px 24px}}
</style>
