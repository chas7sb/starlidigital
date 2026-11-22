<script lang="ts">
	import { models } from '$lib/stores';
	export let selectedModels = [''];
	export let disabled = false;
	export let showSetDefault = true;
	$: starli = $models.find((model) => model.name === 'Starli AI');
	$: if (starli && (selectedModels.length !== 1 || selectedModels[0] !== starli.id)) selectedModels = [starli.id];
</script>

<div class="flex items-center min-h-10 px-1 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100" aria-label="Starli AI">
	Starli AI
</div>
