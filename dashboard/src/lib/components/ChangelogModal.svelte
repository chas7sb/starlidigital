<script lang="ts">
	import { getContext } from 'svelte';
	import { config, settings } from '$lib/stores';
	import { updateUserSettings } from '$lib/apis/users';
	import Modal from './common/Modal.svelte';
	import StarliBrand from './starli-preview/StarliBrand.svelte';

	const i18n = getContext('i18n');
	export let show = false;

	function dismiss() {
		localStorage.version = $config.version;
		show = false;
	}

	async function getStarted() {
		dismiss();
		await settings.set({ ...$settings, version: $config.version });
		await updateUserSettings(localStorage.token, { ui: $settings }).catch(() => {});
	}
</script>

<Modal bind:show size="lg">
	<div class="p-6 sm:p-8 text-gray-900 dark:text-gray-100">
		<div class="flex items-start justify-between gap-4">
			<StarliBrand compact />
			<button class="rounded-lg p-1 text-gray-500 hover:text-gray-900 dark:hover:text-white" aria-label={$i18n.t('Close')} on:click={dismiss}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
					<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
				</svg>
			</button>
		</div>

		<div class="mt-8 mb-7">
			<h1 class="text-2xl sm:text-3xl font-semibold tracking-tight">Welcome to STARLIDIGITAL</h1>
			<p class="mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed">
				Your workspace for AI, customers, and projects. Start a conversation with Starli AI and bring your next idea to life.
			</p>
		</div>

		<div class="grid gap-3 sm:grid-cols-3">
			{#each [
				{ title: 'Meet Starli AI', text: 'Ask questions, explore ideas, and work through your next task.' },
				{ title: 'Keep work connected', text: 'Find your customers, projects, and company tools in one workspace.' },
				{ title: 'Make it yours', text: 'Pick your theme and preferences in Settings to feel right at home.' }
			] as item}
				<div class="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
					<h2 class="text-sm font-semibold">{item.title}</h2>
					<p class="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{item.text}</p>
				</div>
			{/each}
		</div>

		<div class="mt-8 flex justify-end">
			<button on:click={getStarted} class="px-5 py-2.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full">
				Get started
			</button>
		</div>
	</div>
</Modal>
