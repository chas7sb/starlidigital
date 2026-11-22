<script lang="ts">
	import {page} from '$app/stores';
 import {starliAgents} from '$lib/stores/starli-activity';
 import {chatIdFromPath} from '$lib/utils/starli-chat-url';
 import { models } from '$lib/stores';
	export let selectedModels = [''];
	export let disabled = false;
	export let showSetDefault = true;
	$: starli = $models.find((model) => model.name === 'Starli AI');
	$: if (starli && (selectedModels.length !== 1 || selectedModels[0] !== starli.id)) selectedModels = [starli.id];
 $: selectedId=$page.url.searchParams.get('starli');
 $: conversationId=chatIdFromPath($page.url.pathname);
 $: selectedAgent=Object.values($starliAgents).find(agent=>selectedId?agent.id===selectedId:conversationId&&agent.chatId===conversationId);
 $: label=selectedAgent&&selectedAgent.kind!=='boss'?selectedAgent.name:'STARLI BOSS';
</script>

<div class="flex items-center min-h-10 px-1 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100" aria-label={label}>
	{label}
</div>
