<script lang="ts">
 import {createEventDispatcher} from 'svelte';
 import {panelCommandsFromMessage} from './receipt-dispatch.mjs';
 export let message:any;export let companyId:string;export let availableTypes:string[]=[];
 const dispatch=createEventDispatcher();
 $: actions=panelCommandsFromMessage(message,companyId).filter(action=>availableTypes.includes(action.command.type));
</script>
{#if actions.length}<div class="mt-3 flex flex-wrap gap-2" aria-label="Resources from this message">
 {#each actions as action(action.receiptId)}<button type="button" class="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800" disabled={!availableTypes.includes(action.command.type)} title={availableTypes.includes(action.command.type)?'Open authorized resource':'Native resource service unavailable'} on:click={()=>dispatch('open',action.command)}>Open {action.title}</button>{/each}
</div>{/if}
