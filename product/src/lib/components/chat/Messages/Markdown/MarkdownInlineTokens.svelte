<script lang="ts">
	import { sanitizeRichHtml, ownedFileEmbedUrl, fileContentUrl, safeNavigationUrl } from '$lib/utils/safe-render';
	import OwnedFileFrame from '$lib/components/common/OwnedFileFrame.svelte';
	import { toast } from 'svelte-sonner';

	import type { Token } from 'marked';
	import { getContext } from 'svelte';

	const i18n = getContext('i18n');

	import { WEBUI_BASE_URL } from '$lib/constants';
	import { copyToClipboard, unescapeHtml } from '$lib/utils';

	import Image from '$lib/components/common/Image.svelte';
	import KatexRenderer from './KatexRenderer.svelte';
	import Source from './Source.svelte';

	export let id: string;
	export let tokens: Token[];
	export let onSourceClick: Function = () => {};
</script>

{#each tokens as token}
	{#if token.type === 'escape'}
		{unescapeHtml(token.text)}
	{:else if token.type === 'html'}
		{@const html = sanitizeRichHtml(token.text)}
		{#if html && html.includes('<video')}
			{@html html}
		{:else if ownedFileEmbedUrl(token.text, WEBUI_BASE_URL)}
			<OwnedFileFrame src={ownedFileEmbedUrl(token.text, WEBUI_BASE_URL)} title="File preview" />
		{:else if token.text.includes(`<source_id`)}
			<Source {id} {token} onClick={onSourceClick} />
		{:else}
			{@html html}
		{/if}
	{:else if token.type === 'link'}
		{#if token.tokens}
			<a href={safeNavigationUrl(token.href) ?? '#'} target="_blank" rel="nofollow noopener noreferrer" title={token.title}>
				<svelte:self id={`${id}-a`} tokens={token.tokens} {onSourceClick} />
			</a>
		{:else}
			<a href={safeNavigationUrl(token.href) ?? '#'} target="_blank" rel="nofollow noopener noreferrer" title={token.title}>{token.text}</a>
		{/if}
	{:else if token.type === 'image'}
		<Image src={token.href} alt={token.text} />
	{:else if token.type === 'strong'}
		<strong><svelte:self id={`${id}-strong`} tokens={token.tokens} {onSourceClick} /></strong>
	{:else if token.type === 'em'}
		<em><svelte:self id={`${id}-em`} tokens={token.tokens} {onSourceClick} /></em>
	{:else if token.type === 'codespan'}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
		<code
			class="codespan cursor-pointer"
			on:click={() => {
				copyToClipboard(unescapeHtml(token.text));
				toast.success($i18n.t('Copied to clipboard'));
			}}>{unescapeHtml(token.text)}</code
		>
	{:else if token.type === 'br'}
		<br />
	{:else if token.type === 'del'}
		<del><svelte:self id={`${id}-del`} tokens={token.tokens} {onSourceClick} /></del>
	{:else if token.type === 'inlineKatex'}
		{#if token.text}
			<KatexRenderer content={token.text} displayMode={false} />
		{/if}
	{:else if token.type === 'iframe'}
		{#if fileContentUrl(token.fileId, WEBUI_BASE_URL)}
			<OwnedFileFrame src={fileContentUrl(token.fileId, WEBUI_BASE_URL)} title={String(token.fileId)} />
		{/if}
	{:else if token.type === 'text'}
		{token.raw}
	{/if}
{/each}
