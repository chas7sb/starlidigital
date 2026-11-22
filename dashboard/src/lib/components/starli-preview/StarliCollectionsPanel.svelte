<script lang="ts">
	import { onMount } from 'svelte';
	export let kind: string;

	const KINDS = ['projects', 'proposals', 'mailbox', 'hosted-agents', 'videos', 'activity'];
	const LIMIT = 30;
	const TITLES: Record<string, string> = {
		projects: 'Projects',
		proposals: 'Proposals',
		mailbox: 'Mailbox',
		'hosted-agents': 'Hosted agents',
		videos: 'Videos',
		activity: 'Activity'
	};

	type Item = { id: string; name: string; status?: string; description?: string; updatedAt?: string; url?: string };
	type Page = { items: Item[]; total: number; readOnly: true };

	let q = '';
	let offset = 0;
	let page: Page | null = null;
	let selected: Item | null = null;
	let loading = false;
	let error = '';
	let ready = false;
	let seen = '';
	let ctrl: AbortController | null = null;

	$: title = TITLES[kind] ?? 'Collections';
	$: total = page?.total ?? 0;
	$: canPrev = offset > 0;
	$: canNext = offset + LIMIT < total;

	function safeUrl(url?: string) {
		if (!url) return '';
		try {
			const parsed = new URL(url);
			return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
		} catch {
			return '';
		}
	}

	function when(value?: string) {
		if (!value) return '';
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
	}

	async function load(next = 0) {
		if (!KINDS.includes(kind)) {
			page = null;
			error = 'Unsupported collection.';
			loading = false;
			return;
		}
		ctrl?.abort();
		const current = new AbortController();
		ctrl = current;
		loading = true;
		error = '';
		const params = new URLSearchParams({ q, limit: String(LIMIT), offset: String(next) });
		try {
			const token = localStorage.token as string | undefined;
			const res = await fetch(`/api/v1/starli/resources/${encodeURIComponent(kind)}?${params}`, {
				credentials: 'same-origin',
				signal: current.signal,
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			});
			if (!res.ok) throw new Error(`Could not load ${title} (${res.status}).`);
			const body = await res.json();
			if (current.signal.aborted) return;
			page = {
				items: Array.isArray(body.items) ? body.items : [],
				total: Number(body.total) || 0,
				readOnly: true
			};
			offset = next;
			if (selected && !page.items.some((item) => item.id === selected?.id)) selected = null;
		} catch (cause) {
			if (!current.signal.aborted) error = cause instanceof Error ? cause.message : 'Unable to load collection.';
		} finally {
			if (!current.signal.aborted) loading = false;
		}
	}

	function submit(event: Event) {
		event.preventDefault();
		selected = null;
		void load(0);
	}

	onMount(() => {
		ready = true;
		return () => ctrl?.abort();
	});

	$: if (ready && kind !== seen) {
		seen = kind;
		q = '';
		selected = null;
		void load(0);
	}
</script>

<section class="m-3 rounded-2xl border border-gray-100 bg-white p-4 text-gray-900 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" aria-labelledby="starli-collections-heading">
	<header class="mb-3 flex items-center justify-between gap-3">
		<h1 id="starli-collections-heading" class="text-lg font-semibold">{title}</h1>
		<p class="text-xs text-gray-500" role="status">Read-only</p>
	</header>
	<form class="mb-3 flex gap-2" on:submit={submit}>
		<input class="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" bind:value={q} type="search" placeholder="Search {title.toLowerCase()}" aria-label="Search {title}" />
		<button class="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white dark:bg-gray-100 dark:text-gray-900" type="submit">Search</button>
	</form>
	{#if loading}<p class="text-sm text-gray-500" role="status" aria-live="polite">Loading {title.toLowerCase()}…</p>
	{:else if error}<div class="space-y-2" role="alert"><p class="text-sm">{error}</p><button class="rounded-xl border px-3 py-1 text-sm" type="button" on:click={() => load(offset)}>Retry</button></div>
	{:else if !page?.items.length}<p class="text-sm text-gray-500">No {title.toLowerCase()} match this search.</p>
	{:else}
		<div class="grid gap-3 md:grid-cols-2">
			<ul class="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
				{#each page.items as item (item.id)}
					<li>
						<button class="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800" type="button" on:click={() => (selected = item)}>
							<span class="block font-medium">{item.name}</span>
							<span class="text-xs text-gray-500">{item.status || 'No status'}{#if item.updatedAt} · {when(item.updatedAt)}{/if}</span>
						</button>
					</li>
				{/each}
			</ul>
			<aside class="rounded-xl border border-gray-100 p-3 dark:border-gray-800">
				{#if selected}
					<h2 class="font-medium">{selected.name}</h2>
					<p class="text-sm text-gray-500">Status: {selected.status || 'Unknown'}</p>
					{#if selected.updatedAt}<p class="text-sm text-gray-500">Updated: {when(selected.updatedAt)}</p>{/if}
					{#if selected.description}<p class="mt-2 text-sm">{selected.description}</p>{/if}
					<p class="mt-2 text-xs text-gray-500">ID: {selected.id}</p>
					{#if safeUrl(selected.url)}
						<a class="mt-2 inline-block text-sm underline" href={safeUrl(selected.url)} target="_blank" rel="noopener noreferrer">Open link</a>
					{/if}
				{:else}<p class="text-sm text-gray-500">Select a row to view details.</p>{/if}
			</aside>
		</div>
		<div class="mt-3 flex items-center justify-between text-sm">
			<button class="rounded-xl border px-3 py-1 disabled:opacity-40" type="button" disabled={!canPrev} on:click={() => load(Math.max(0, offset - LIMIT))}>Previous</button>
			<span class="text-gray-500">{offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
			<button class="rounded-xl border px-3 py-1 disabled:opacity-40" type="button" disabled={!canNext} on:click={() => load(offset + LIMIT)}>Next</button>
		</div>
	{/if}
</section>
