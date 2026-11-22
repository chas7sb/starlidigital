<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import {
		CompanySmtpClient,
		SmtpError,
		type SmtpApproval,
		type SmtpConnection,
		type SmtpReceipt,
		type SmtpTlsMode
	} from './company-smtp-client';
	import '../automations/automations.css';

	export let companyId: string;
	export let actorId: string;
	export let accessSignal: AbortSignal;
	export let compact = false;

	const dispatch = createEventDispatcher<{ close: void; denied: { status: number } }>();

	let client: CompanySmtpClient | undefined;
	let watched: AbortSignal | undefined;
	let mounted = false;
	let scopeKey = '';
	let gen = 0;

	let loading = true;
	let busy = false;
	let testingId = '';
	let error = '';
	let notice = '';

	let connections: SmtpConnection[] = [];
	let approvals: SmtpApproval[] = [];
	let receipts: SmtpReceipt[] = [];
	let canManage = false;

	// Secure form state (password is never populated from server and is cleared immediately after save)
	let showForm = false;
	let editingConnection: SmtpConnection | null = null;
	let revokingConnection: SmtpConnection | null = null;

	let name = '';
	let host = '';
	let port: 465 | 587 = 465;
	let tlsMode: SmtpTlsMode = 'implicit_tls';
	let username = '';
	let password = '';
	let senderEmail = '';
	let senderName = '';

	$: if (mounted && (scopeKey !== `${companyId}\0${actorId}` || watched !== accessSignal)) {
		teardown();
		scopeKey = `${companyId}\0${actorId}`;
		watched = accessSignal;
		if (watched.aborted) {
			dispatch('close');
		} else {
			watched.addEventListener('abort', onLost, { once: true });
			client = new CompanySmtpClient(companyId, () => localStorage.getItem('token') || '', watched);
			void load();
		}
	}

	function teardown() {
		gen++;
		client?.close();
		client = undefined;
		connections = [];
		approvals = [];
		receipts = [];
		canManage = false;
		password = '';
		error = '';
		notice = '';
	}

	function onLost() {
		teardown();
		dispatch('close');
	}

	function handlePortChange() {
		tlsMode = Number(port) === 465 ? 'implicit_tls' : 'required_starttls';
	}

	function handleTlsChange() {
		port = tlsMode === 'implicit_tls' ? 465 : 587;
	}

	function openCreateForm() {
		editingConnection = null;
		name = '';
		host = '';
		port = 465;
		tlsMode = 'implicit_tls';
		username = '';
		password = '';
		senderEmail = '';
		senderName = '';
		showForm = true;
		error = '';
		notice = '';
	}

	function openEditForm(conn: SmtpConnection) {
		editingConnection = conn;
		name = conn.name;
		host = conn.host;
		port = conn.port;
		tlsMode = conn.tlsMode;
		username = conn.username;
		password = '';
		senderEmail = conn.senderEmail;
		senderName = conn.senderName || '';
		showForm = true;
		error = '';
		notice = '';
	}

	function cancelForm() {
		showForm = false;
		editingConnection = null;
		password = '';
	}

	async function load() {
		if (!client) return;
		const runGen = gen;
		loading = true;
		error = '';
		try {
			const data = await client.dashboard();
			if (runGen !== gen) return;
			connections = data.connections;
			approvals = data.approvals;
			receipts = data.receipts;
			canManage = data.actions.canManage;
			if (!connections.some((c) => c.status === 'ACTIVE') && !editingConnection) {
				showForm = true;
			}
		} catch (cause) {
			if (runGen !== gen) return;
			if (cause instanceof SmtpError && (cause.status === 401 || cause.status === 403)) {
				dispatch('denied', { status: cause.status });
				return;
			}
			error = cause instanceof Error ? cause.message : 'Unable to load SMTP connections.';
		} finally {
			if (runGen === gen) loading = false;
		}
	}

	async function saveConnection() {
		if (!client || busy) return;
		const currentClient = client;
		const runGen = gen;
		busy = true;
		error = '';
		notice = '';
		try {
			if (editingConnection) {
				const updated = await currentClient.updateConnection(
					editingConnection.id,
					editingConnection.revision,
					{
						name: name.trim(),
						host: host.trim(),
						port: Number(port) as 465 | 587,
						tlsMode,
						username: username.trim(),
						password,
						senderEmail: senderEmail.trim(),
						senderName: senderName.trim()
					}
				);
				if (runGen !== gen) return;
				password = '';
				showForm = false;
				editingConnection = null;
				notice = `Updated ${updated.name} (revision ${updated.revision}). Credentials encrypted server-side.`;
			} else {
				const created = await currentClient.createConnection({
					name: name.trim(),
					host: host.trim(),
					port: Number(port) as 465 | 587,
					tlsMode,
					username: username.trim(),
					password,
					senderEmail: senderEmail.trim(),
					senderName: senderName.trim()
				});
				if (runGen !== gen) return;
				password = '';
				showForm = false;
				notice = `Connected ${created.name}. Run Test connection to verify DNS, TLS, and SMTP authentication.`;
			}
			await load();
		} catch (cause) {
			if (runGen === gen) {
				error = cause instanceof Error ? cause.message : 'Could not save SMTP connection.';
			}
		} finally {
			if (runGen === gen) busy = false;
		}
	}

	async function testConnection(conn: SmtpConnection) {
		if (!client || busy) return;
		const currentClient = client;
		const runGen = gen;
		busy = true;
		testingId = conn.id;
		error = '';
		notice = '';
		try {
			const res = await currentClient.testConnection(conn.id);
			if (runGen !== gen) return;
			const proto = res.test.tlsProtocol ? ` (${res.test.tlsProtocol})` : '';
			notice = `Verified ${res.connection.name}: DNS, TLS certificate${proto}, and SMTP authentication succeeded. No email was sent.`;
			await load();
		} catch (cause) {
			if (runGen === gen) {
				error = cause instanceof Error ? cause.message : 'SMTP connection test failed.';
				await load().catch(() => {});
			}
		} finally {
			if (runGen === gen) {
				busy = false;
				testingId = '';
			}
		}
	}

	async function confirmRevoke() {
		if (!client || !revokingConnection || busy) return;
		const currentClient = client;
		const target = revokingConnection;
		const runGen = gen;
		busy = true;
		error = '';
		notice = '';
		try {
			await currentClient.revokeConnection(target.id, target.revision);
			if (runGen !== gen) return;
			revokingConnection = null;
			if (editingConnection?.id === target.id) cancelForm();
			notice = `Revoked ${target.name}. Stored credentials were wiped and future sends are blocked.`;
			await load();
		} catch (cause) {
			if (runGen === gen) {
				error = cause instanceof Error ? cause.message : 'Could not revoke SMTP connection.';
			}
		} finally {
			if (runGen === gen) busy = false;
		}
	}

	const fmtTime = (ts: number | null) => (ts ? new Date(ts * 1000).toLocaleString() : '—');
	const tlsLabel = (conn: SmtpConnection) =>
		conn.port === 465 ? 'Port 465 · Implicit TLS' : 'Port 587 · Required STARTTLS';

	onMount(() => {
		mounted = true;
	});
	onDestroy(() => {
		teardown();
	});
