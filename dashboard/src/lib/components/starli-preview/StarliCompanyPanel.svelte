<script lang="ts">
	import { onMount } from 'svelte';
	type Company = { id: string; name: string } | null;
	type Overview = {
		company: Company;
		browser?: { available?: boolean; reason?: string };
		credits?: { available?: boolean; balance?: number | null; unit?: string };
		readOnly?: boolean;
	};
	type Feature = { id: string; name: string; present?: boolean; configured: boolean | null; verification?: string };
	const links = [
		['Chat', '/'],
		['CRM', '/starli/crm'],
		['Projects', '/starli/projects'],
		['Mailbox', '/starli/mailbox'],
		['Hosted agents', '/starli/hosted-agents'],
		['Videos', '/starli/videos'],
		['Approvals', '/starli/approvals'],
		['Browser', '/starli/browser']
	];
	let overview: Overview | null = null;
	let features: Feature[] = [];
	let limits: string[] = [];
	let ovLoading = true;
	let capLoading = true;
	let ovError = '';
	let capError = '';
	function headers() {
		const token = localStorage.token;
		return token ? { Authorization: `Bearer ${token}` } : {};
	}
	function capLabel(configured: boolean | null) {
		if (configured === false) return 'Not configured';
		if (configured === null) return 'Available in app; needs verification';
		return 'Enabled';
	}
	async function loadOverview() {
		ovLoading = true;
		ovError = '';
		try {
			const res = await fetch('/api/v1/starli/overview', { headers: headers() });
			if (!res.ok) throw new Error(`Overview failed (${res.status})`);
			overview = await res.json();
		} catch (e: any) {
			overview = null;
			ovError = e?.message || 'Could not load company';
		} finally {
			ovLoading = false;
		}
	}
	async function loadCaps() {
		capLoading = true;
		capError = '';
		try {
			const res = await fetch('/api/v1/starli/native-capabilities', { headers: headers() });
			if (!res.ok) throw new Error(`Capabilities failed (${res.status})`);
			const body = await res.json();
			features = Array.isArray(body?.features) ? body.features : [];
			limits = Array.isArray(body?.limitations) ? body.limitations : [];
		} catch (e: any) {
			features = [];
			limits = [];
			capError = e?.message || 'Could not load capabilities';
		} finally {
			capLoading = false;
		}
	}
	onMount(() => {
		void loadOverview();
		void loadCaps();
	});
	$: credits = overview?.credits;
	$: known = credits?.available === true && typeof credits?.balance === 'number';
</script>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 text-gray-900 dark:text-gray-100">
	<header class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h1 class="text-lg font-semibold">{overview?.company?.name || 'Company'}</h1>
			<p class="text-sm text-gray-500 dark:text-gray-400">Delegation stays in chat. This page does not list subagents.</p>
		</div>
		{#if overview?.readOnly}<p class="text-xs text-gray-500">Read-only</p>{/if}
	</header>
	<nav class="flex flex-wrap gap-2" aria-label="Company links">
		{#each links as [label, href]}<a class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100" {href}>{label}</a>{/each}
	</nav>
	<article class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900">
		<div class="mb-1 flex items-center justify-between"><h2 class="text-sm font-medium">Credits</h2><button class="text-xs text-gray-600 dark:text-gray-300" on:click={loadOverview}>Retry</button></div>
		{#if ovLoading}<p class="text-sm text-gray-500">Loading overview…</p>
		{:else if ovError}<p class="text-sm text-red-600 dark:text-red-400">{ovError}</p>
		{:else if !overview?.company}<p class="text-sm text-gray-500">No company on this account.</p>
		{:else if known}<p class="text-xl font-medium">{credits.balance} {credits.unit || 'credits'}</p>
		{:else}<p class="text-sm text-gray-500">Credits unavailable</p>{/if}
		{#if overview?.browser}<p class="mt-1 text-xs text-gray-500">Browser {overview.browser.available ? 'available' : 'unavailable'}{overview.browser.reason ? ` · ${overview.browser.reason}` : ''}</p>{/if}
	</article>
	<section>
		<div class="mb-2 flex items-center justify-between"><h2 class="text-sm font-medium">Native capabilities</h2><button class="text-xs text-gray-600 dark:text-gray-300" on:click={loadCaps}>Retry</button></div>
		{#if capLoading}<p class="text-sm text-gray-500">Loading capabilities…</p>
		{:else if capError}<p class="text-sm text-red-600 dark:text-red-400">{capError}</p>
		{:else if features.length === 0}<p class="text-sm text-gray-500">No native capabilities reported.</p>
		{:else}
			<ul class="flex flex-col gap-1">
				{#each features as item (item.id)}
					<li class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900">
						<span>{item.name}{item.present === false ? ' · not present' : ''}</span>
						<span class="text-xs text-gray-500">{capLabel(item.configured)}{item.verification ? ` · ${item.verification}` : ''}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if limits.length}<ul class="mt-2 text-xs text-gray-500">{#each limits as item}<li>{item}</li>{/each}</ul>{/if}
	</section>
</section>
