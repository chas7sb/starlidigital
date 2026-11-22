<script lang="ts">
 import XMark from '$lib/components/icons/XMark.svelte';
 import ArrowsPointingOut from '$lib/components/icons/ArrowsPointingOut.svelte';
 export let title:string;export let revision:number|undefined=undefined;
 export let expanded=false;export let focus:()=>void;export let toggle:()=>void;export let close:()=>void;
</script>
<header class="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-4 py-3">
 <div class="min-w-0 flex-1"><h2 class="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>{#if revision!==undefined}<p class="text-xs text-gray-500 dark:text-gray-400">Revision {revision}</p>{/if}</div>
 <button class="rounded-lg px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 dark:text-gray-300 dark:hover:bg-gray-800" on:click={focus} aria-label={'Focus '+title}>Focus</button>
 <button class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 dark:hover:bg-gray-800" aria-label={expanded?'Dock '+title:'Expand '+title} title={expanded?'Dock':'Expand'} aria-pressed={expanded} on:click={toggle}><ArrowsPointingOut className="size-4"/></button>
 <button class="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 dark:hover:bg-gray-800" aria-label={'Close '+title} title="Close" on:click={close}><XMark className="size-4"/></button>
</header>