</script>

<section class="starli-automations smtp-panel" class:smtp-compact={compact} aria-label="Company SMTP Email Integrations">
	{#if !compact}
		<header class="sa-heading smtp-top">
			<div>
				<span class="sa-eyebrow">COMPANY → INTEGRATIONS</span>
				<h1>Company SMTP email</h1>
				<p class="sa-muted">
					Connect a TLS-enforced company SMTP relay so authorized bots can draft emails and request explicit human approval before sending. No IMAP setup required.
				</p>
			</div>
			<div class="sa-actions">
				<button type="button" disabled={busy || loading} on:click={() => void load()}>Refresh</button>
				{#if canManage && !showForm}
					<button class="sa-primary" type="button" disabled={busy} on:click={openCreateForm}>
						Add SMTP server
					</button>
				{/if}
			</div>
		</header>
	{:else}
		<div class="sa-heading section-heading">
			<div>
				<h2>Company SMTP email</h2>
				<p class="sa-muted">
					Connect your company’s SMTP server (port 465 Implicit TLS or port 587 Required STARTTLS). Passwords are encrypted server-side and never shared with bots.
				</p>
			</div>
			<div class="sa-actions">
				{#if canManage && !showForm}
					<button class="sa-primary" type="button" disabled={busy} on:click={openCreateForm}>
						Add SMTP server
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if error}
		<div class="sa-error" role="alert">{error}</div>
	{/if}
	{#if notice}
		<div class="sa-success smtp-notice" role="status">{notice}</div>
	{/if}

	{#if loading && !connections.length}
		<div class="sa-empty" role="status">Loading company SMTP integrations…</div>
	{:else}
		{#if showForm && canManage}
			<form class="create-form smtp-form" on:submit|preventDefault={() => void saveConnection()}>
				<div class="sa-heading">
					<h3>{editingConnection ? `Edit SMTP connection · ${editingConnection.name}` : 'Connect SMTP server'}</h3>
					<span class="sa-badge">TLS Required</span>
				</div>
				<p class="sa-muted">
					{editingConnection
						? 'Saving changes increments the credential revision and cancels unexecuted drafts bound to the previous revision.'
						: 'Implicit TLS (port 465) and Required STARTTLS (port 587) are supported. Plaintext connections and private/internal IPs are rejected.'}
				</p>

				<div class="smtp-grid">
					<label class="sa-label">
						Connection name
						<input
							class="sa-input"
							type="text"
							bind:value={name}
							maxlength="120"
							placeholder="Sales & Notifications SMTP"
							disabled={busy}
							required
						/>
					</label>

					<label class="sa-label">
						SMTP hostname
						<input
							class="sa-input"
							type="text"
							bind:value={host}
							maxlength="253"
							placeholder="smtp.mailprovider.com"
							disabled={busy}
							required
						/>
					</label>

					<label class="sa-label">
						Port
						<select class="sa-input" bind:value={port} on:change={handlePortChange} disabled={busy}>
							<option value={465}>465 (Implicit TLS)</option>
							<option value={587}>587 (Required STARTTLS)</option>
						</select>
					</label>

					<label class="sa-label">
						TLS mode
						<select class="sa-input" bind:value={tlsMode} on:change={handleTlsChange} disabled={busy}>
							<option value="implicit_tls">Implicit TLS (port 465)</option>
							<option value="required_starttls">Required STARTTLS (port 587)</option>
						</select>
					</label>

					<label class="sa-label">
						SMTP username
						<input
							class="sa-input"
							type="text"
							bind:value={username}
							maxlength="320"
							autocomplete="off"
							placeholder="apikey or user@domain.com"
							disabled={busy}
							required
						/>
					</label>

					<label class="sa-label">
						{editingConnection ? 'New password / app password (leave blank to keep existing)' : 'Password / app password'}
						<input
							class="sa-input"
							type="password"
							bind:value={password}
							maxlength="512"
							autocomplete="new-password"
							placeholder={editingConnection ? '•••••••• (unchanged)' : 'Enter SMTP password or app password'}
							disabled={busy}
							required={!editingConnection}
						/>
					</label>

					<label class="sa-label">
						Sender email
						<input
							class="sa-input"
							type="email"
							bind:value={senderEmail}
							maxlength="320"
							placeholder="notifications@company.com"
							disabled={busy}
							required
						/>
					</label>

					<label class="sa-label">
						Sender display name
						<input
							class="sa-input"
							type="text"
							bind:value={senderName}
							maxlength="120"
							placeholder="Company Workspace"
							disabled={busy}
						/>
					</label>
				</div>

				<div class="sa-actions smtp-form-actions">
					<button type="button" disabled={busy} on:click={cancelForm}>Cancel</button>
					<button class="sa-primary" type="submit" disabled={busy || !name.trim() || !host.trim() || !username.trim() || !senderEmail.trim() || (!editingConnection && !password)}>
						{busy ? 'Saving…' : editingConnection ? 'Save updated credentials' : 'Save encrypted SMTP connection'}
					</button>
				</div>
			</form>
		{/if}

		<div class="integration-grid smtp-cards">
			{#each connections as conn (conn.id)}
				<article class="integration smtp-card" class:smtp-revoked={conn.status === 'REVOKED'}>
					<div class="sa-heading">
						<div>
							<h3>{conn.name}</h3>
							<p class="sa-muted">{conn.host} · {tlsLabel(conn)}</p>
						</div>
						<span class="sa-badge" class:smtp-badge-active={conn.status === 'ACTIVE'}>
							{conn.status === 'ACTIVE' ? `Active · Rev ${conn.revision}` : 'Revoked'}
						</span>
					</div>

					<dl class="smtp-meta">
						<div>
							<dt>From identity</dt>
							<dd>{conn.senderName ? `${conn.senderName} <${conn.senderEmail}>` : conn.senderEmail}</dd>
						</div>
						<div>
							<dt>Auth username</dt>
							<dd>{conn.username}</dd>
						</div>
						<div>
							<dt>Credentials</dt>
							<dd>{conn.passwordConfigured ? 'Encrypted at rest (AES-256-GCM)' : 'Wiped on revocation'}</dd>
						</div>
						<div>
							<dt>Last connection test</dt>
							<dd>
								{#if conn.lastTestStatus === 'PASSED'}
									<span class="smtp-pass">Verified (no email sent)</span> · {fmtTime(conn.lastTestAt)}
								{:else if conn.lastTestStatus === 'FAILED'}
									<span class="smtp-fail">Failed ({conn.lastTestCode})</span> · {fmtTime(conn.lastTestAt)}
								{:else}
									Not tested yet
								{/if}
							</dd>
						</div>
					</dl>

					{#if canManage && conn.status === 'ACTIVE'}
						<div class="sa-actions">
							<button
								type="button"
								disabled={busy}
								on:click={() => void testConnection(conn)}
							>
								{testingId === conn.id ? 'Testing DNS/TLS/AUTH…' : 'Test connection'}
							</button>
							<button type="button" disabled={busy} on:click={() => openEditForm(conn)}>Edit</button>
							<button class="sa-danger" type="button" disabled={busy} on:click={() => (revokingConnection = conn)}>
								Revoke
							</button>
						</div>
						{#if revokingConnection?.id === conn.id}
							<div class="sa-confirm">
								<strong>Revoke this company SMTP connection?</strong>
								<p class="sa-muted">
									Stored password ciphertext is cleared immediately, pending email approvals are cancelled, and bots lose access.
								</p>
								<div class="sa-actions">
									<button type="button" disabled={busy} on:click={() => (revokingConnection = null)}>Keep connection</button>
									<button class="sa-danger" type="button" disabled={busy} on:click={() => void confirmRevoke()}>
										Confirm revoke
									</button>
								</div>
							</div>
						{/if}
					{/if}
				</article>
			{:else}
				<div class="sa-empty">
					<p class="sa-muted">No company SMTP servers are connected yet.</p>
				</div>
			{/each}
		</div>

		{#if !compact && receipts.length > 0}
			<section class="smtp-receipts">
				<h2>Recent SMTP send receipts</h2>
				<p class="sa-muted">
					Each approved email allows at most one send claim. SMTP acceptance (code 250) means the relay accepted the message; SMTP does not guarantee final inbox delivery.
				</p>
				<div class="smtp-receipt-list">
					{#each receipts as rec (rec.id)}
						<div class="smtp-receipt-row">
							<div>
								<strong>{rec.status.replaceAll('_', ' ')}</strong>
								<span class="sa-muted">
									· Approval {rec.approvalId.slice(0, 8)} · Rev {rec.connectionRevision}
									{#if rec.tlsProtocol} · {rec.tlsProtocol}{/if}
									{#if rec.errorCode} · {rec.errorCode}{/if}
								</span>
							</div>
							<span class="sa-badge">
								{#if rec.smtpAccepted === true}
									SMTP Accepted · Inbox Unverified
								{:else if rec.status === 'UNCERTAIN'}
									Uncertain · No Auto-Retry
								{:else}
									Not Accepted
								{/if}
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</section>

<style>
	.smtp-panel {
		max-width: 1040px;
		width: 100%;
		margin: 0 auto;
		padding: 32px 36px;
		overflow: auto;
	}
	.smtp-compact {
		max-width: none;
		padding: 16px 0 0;
		margin-top: 22px;
		border-top: 1px solid #e2e8f0;
	}
	.smtp-top {
		margin-bottom: 20px;
		flex-wrap: wrap;
		gap: 14px;
	}
	.smtp-top h1 {
		margin: 4px 0 6px;
		font-size: 24px;
		font-weight: 650;
		color: #17233b;
	}
	.smtp-notice {
		padding: 12px 14px;
		border-radius: 9px;
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #065f46;
		margin-bottom: 16px;
		font-size: 13px;
	}
	.smtp-form {
		margin-bottom: 24px;
		padding: 20px;
		border: 1px solid #dbe4f2;
		border-radius: 14px;
		background: #f8faff;
	}
	.smtp-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
		margin: 16px 0;
	}
	.smtp-form-actions {
		margin-top: 14px;
	}
	.smtp-cards {
		display: grid;
		gap: 14px;
	}
	.smtp-card {
		border: 1px solid #dfe7f2;
		border-radius: 12px;
		padding: 18px;
		background: #fff;
	}
	.smtp-revoked {
		opacity: 0.72;
		background: #f8fafc;
	}
	.smtp-badge-active {
		background: #eff6ff;
		color: #1d4ed8;
		border-color: #bfdbfe;
	}
	.smtp-meta {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px 16px;
		margin: 14px 0 16px;
	}
	.smtp-meta dt {
		font-size: 11px;
		color: #64748b;
	}
	.smtp-meta dd {
		margin: 2px 0 0;
		font-size: 13px;
		color: #17233b;
		overflow-wrap: anywhere;
	}
	.smtp-pass {
		color: #047857;
		font-weight: 600;
	}
	.smtp-fail {
		color: #b91c1c;
		font-weight: 600;
	}
	.smtp-receipts {
		margin-top: 28px;
	}
	.smtp-receipts h2 {
		font-size: 17px;
		margin: 0 0 6px;
	}
	.smtp-receipt-list {
		display: grid;
		gap: 8px;
		margin-top: 12px;
	}
	.smtp-receipt-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		background: #fff;
		flex-wrap: wrap;
	}
	@media (max-width: 720px) {
		.smtp-panel {
			padding: 20px 16px;
		}
		.smtp-grid,
		.smtp-meta {
			grid-template-columns: 1fr;
		}
	}
</style>
