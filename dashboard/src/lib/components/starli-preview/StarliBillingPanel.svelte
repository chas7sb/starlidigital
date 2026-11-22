<script lang="ts">
	import { onMount } from 'svelte';
	let loading = true;
	let error = '';
	let data: any = null;

	function authHeaders() {
		const token = localStorage.token;
		return token ? { Authorization: `Bearer ${token}` } : {};
	}
	function when(value: string) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? 'Invalid date' : d.toLocaleString();
	}
	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/v1/starli/billing', { headers: authHeaders() });
			if (!res.ok) throw new Error(`Billing failed (${res.status})`);
			data = await res.json();
		} catch (e: any) {
			data = null;
			error = e?.message || 'Could not load billing';
		} finally {
			loading = false;
		}
	}
	onMount(load);
	$: wallet = data?.wallet ?? null;
	$: ledger = Array.isArray(data?.ledger) ? data.ledger : [];
	$: reservations = Array.isArray(data?.reservations) ? data.reservations : [];
	$: unit = data?.unit || 'credits';
	$: cards = wallet
		? [
				['Available', wallet.available],
				['Reserved', wallet.reserved],
				['Spent', wallet.totalSpent],
				['Debt', wallet.debt]
			]
		: [];
</script>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 text-gray-900 dark:text-gray-100">
	<header class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<h1 class="text-lg font-semibold">Credits</h1>
			<p class="text-sm text-gray-500 dark:text-gray-400">Wallet billing only. Provider model cost estimates are not wallet billing.</p>
		</div>
		<button class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm dark:bg-gray-800" on:click={load}>Retry</button>
	</header>
	{#if loading}<p class="text-sm text-gray-500">Loading credits…</p>
	{:else if error}<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
	{:else}
		{#if data?.paymentsEnabled === false}<p class="rounded-lg bg-gray-100 px-3 py-2 text-sm dark:bg-gray-800">Payments are not connected.</p>{/if}
		{#if !wallet}<p class="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">No wallet on this account. This is not a zero balance.</p>
		{:else}
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each cards as [label, value]}<article class="rounded-xl bg-gray-50 p-3 dark:bg-gray-900"><p class="text-xs text-gray-500">{label}</p><p class="text-xl font-medium">{value} {unit}</p></article>{/each}
			</div>
			<p class="text-xs text-gray-500">Updated {when(wallet.updatedAt)} · granted {wallet.totalGranted}</p>
		{/if}
		{#if data?.limitations?.length}<ul class="text-xs text-gray-500">{#each data.limitations as item}<li>{item}</li>{/each}</ul>{/if}
		<div class="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
			<table class="w-full min-w-[36rem] text-left text-sm">
				<thead class="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900"><tr><th class="p-2">When</th><th>Kind</th><th>Amount</th><th>Reason</th><th>Δ avail/res/debt</th></tr></thead>
				<tbody>
					{#if ledger.length === 0}<tr><td class="p-3 text-gray-500" colspan="5">No ledger entries yet.</td></tr>
					{:else}{#each ledger as row}<tr class="border-t border-gray-100 dark:border-gray-800"><td class="p-2">{when(row.createdAt)}</td><td>{row.kind}</td><td>{row.amount}</td><td>{row.reason}</td><td>{row.availableDelta}/{row.reservedDelta}/{row.debtDelta}</td></tr>{/each}{/if}
				</tbody>
			</table>
		</div>
		<section>
			<h2 class="mb-1 text-sm font-medium">Reservations</h2>
			{#if reservations.length === 0}<p class="text-sm text-gray-500">No reservations.</p>
			{:else}<ul class="flex flex-col gap-1 text-sm">{#each reservations as row}<li class="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900">{row.amount} {unit} · {row.action} · {row.status} · {when(row.createdAt)}</li>{/each}</ul>{/if}
		</section>
	{/if}
</section>
