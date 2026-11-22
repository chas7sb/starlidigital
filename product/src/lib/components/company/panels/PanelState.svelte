<script lang="ts">
 import Spinner from '$lib/components/common/Spinner.svelte';
 export let state:string;export let message='';
</script>
<div class="flex min-h-32 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-gray-500 dark:text-gray-400" role={state==='error'?'alert':'status'}>
 {#if state==='loading'}<Spinner className="size-5"/><p>Loading the authorized resource…</p>
 {:else if state==='capability'}<p>Access is unavailable. Reopen the company workspace to check your current permissions.</p>
 {:else if state==='error'}<p>{message||'This resource could not be loaded.'}</p>
 {:else}<p>No content is available for this resource.</p>{/if}
</div>
