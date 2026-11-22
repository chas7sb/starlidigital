<script lang="ts">
	import { onMount } from 'svelte';
	const PAGE = 50;
	const STATUSES = ['UNQUALIFIED', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED'] as const;
	type Mode = '' | 'create' | 'edit' | 'note';
	type Target = { id: string; version: number | null; name: string };
	let q = '';
	let offset = 0;
	let items: any[] = [];
	let total = 0;
	let loading = false;
	let error = '';
	let detail: any = null;
	let detailError = '';
	let detailLoading = false;
	let mode: Mode = '';
	let formError = '';
	let notice = '';
	let pending = false;
	let submitting = false;
	const operationKeys: Record<string, string> = {};
	let name = '';
	let domain = '';
	let qualificationStatus = 'UNQUALIFIED';
	let notes = '';
	let summary = '';
	let details = '';
	let target: Target | null = null;
	let listSeq = 0;
	let detailSeq = 0;
	let openedId = '';
	let listAbort: AbortController | null = null;
	let detailAbort: AbortController | null = null;

	function authHeaders() {
		const token = localStorage.token;
		return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
	}
	function search() { offset = 0; return load(); }
	function page(next: number) { offset = Math.max(0, next); return load(); }
	function label(row: any) {
		return [row?.name, row?.email, row?.title, row?.status, row?.summary].filter(Boolean).join(' · ') || JSON.stringify(row);
	}
	function askStarli(prompt:string){window.dispatchEvent(new CustomEvent('starli-compose',{detail:{prompt}}));notice='Continue in the chat composer.';}
 function clearTarget() { target = null; }
	function cancel() {
		if (submitting) return;
		mode = ''; formError = ''; clearTarget();
	}
	function aborted(err: any, ac: AbortController) {
		return ac.signal.aborted || err?.name === 'AbortError';
	}

	async function load() {
		listAbort?.abort();
		const ac = new AbortController();
		listAbort = ac;
		const seq = ++listSeq;
		loading = true; error = '';
		try {
			const params = new URLSearchParams();
			if (q.trim()) params.set('q', q.trim());
			params.set('offset', String(offset));
			params.set('limit', String(PAGE));
			const res = await fetch(`/api/v1/starli/customer-data/crm?${params}`, { headers: authHeaders(), signal: ac.signal });
			if (seq !== listSeq) return;
			if (!res.ok) throw new Error(`CRM list failed (${res.status})`);
			const data = await res.json();
			if (seq !== listSeq) return;
			items = Array.isArray(data.items) ? data.items : [];
			total = Number(data.total ?? items.length);
		} catch (e: any) {
			if (aborted(e, ac) || seq !== listSeq) return;
			items = []; total = 0; error = e?.message || 'Could not load companies';
		} finally {
			if (seq === listSeq) loading = false;
		}
	}

	async function openCompany(id: string, force = false) {
		if (submitting && !force) return;
		openedId = id;
		detailAbort?.abort();
		const ac = new AbortController();
		detailAbort = ac;
		const seq = ++detailSeq;
		detailLoading = true; detailError = ''; detail = null;
		try {
			const res = await fetch(`/api/v1/starli/customer-data/crm/${encodeURIComponent(id)}`, { headers: authHeaders(), signal: ac.signal });
			if (seq !== detailSeq) return;
			if (!res.ok) throw new Error(`Company detail failed (${res.status})`);
			const data = await res.json();
			if (seq !== detailSeq) return;
			detail = data;
		} catch (e: any) {
			if (aborted(e, ac) || seq !== detailSeq) return;
			detailError = e?.message || 'Could not load company';
		} finally {
			if (seq === detailSeq) detailLoading = false;
		}
	}

	function startCreate() {
		if (submitting) return;
		mode = 'create'; formError = ''; notice = '';
		name = ''; domain = ''; qualificationStatus = 'UNQUALIFIED'; notes = '';
		clearTarget();
	}
	function startEdit() {
		if (submitting) return;
		const c = detail?.company;
		if (!c?.id || c.version == null) return;
		target = { id: c.id, version: c.version, name: c.name || '' };
		mode = 'edit'; formError = ''; notice = '';
		name = c.name || ''; domain = c.domain || '';
		qualificationStatus = STATUSES.includes(c.status) ? c.status : 'UNQUALIFIED';
		notes = '';
	}
	function startNote() {
		if (submitting) return;
		const c = detail?.company;
		if (!c?.id) return;
		target = { id: c.id, version: c.version ?? null, name: c.name || '' };
		mode = 'note'; formError = ''; notice = ''; summary = ''; details = '';
	}

	function toolText(body: any) {
		const parts = Array.isArray(body?.content) ? body.content : [];
		return parts.map((p: any) => p?.text || '').filter(Boolean).join(' ') || body?.error || 'Tool failed';
	}

	async function submit(tool: string, args: Record<string, unknown>, refreshId?: string) {
		if (submitting) return;
		submitting = true; formError = ''; notice = ''; pending = false;
		try {
            const res = await fetch('/api/v1/starli/tools/invoke', {
                method: 'POST', headers: authHeaders(), body: JSON.stringify({ tool, args, operationKey: operationKeys[JSON.stringify({tool,args})] ??= crypto.randomUUID() })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.isError) throw new Error(toolText(body) || `Save failed (${res.status})`);
            mode = ''; clearTarget();
            await load();
            if (refreshId) await openCompany(refreshId, true);
            notice = 'Saved to your customer workspace.';

		} catch (e: any) { formError = e?.message || 'Submit failed'; }
		finally { submitting = false; }
	}

	function saveCompany() {
		if (!name.trim()) { formError = 'Name is required'; return; }
		const args: Record<string, unknown> = { name: name.trim(), qualificationStatus };
		if (domain.trim()) args.domain = domain.trim();
		if (notes.trim()) args.notes = notes.trim();
		let refreshId: string | undefined;
		if (mode === 'edit') {
			if (!target?.id || target.version == null) { formError = 'Missing company version'; return; }
			args.id = target.id; args.expectedVersion = target.version; refreshId = target.id;
		}
		return submit('crm_upsert_prospect', args, refreshId);
	}

	function saveNote() {
		if (!target?.id) { formError = 'Select a company'; return; }
		if (!summary.trim()) { formError = 'Summary is required'; return; }
		const args: Record<string, unknown> = { companyId: target.id, kind: 'NOTE', summary: summary.trim(), sourceEventId: crypto.randomUUID() };
		if (details.trim()) args.details = details.trim();
		return submit('crm_add_activity', args, target.id);
	}

	onMount(() => {
		void load();
		return () => {
			listAbort?.abort();
			detailAbort?.abort();
			listSeq++;
			detailSeq++;
		};
	});
</script>

<section class="flex h-full flex-col gap-3 p-4 text-sm text-gray-900 dark:text-gray-100">
	<header class="flex flex-wrap items-center gap-2">
		<h1 class="text-base font-semibold">CRM</h1>
		<form class="flex flex-1 gap-2" on:submit|preventDefault={search}>
			<input bind:value={q} placeholder="Search companies" class="min-w-40 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
			<button type="submit" class="rounded-xl bg-gray-200 px-3 py-2 font-medium hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700">Search</button>
		</form>
		<button type="button" disabled={submitting} class="rounded-xl bg-gray-900 px-3 py-2 font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900" on:click={startCreate}>New company</button>
	</header>
	{#if notice}<p class="rounded-xl bg-gray-100 p-3 dark:bg-gray-800">{notice} {#if pending}<a class="underline" href="/starli/approvals">Review pending</a>{/if}</p>{/if}
	{#if loading}<p>Loading companies…</p>{/if}
	{#if error}
		<p class="rounded-xl bg-gray-100 p-3 dark:bg-gray-800">{error}</p>
		<button type="button" class="w-fit rounded-xl bg-gray-200 px-3 py-2 dark:bg-gray-800" on:click={load}>Retry</button>
	{/if}
	<p class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
		<span>{total} companies · page size {PAGE} · offset {offset}</span>
		<button type="button" class="rounded-xl bg-gray-200 px-2 py-1 dark:bg-gray-800" disabled={offset === 0 || loading} on:click={() => page(offset - PAGE)}>Previous</button>
		<button type="button" class="rounded-xl bg-gray-200 px-2 py-1 dark:bg-gray-800" disabled={loading || offset + items.length >= total} on:click={() => page(offset + PAGE)}>Next</button>
	</p>
	<div class="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
		<div class="overflow-auto rounded-xl border border-gray-200 dark:border-gray-800">
			<table class="w-full text-left">
				<thead class="bg-gray-50 text-xs dark:bg-gray-800"><tr><th class="p-2">Name</th><th class="p-2">Status</th><th class="p-2">Industry</th></tr></thead>
				<tbody>
					{#each items as row (row.id)}
						<tr class="border-t border-gray-100 dark:border-gray-800">
							<td class="p-2"><button type="button" class="text-left font-medium hover:underline disabled:opacity-50" disabled={submitting} on:click={() => openCompany(row.id)}>{row.name}</button></td><td class="p-2">{row.status || '—'}</td><td class="p-2">{row.industry || '—'}</td>
						</tr>
					{:else}<tr><td class="p-2" colspan="3">{loading ? '' : 'No companies'}</td></tr>{/each}
				</tbody>
			</table>
		</div>
		<aside class="overflow-auto rounded-xl border border-gray-200 p-3 dark:border-gray-800">
			{#if mode === 'create' || mode === 'edit'}
				<form class="flex flex-col gap-2" on:submit|preventDefault={saveCompany}>
					<h2 class="font-semibold">{mode === 'create' ? 'New company' : `Edit ${target?.name || 'company'}`}</h2>
					<label class="text-xs">Name<input bind:value={name} required class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" /></label>
					<label class="text-xs">Domain<input bind:value={domain} class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" /></label>
					<label class="text-xs">Qualification<select bind:value={qualificationStatus} class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">{#each STATUSES as s}<option value={s}>{s}</option>{/each}</select></label>
					<label class="text-xs">Notes<textarea bind:value={notes} rows="3" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"></textarea></label>
					{#if formError}<p class="rounded-xl bg-gray-100 p-2 dark:bg-gray-800">{formError}</p>{/if}
					<div class="flex gap-2"><button type="submit" disabled={submitting} class="rounded-xl bg-gray-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">{submitting ? 'Submitting…' : 'Submit'}</button><button type="button" disabled={submitting} on:click={cancel} class="rounded-xl bg-gray-200 px-3 py-2 disabled:opacity-50 dark:bg-gray-800">Cancel</button></div>
				</form>
			{:else if mode === 'note'}
				<form class="flex flex-col gap-2" on:submit|preventDefault={saveNote}>
					<h2 class="font-semibold">Add note{target?.name ? ` · ${target.name}` : ''}</h2>
					<label class="text-xs">Summary<input bind:value={summary} required class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" /></label>
					<label class="text-xs">Details<textarea bind:value={details} rows="3" class="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"></textarea></label>
					{#if formError}<p class="rounded-xl bg-gray-100 p-2 dark:bg-gray-800">{formError}</p>{/if}
					<div class="flex gap-2"><button type="submit" disabled={submitting} class="rounded-xl bg-gray-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900">{submitting ? 'Submitting…' : 'Submit'}</button><button type="button" disabled={submitting} on:click={cancel} class="rounded-xl bg-gray-200 px-3 py-2 disabled:opacity-50 dark:bg-gray-800">Cancel</button></div>
				</form>
			{:else if detailLoading}<p>Loading detail…</p>
			{:else if detailError}<p>{detailError}</p><button type="button" class="mt-2 w-fit rounded-xl bg-gray-200 px-3 py-2 dark:bg-gray-800" on:click={() => openedId && openCompany(openedId)}>Retry</button>
			{:else if detail?.company}
				<div class="mb-2 flex gap-2"><button type="button" class="rounded-xl bg-gray-200 px-2 py-1 dark:bg-gray-800" disabled={submitting} on:click={startEdit}>Edit</button><button type="button" class="rounded-xl bg-gray-200 px-2 py-1 dark:bg-gray-800" disabled={submitting} on:click={startNote}>Add note</button></div>
				<h2 class="font-semibold">{detail.company.name}</h2>
                <div class="my-3 flex flex-wrap gap-2"><button class="rounded-lg bg-gray-100 px-2 py-1.5 text-xs dark:bg-gray-800" on:click={()=>askStarli('Create a sales opportunity for my CRM company '+detail.company.id+'. Ask only for missing essential details.')}>New opportunity in chat</button><button class="rounded-lg bg-gray-100 px-2 py-1.5 text-xs dark:bg-gray-800" on:click={()=>askStarli('Create a follow-up task for my CRM company '+detail.company.id+'.')}>Add task in chat</button><button class="rounded-lg bg-gray-100 px-2 py-1.5 text-xs dark:bg-gray-800" on:click={()=>askStarli('Show my current sales pipeline and help me update its stages.')}>Sales pipeline</button></div>
				<p class="text-xs text-gray-500">{detail.company.status || ''} {detail.company.industry || ''} · v{detail.company.version ?? '—'}</p>
				<p>{detail.company.email || ''} {detail.company.phone || ''}</p>
				{#if detail.company.website}<p>{detail.company.website}</p>{/if}
				{#if detail.company.domain}<p>{detail.company.domain}</p>{/if}
				<h3 class="mt-3 text-xs font-semibold uppercase text-gray-500">Contacts</h3>
				<ul>{#each detail.contacts || [] as c}<li>{label(c)}</li>{:else}<li>None</li>{/each}</ul>
				<h3 class="mt-3 text-xs font-semibold uppercase text-gray-500">Opportunities</h3>
                <ul>{#each detail.opportunities || [] as opportunity}<li class="py-1"><button class="text-left hover:underline" on:click={()=>askStarli('Read my CRM opportunity '+opportunity.id+' and help me update it using its current version.')}>{opportunity.title} · {opportunity.status} · {opportunity.amount??opportunity.expectedValue??0} {opportunity.currency??''}</button></li>{:else}<li>None</li>{/each}</ul>
                <h3 class="mt-3 text-xs font-semibold uppercase text-gray-500">Tasks</h3>
				<ul>{#each detail.tasks || [] as c}<li class="py-1"><button class="text-left hover:underline" on:click={()=>askStarli('Read my CRM task '+c.id+' and help me update or complete it using its current version.')}>{label(c)}</button></li>{:else}<li>None</li>{/each}</ul>
				<h3 class="mt-3 text-xs font-semibold uppercase text-gray-500">Interactions</h3>
				<ul>{#each detail.interactions || [] as c}<li>{label(c)}</li>{:else}<li>None</li>{/each}</ul>
			{:else}<p class="text-gray-500">Select a company.</p>{/if}
		</aside>
	</div>
</section>
