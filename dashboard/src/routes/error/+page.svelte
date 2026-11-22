<script>
	import { goto } from '$app/navigation';
	import { WEBUI_NAME, config } from '$lib/stores';
	import { onMount, getContext } from 'svelte';
	import { getBackendConfig } from '$lib/apis';

	const i18n = getContext('i18n');

	let loaded = false;
	let checking = true;
	let diagnostic = '';
	const recover = async () => {
		checking = true;
		try {
			const response = await getBackendConfig();
			if (response?.status) {
				await config.set(response);
				await goto('/', { replaceState: true });
				return;
			}
			diagnostic = 'Backend configuration returned an invalid response';
		} catch (error) {
			diagnostic = error?.message ?? String(error);
		}
		checking = false;
	};

	onMount(async () => {
		if ($config) {
			await goto('/');
		}

		loaded = true;
		await recover();
	});
</script>

{#if loaded}
	<div class="absolute w-full h-full flex z-50">
		<div class="absolute rounded-xl w-full h-full backdrop-blur-sm flex justify-center">
			<div class="m-auto pb-44 flex flex-col justify-center">
				<div class="max-w-md">
                    <div class="text-center text-2xl font-medium z-50">STARLIDIGITAL is temporarily unavailable</div>
                    <p class="mt-4 text-center text-sm text-gray-500">We could not connect to your workspace. Try again in a moment. If the issue continues, contact your platform administrator.</p>

					<div class=" mt-6 mx-auto relative group w-fit">
						<button
							class="relative z-20 flex px-5 py-2 rounded-full bg-gray-100 hover:bg-gray-200 transition font-medium text-sm"
							on:click={recover}
						>
							{checking ? 'Checking connection…' : $i18n.t('Check Again')}
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
