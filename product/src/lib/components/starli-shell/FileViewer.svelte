<script lang="ts">
 import {onDestroy} from 'svelte';
 export let blob:Blob;
 export let name:string;
 let url='',text='',previous:Blob,epoch=0;
 function clear(){epoch++;if(url)URL.revokeObjectURL(url);url='';text='';}
 async function display(b:Blob){clear();if(!b)return;const n=epoch;if(b.type.startsWith('text/')||b.type==='application/json'){const t=await b.slice(0,1048576).text();if(n===epoch)text=t;}else url=URL.createObjectURL(b);}
 $: if(blob!==previous){previous=blob;void display(blob);}
 onDestroy(clear);
</script>
<section aria-label={'Viewing '+name}><h3>{name}</h3>{#if blob&&['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(blob.type)}<img src={url} alt={name}/>{:else if blob?.type==='application/pdf'}<iframe sandbox="" title={name} src={url}></iframe>{:else if blob?.type.startsWith('text/')||blob?.type==='application/json'}<pre>{text}</pre>{#if blob.size>1048576}<p>Showing the first 1 MB.</p>{/if}{:else}<p>Preview unavailable for this file type.</p>{/if}</section>
<style>section{min-width:0;overflow:auto;padding:12px}h3{font-weight:630;margin-bottom:10px}img{max-width:100%;max-height:68dvh;object-fit:contain;margin:auto}iframe{height:65dvh;width:100%;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}</style>
