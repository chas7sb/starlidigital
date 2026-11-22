<script lang="ts">
	import { getContext, onMount, onDestroy } from 'svelte';
	import { formatFileSize, getLineCount } from '$lib/utils';
	import { safeNavigationUrl, fileContentUrl } from '$lib/utils/safe-render';
	import { WEBUI_API_BASE_URL } from '$lib/constants';

	const i18n = getContext('i18n');

	import Modal from './Modal.svelte';
	import XMark from '../icons/XMark.svelte';
	import Info from '../icons/Info.svelte';
	import Switch from './Switch.svelte';
	import Tooltip from './Tooltip.svelte';

	export let item;
	export let show = false;
	export let edit = false;

	let enableFullContent = false;
	$: isPDF =
		item?.meta?.content_type === 'application/pdf' ||
		(item?.name && item?.name.toLowerCase().endsWith('.pdf'));

	$: fileLink = safeNavigationUrl(item?.type === 'file' && item?.url ? item.url.replace(/\/$/, '') + '/content' : item?.url);
	$: pdfUrl = fileContentUrl(item?.id, WEBUI_API_BASE_URL.replace(/\/api\/v1$/, ''));

    let pdfBlobUrl: string | null = null;
    let pdfError = '';
    let pdfLoading = false;
    let pdfController: AbortController | null = null;
    let pdfSequence = 0;
    const clearPDF = () => {
        pdfSequence++;
        pdfController?.abort();
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        pdfBlobUrl = null;
        pdfLoading = false;
        pdfError = '';
    };
    const loadPDF = async (url: string) => {
        clearPDF();
        const sequence = pdfSequence;
        const controller = new AbortController();
        pdfController = controller;
        pdfLoading = true;
        try {
            const response = await fetch(url, {signal:controller.signal,redirect:'error',credentials:'same-origin',
                headers:localStorage.token ? {Authorization:'Bearer '+localStorage.token} : {}});
            if (!response.ok || !response.body) throw Error('PDF unavailable');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                size += chunk.value.byteLength;
                if (size > 50 * 1024 * 1024) {await reader.cancel();throw Error('PDF too large');}
                chunks.push(chunk.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
            if (new TextDecoder('ascii').decode(bytes.subarray(0,5)) !== '%PDF-') throw Error('Not a PDF');
            if (sequence !== pdfSequence || controller.signal.aborted) return;
            // Chromium's native PDF viewer is blocked by iframe sandbox. A forced
            // PDF Blob after signature validation cannot be interpreted as app HTML.
            pdfBlobUrl = URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
        } catch (error) {
            if (sequence===pdfSequence && !controller.signal.aborted) pdfError='Unable to preview this PDF.';
        } finally {
            if (sequence===pdfSequence) pdfLoading=false;
        }
    };
    $: if (show && isPDF && pdfUrl) {void loadPDF(pdfUrl);} else {clearPDF();}
    onDestroy(clearPDF);

	onMount(() => {
		console.log(item);
		if (item?.context === 'full') {
			enableFullContent = true;
		}
	});
</script>

<Modal bind:show size="lg">
	<div class="font-primary px-6 py-5 w-full flex flex-col justify-center dark:text-gray-400">
		<div class=" pb-2">
			<div class="flex items-start justify-between">
				<div>
					<div class=" font-medium text-lg dark:text-gray-100">
						<a href={(isPDF ? pdfBlobUrl : fileLink) ?? '#'} target="_blank" rel="noopener noreferrer" class="hover:underline line-clamp-1"
                            on:click={(event) => { if (!(isPDF ? pdfBlobUrl : fileLink)) event.preventDefault(); }}>
                            {item?.name ?? 'File'}
                        </a>
					</div>
				</div>

				<div>
					<button
						on:click={() => {
							show = false;
						}}
					>
						<XMark />
					</button>
				</div>
			</div>

			<div>
				<div class="flex flex-col items-center md:flex-row gap-1 justify-between w-full">
					<div class=" flex flex-wrap text-sm gap-1 text-gray-500">
						{#if item.size}
							<div class="capitalize shrink-0">{formatFileSize(item.size)}</div>
							•
						{/if}

						{#if item?.file?.data?.content}
							<div class="capitalize shrink-0">
								{getLineCount(item?.file?.data?.content ?? '')} extracted lines
							</div>

							<div class="flex items-center gap-1 shrink-0">
								<Info />

								Formatting may be inconsistent from source.
							</div>
						{/if}
					</div>

					{#if edit}
						<div>
							<Tooltip
								content={enableFullContent
									? $i18n.t(
											'Inject the entire content as context for comprehensive processing, this is recommended for complex queries.'
										)
									: $i18n.t(
											'Default to segmented retrieval for focused and relevant content extraction, this is recommended for most cases.'
										)}
							>
								<div class="flex items-center gap-1.5 text-xs">
									{#if enableFullContent}
										Using Entire Document
									{:else}
										Using Focused Retrieval
									{/if}
									<Switch
										bind:state={enableFullContent}
										on:change={(e) => {
											item.context = e.detail ? 'full' : undefined;
										}}
									/>
								</div>
							</Tooltip>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<div class="max-h-[75vh] overflow-auto">
			{#if isPDF}
                {#if pdfBlobUrl}
                    <iframe title={item?.name} src={pdfBlobUrl} referrerpolicy="no-referrer" class="w-full h-[70vh] border-0 rounded-lg mt-4" />
                {:else if pdfError}
                    <p role="alert" class="p-4 text-sm">{pdfError}</p>
                {:else}
                    <p role="status" class="p-4 text-sm">{pdfLoading ? 'Loading PDF…' : 'PDF preview unavailable.'}</p>
                {/if}
			{:else}
				<div class="max-h-96 overflow-scroll scrollbar-hidden text-xs whitespace-pre-wrap">
					{item?.file?.data?.content ?? 'No content'}
				</div>
			{/if}
		</div>
	</div>
</Modal>
