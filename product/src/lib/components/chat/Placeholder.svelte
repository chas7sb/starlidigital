<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { marked } from 'marked';
	import { sanitizeRichHtml } from '$lib/utils/safe-render';

	import { onMount, getContext, tick, createEventDispatcher } from 'svelte';
	import { blur, fade } from 'svelte/transition';

	const dispatch = createEventDispatcher();
 import WorkspaceHome from '$lib/components/starli-shell/WorkspaceHome.svelte';
 let compact=false;
 onMount(()=>{compact=window.parent!==window;const compose=(e:Event)=>{if(!prompt.trim())prompt=(e as CustomEvent).detail;tick().then(()=>document.getElementById('chat-input')?.focus());};window.addEventListener('starli-compose-draft',compose);return()=>window.removeEventListener('starli-compose-draft',compose);});


	import { config, user, models as _models, temporaryChatEnabled } from '$lib/stores';
	import { sanitizeResponseContent, extractCurlyBraceWords } from '$lib/utils';
	import { WEBUI_BASE_URL } from '$lib/constants';

	import Suggestions from './Suggestions.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import EyeSlash from '$lib/components/icons/EyeSlash.svelte';
	import MessageInput from './MessageInput.svelte';

	const i18n = getContext('i18n');

	export let guestMode = false;
	export let transparentBackground = false;

	export let createMessagePair: Function;
	export let stopResponse: Function;

	export let autoScroll = false;

	export let atSelectedModel: Model | undefined;
	export let selectedModels: [''];

	export let history;

	export let prompt = '';
	export let files = [];

	export let selectedToolIds = [];
	export let imageGenerationEnabled = false;
	export let codeInterpreterEnabled = false;
	export let webSearchEnabled = false;

	export let toolServers = [];

	let models = [];

	const selectSuggestionPrompt = async (p) => {
		let text = p;

		if (p.includes('{{CLIPBOARD}}')) {
			const clipboardText = await navigator.clipboard.readText().catch((err) => {
				toast.error($i18n.t('Failed to read clipboard contents'));
				return '{{CLIPBOARD}}';
			});

			text = p.replaceAll('{{CLIPBOARD}}', clipboardText);

			console.log('Clipboard text:', clipboardText, text);
		}

		prompt = text;

		console.log(prompt);
		await tick();

		const chatInputContainerElement = document.getElementById('chat-input-container');
		const chatInputElement = document.getElementById('chat-input');

		if (chatInputContainerElement) {
			chatInputContainerElement.scrollTop = chatInputContainerElement.scrollHeight;
		}

		await tick();
		if (chatInputElement) {
			chatInputElement.focus();
			chatInputElement.dispatchEvent(new Event('input'));
		}

		await tick();
	};

	let selectedModelIdx = 0;

	$: if (selectedModels.length > 0) {
		selectedModelIdx = models.length - 1;
	}

	$: models = guestMode ? [{id:'starli-ai',name:'STARLI BOSS'}] : selectedModels.map((id) => $_models.find((m) => m.id === id));

	onMount(() => {});
</script>

<WorkspaceHome {compact}>
 {#if !guestMode && $temporaryChatEnabled}<small>Temporary chat</small>{/if}
<MessageInput
					{guestMode}
					{history}
					{selectedModels}
					bind:files
					bind:prompt
					bind:autoScroll
					bind:selectedToolIds
					bind:imageGenerationEnabled
					bind:codeInterpreterEnabled
					bind:webSearchEnabled
					bind:atSelectedModel
					{toolServers}
					{transparentBackground}
					{stopResponse}
					{createMessagePair}
					welcome placeholder="Ask your Starli"
					on:upload={(e) => {
						dispatch('upload', e.detail);
					}}
					on:submit={(e) => {
						dispatch('submit', e.detail);
					}}
				/>
</WorkspaceHome>
