<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 export let companyId:string;
 const dispatch=createEventDispatcher();
 let rows:any[]=[];
 let loading=true;
 let uploading=false;
 let query='';
 let error='';
 let upload:HTMLInputElement;
 const controller=new AbortController();
 const token=localStorage.token||'';
 const company=companyId;
 $: visible=rows.filter(row=>['file','knowledge'].includes(row.kind)&&row.title.toLowerCase().includes(query.toLowerCase()));
 function fresh(){if(controller.signal.aborted||token!==localStorage.token||companyId!==company)throw Error('Your workspace changed. Reopen company files.');}
 async function request(path:string,options:RequestInit={}){
  fresh();
  const response=await fetch(path,{...options,signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{})}});
  fresh();
  if(!response.ok)throw Error(response.status===403||response.status===404?'Company files are unavailable.':response.status===507?'Company storage is full.':'The file request could not be completed.');
  const body=await response.json();
  if(body.contract!=='starli.company-drive.v2')throw Error('The file service response could not be verified.');
  return body.data;
 }
 async function load(){
  loading=true;error='';
  try{
   const items=await request('/api/v1/companies/'+encodeURIComponent(company)+'/drive?recent=1');
   if(!Array.isArray(items)||items.some(row=>row.company!==company||typeof row.id!=='string'||typeof row.title!=='string'))throw Error('The company file list could not be verified.');
   rows=items;
  }catch(cause){if(!controller.signal.aborted)error=(cause as Error).message;}finally{loading=false;}
 }
 function open(row:any){
  if(row.company!==company||!['file','knowledge'].includes(row.kind))return;
  dispatch('open',{scope:'company',ownerId:company,kind:row.kind,id:row.id});
 }
 async function addFile(event:Event){
  const file=(event.currentTarget as HTMLInputElement).files?.[0];
  if(!file)return;
  if(file.size>16*1024*1024){error='Choose a file smaller than 16 MiB.';return;}
  uploading=true;error='';
  try{
   const bytes=new Uint8Array(await file.arrayBuffer());
   let binary='';
   for(let start=0;start<bytes.length;start+=8192)binary+=String.fromCharCode(...bytes.subarray(start,start+8192));
   const code=/\.(txt|md|js|mjs|cjs|jsx|ts|tsx|xml|svg|xsl|xsd|json|css|html|csv|yaml|yml|py|sql)$/i.test(file.name);
   const item=await request('/api/v1/companies/'+encodeURIComponent(company)+'/drive/items',{method:'POST',body:JSON.stringify({title:file.name,kind:'file',data:btoa(binary),mime:code?'text/plain':file.type||'application/octet-stream'})});
   if(item.company!==company||item.kind!=='file')throw Error('The uploaded file could not be verified.');
   open(item);
  }catch(cause){if(!controller.signal.aborted)error=(cause as Error).message;}finally{uploading=false;if(upload)upload.value='';}
 }
 onMount(()=>void load());
 onDestroy(()=>{controller.abort();rows=[];});
</script>
<section class="files" aria-label="Company files">
 <header><h2>Company files</h2><button type="button" class="close" aria-label="Close files" on:click={()=>dispatch('close')}>×</button></header>
 <input class="search" aria-label="Search company files" placeholder="Search files…" bind:value={query}/>
 <div class="list">
  {#if loading}<p role="status">Loading company files…</p>
  {:else if error}<p class="error" role="alert">{error}</p>
  {:else}{#each visible as row(row.id)}<button type="button" class="file" on:click={()=>open(row)}><span class="file-icon">▤</span><span><strong>{row.title}</strong><small>{row.kind==='knowledge'?'Document':'File'} · Version {row.version}</small></span></button>{:else}<p>{query?'No matching files.':'Your company has no accessible files yet.'}</p>{/each}{/if}
 </div>
 <footer><input bind:this={upload} type="file" hidden on:change={addFile}/><button class="upload" type="button" disabled={uploading} on:click={()=>upload.click()}>{uploading?'Uploading…':'Upload a file'}</button></footer>
</section>
<style>
 .files{position:absolute;bottom:calc(100% + 12px);left:0;width:min(380px,calc(100vw - 40px));background:#fff;border:1px solid #e3e9f2;border-radius:14px;box-shadow:0 12px 40px #172b4d15;z-index:20;color:#24324b}
 header{display:flex;align-items:center;justify-content:space-between;padding:17px 18px 10px}h2{font-size:14px;font-weight:600;margin:0}.close{background:none;border:0;color:#748199;font-size:22px}
 .search{width:calc(100% - 32px);margin:0 16px 10px;padding:9px 11px;border:1px solid #e3e9f2;border-radius:8px;font:inherit;font-size:12px}.list{max-height:280px;overflow:auto;padding:0 8px 8px}.file{display:flex;gap:10px;align-items:center;width:100%;padding:11px 10px;text-align:left;background:none;border:0;border-radius:8px;color:inherit}.file:hover{background:#f4f7fc}.file strong{font-size:12px;font-weight:500;display:block}.file small{font-size:10px;color:#8894a7}.file-icon{color:#6589c7;font-size:20px}p{padding:12px;font-size:12px;color:#7d899d}.error{color:#af4141}footer{padding:12px 16px;border-top:1px solid #edf0f5}.upload{font:inherit;font-size:12px;color:#245ed9;background:#edf3ff;border:0;border-radius:8px;padding:9px 13px}button{cursor:pointer}button:disabled{opacity:.5}
</style>
