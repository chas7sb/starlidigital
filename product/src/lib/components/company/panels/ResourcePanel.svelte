<script lang="ts">
 import type {Panel,PanelHost} from './index.mjs';
 export let panel:Panel; export let host:PanelHost;
 let error='',saving=false;
 $: documentValue=(panel.data||{}) as {title?:string;body?:string};
 $: savedDraft=panel.draft as {document?:{title?:string;body?:string};expectedRevision?:number}|null;
 $: draftValue=(savedDraft?.document||panel.draft||documentValue) as {title?:string;body?:string};
 $: staleDraft=!!panel.draft&&savedDraft?.expectedRevision!==panel.revision;
 function change(field:string,value:string){host.draft(panel.key,{document:{title:draftValue.title||'',body:draftValue.body||'',[field]:value},expectedRevision:savedDraft?.expectedRevision??panel.revision});}
 $: rows=Array.isArray(panel.data)?panel.data:[];
 async function save(){if(saving||staleDraft)return;saving=true;try{await host.edit(panel.key,draftValue);error='';}catch(e){error=(e as Error).message;}finally{saving=false;}}
</script>
{#if panel.type==='resource.document'}
<form class="space-y-4" on:submit|preventDefault={save}>
 <label class="block text-sm font-medium text-gray-700 dark:text-gray-200">Title<input class="mt-1 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-700" maxlength="240" value={draftValue.title||''} on:input={e=>change('title',e.currentTarget.value)}/></label>
 <label class="block text-sm font-medium text-gray-700 dark:text-gray-200">Document<textarea class="mt-1 min-h-48 w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2 font-normal leading-6 dark:border-gray-700" maxlength="100000" value={draftValue.body||''} on:input={e=>change('body',e.currentTarget.value)} /></label>
 <div class="flex items-center justify-between gap-3"><p class="text-xs text-gray-500">{staleDraft?'The resource changed. Review the current revision before saving.':panel.draft?'Unsent changes saved on this device.':'Up to date with the loaded revision.'}</p><button class="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900" disabled={saving||staleDraft||!draftValue.title?.trim()}>{saving?'Saving…':'Save changes'}</button></div>
 {#if staleDraft}<button type="button" class="rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-gray-700" on:click={()=>host.draft(panel.key,null)}>Load current revision</button>{/if}
</form>
{:else if rows.length}
<ul class="divide-y divide-gray-100 dark:divide-gray-800">{#each rows as item}<li class="flex items-start justify-between gap-3 py-3"><div><p class="text-sm font-medium">{item.title||item.name||'Untitled resource'}</p><p class="text-xs text-gray-500">{item.kind||'Resource'}</p></div>{#if item.version}<span class="text-xs text-gray-500">Revision {item.version}</span>{/if}</li>{/each}</ul>
{:else}
<article class="space-y-3 text-sm"><h3 class="font-medium text-gray-900 dark:text-gray-100">{documentValue.title||'Company resource'}</h3>{#if documentValue.body}<p class="whitespace-pre-wrap leading-6 text-gray-600 dark:text-gray-300">{documentValue.body}</p>{:else}<p class="text-gray-500">No description has been saved.</p>{/if}<p class="text-xs text-gray-500">{panel.ref.kind} · Revision {panel.revision}</p>{#if panel.ref.kind==='file'}<p class="text-xs text-gray-500">File metadata only. Opening file content requires the verified Drive viewer.</p>{/if}</article>
{/if}
{#if error}<p class="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>{/if}
