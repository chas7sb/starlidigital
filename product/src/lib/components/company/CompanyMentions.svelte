<script lang="ts">
 import type {Bot} from '$lib/utils/company-workspace';
 export let agents:Bot[]=[];export let ids:string[]=[];export let busy=false;
</script>
{#if agents.length}<fieldset class="company-mentions"><legend>Mention an AI agent</legend>{#each agents as agent(agent.id)}<label><input type="checkbox" value={agent.id} bind:group={ids} disabled={busy||ids.length>=4&&!ids.includes(agent.id)}/><span>@{agent.name}</span></label>{/each}</fieldset>{/if}
<style>.company-mentions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0}.company-mentions legend{font-size:12px;color:var(--sd-muted);margin-bottom:6px}.company-mentions label{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--sd-line);border-radius:999px;font-size:12px}.company-mentions input{accent-color:var(--sd-accent)}</style>
