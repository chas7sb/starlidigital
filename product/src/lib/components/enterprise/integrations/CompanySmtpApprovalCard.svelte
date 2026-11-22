<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { CompanySmtpClient, type SmtpApproval } from './company-smtp-client';
	import '../automations/automations.css';

	export let companyId: string;
	export let actorId: string;
	export let conversationId: string;
	export let approvalId: string;
	export let requestingBotId: string;
	export let accessSignal: AbortSignal;

	let client: CompanySmtpClient | null = null;
	let approval: SmtpApproval | null = null;
	let loading = true;
	let busy = false;
	let error = '';
	let consent = false;
	let note = '';
	let showHtml = false;
	let live = true;

	async function load() {
		if (!client || accessSignal.aborted) return;
		loading = true;
		error = '';
		try {
			const value = await client.getApproval(approvalId, conversationId);
			if (!live || accessSignal.aborted) return;
			if (value.botId && value.botId !== requestingBotId) {
				throw Error('The requesting bot scope could not be verified.');
			}
			approval = value;
			if (value.draft?.htmlBody && !showHtml) {
				showHtml = true;
			}
		} catch (cause) {
			if (live) error = cause instanceof Error ? cause.message : 'Unable to load SMTP review request.';
		} finally {
			if (live) loading = false;
		}
	}

	async function decide(decision: 'APPROVE' | 'REJECT') {
		if (!client || busy || !approval || approval.state !== 'PENDING' || accessSignal.aborted) return;
		if (decision === 'APPROVE' && !consent) return;
		const snapshotHash = approval.reviewHash;
		busy = true;
		error = '';
		try {
			const next = await client.decideApproval(approval.id, decision, snapshotHash, conversationId, note);
			if (!live || accessSignal.aborted) return;
			approval = next;
			consent = false;
		} catch (cause) {
			if (live) error = cause instanceof Error ? cause.message : 'Could not record SMTP decision.';
		} finally {
			if (live) busy = false;
		}
	}

	async function sendNow() {
		if (!client || busy || !approval || approval.state !== 'APPROVED' || accessSignal.aborted) return;
		busy = true;
		error = '';
		try {
			const res = await client.sendApproval(
				approval.id,
				`ui-send-${approval.id}`,
				conversationId
			);
			if (!live || accessSignal.aborted) return;
			approval = res.approval;
		} catch (cause) {
			if (live) {
				error = cause instanceof Error ? cause.message : 'Could not execute SMTP send.';
				await load().catch(() => {});
			}
		} finally {
			if (live) busy = false;
		}
	}

	function revoked() {
		live = false;
		client?.close();
		approval = null;
		consent = false;
	}

	const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleString();

	onMount(() => {
		if (!actorId || accessSignal.aborted) return;
		client = new CompanySmtpClient(companyId, () => localStorage.getItem('token') || '', accessSignal);
		accessSignal.addEventListener('abort', revoked, { once: true });
		void load();
	});

	onDestroy(() => {
		revoked();
		accessSignal?.removeEventListener('abort', revoked);
	});
</script>

<section class="starli-automations smtp-review-card" aria-label="Email approval review">
	<div class="sa-heading">
		<div>
			<span class="sa-eyebrow">COMPANY SMTP APPROVAL</span>
			<h3>Review outbound email</h3>
		</div>
		<button type="button" disabled={busy || loading} on:click={() => void load()}>Refresh</button>
	</div>

	{#if loading && !approval}
		<p class="sa-muted" role="status">Checking email draft & recipients…</p>
	{/if}
	{#if error}
		<p class="sa-error" role="alert">{error}</p>
	{/if}

	{#if approval?.draft}
		<dl class="smtp-review-fields">
			<div>
				<dt>Connection</dt>
				<dd>{approval.connectionName} ({approval.connectionHost}:{approval.connectionPort} · rev {approval.connectionRevision})</dd>
			</div>
			<div>
				<dt>From</dt>
				<dd>{approval.draft.senderName ? `${approval.draft.senderName} <${approval.draft.senderEmail}>` : approval.draft.senderEmail}</dd>
			</div>
			<div>
				<dt>To</dt>
				<dd>{approval.draft.to.join(', ')}</dd>
			</div>
			{#if approval.draft.cc.length}
				<div>
					<dt>Cc</dt>
					<dd>{approval.draft.cc.join(', ')}</dd>
				</div>
			{/if}
			{#if approval.draft.bcc.length}
				<div>
					<dt>Bcc (envelope only)</dt>
					<dd>{approval.draft.bcc.join(', ')}</dd>
				</div>
			{/if}
			<div>
				<dt>Subject</dt>
				<dd><strong>{approval.draft.subject}</strong></dd>
			</div>
		</dl>

		{#if approval.draft.htmlBody}
			<div class="body-tabs">
				<button type="button" class:active={showHtml} on:click={() => (showHtml = true)}>Sanitized HTML preview</button>
				<button type="button" class:active={!showHtml} on:click={() => (showHtml = false)}>Plain text</button>
			</div>
			{#if showHtml}
				<iframe
					class="html-sandbox"
					sandbox=""
					title="Sanitized HTML email preview"
					srcdoc={`<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.6;color:#17233b;margin:12px;">${approval.draft.htmlBody}</body></html>`}
				></iframe>
			{:else}
				<pre class="smtp-text-body">{approval.draft.textBody}</pre>
			{/if}
		{:else}
			<pre class="smtp-text-body">{approval.draft.textBody}</pre>
		{/if}

		<p class="sa-muted smtp-meta-line">
			State: <strong>{approval.state.replaceAll('_', ' ')}</strong> · Expires {fmtDate(approval.expiresAt)}
		</p>

		{#if approval.state === 'PENDING'}
			{#if !approval.connectionActive}
				<p class="sa-warning">The bound SMTP connection is revoked or updated. This approval can no longer send.</p>
			{:else}
				<label class="consent">
					<input type="checkbox" bind:checked={consent} disabled={busy} />
					<span>I reviewed the exact sender, recipients (To/Cc/Bcc), subject, and message content above.</span>
				</label>
				<label class="sa-label">
					Optional decision note
					<input class="sa-input" type="text" maxlength="500" bind:value={note} placeholder="Approved for sending" disabled={busy} />
				</label>
				<div class="sa-actions smtp-actions-row">
					<button class="sa-primary" type="button" disabled={!consent || busy} on:click={() => void decide('APPROVE')}>
						{busy ? 'Recording…' : 'Approve exact email'}
					</button>
					<button class="sa-danger" type="button" disabled={busy} on:click={() => void decide('REJECT')}>
						Reject
					</button>
				</div>
			{/if}
		{:else if approval.state === 'APPROVED'}
			<p class="sa-success smtp-status-box">
				Approved by reviewer at {approval.decidedAt ? fmtDate(approval.decidedAt) : 'now'}.
			</p>
			<div class="sa-actions">
				<button class="sa-primary" type="button" disabled={busy || !approval.connectionActive} on:click={() => void sendNow()}>
					{busy ? 'Sending over TLS SMTP…' : 'Send approved email'}
				</button>
			</div>
		{:else if approval.state === 'SMTP_ACCEPTED'}
			<div class="sa-success smtp-status-box" role="status">
				<strong>SMTP server accepted this email</strong>
				{#if approval.receipt?.messageIdHeader} · Message-ID {approval.receipt.messageIdHeader}{/if}
				{#if approval.receipt?.tlsProtocol} · {approval.receipt.tlsProtocol}{/if}
				<div class="sa-muted">Note: SMTP acceptance confirms relay handoff only; final recipient inbox delivery is not verified by SMTP.</div>
			</div>
		{:else if approval.state === 'UNCERTAIN' || approval.state === 'SENDING'}
			<p class="sa-warning">
				SMTP outcome is uncertain ({approval.receipt?.errorCode || 'INTERRUPTED'}). Automatic retry is disabled to prevent duplicate mail; verify with recipient before creating a new draft.
			</p>
		{:else if approval.state === 'REJECTED'}
			<p class="sa-error">Rejected by reviewer — no email was sent.</p>
		{:else if approval.state === 'EXPIRED'}
			<p class="sa-warning">Approval expired — no email was sent.</p>
		{:else}
			<p class="sa-warning">{approval.decisionNote || 'This SMTP request is closed and did not send.'}</p>
		{/if}
	{/if}
</section>

<style>
	.smtp-review-card {
		margin: 16px 0;
		padding: 18px;
		border: 1px solid #dfe7f2;
		border-radius: 12px;
		background: #fff;
		white-space: normal;
	}
	.smtp-review-card h3 {
		margin: 4px 0 0;
		font-size: 15px;
		color: #17233b;
	}
	.smtp-review-fields {
		display: grid;
		gap: 8px;
		margin: 12px 0;
		padding: 12px;
		background: #f8faff;
		border: 1px solid #e2e8f0;
		border-radius: 9px;
	}
	.smtp-review-fields > div {
		display: grid;
		grid-template-columns: 125px minmax(0, 1fr);
		gap: 8px;
		font-size: 12px;
	}
	.smtp-review-fields dt {
		color: #64748b;
		font-weight: 500;
	}
	.smtp-review-fields dd {
		margin: 0;
		color: #17233b;
		overflow-wrap: anywhere;
	}
	.body-tabs {
		display: flex;
		gap: 6px;
		margin-bottom: 8px;
	}
	.body-tabs button {
		border: 1px solid #d5dfef;
		border-radius: 7px;
		background: #fff;
		padding: 5px 10px;
		font-size: 11px;
		color: #475569;
	}
	.body-tabs button.active {
		background: #eff6ff;
		color: #1d4ed8;
		border-color: #93c5fd;
		font-weight: 600;
	}
	.html-sandbox {
		width: 100%;
		min-height: 150px;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		background: #fff;
	}
	.smtp-text-body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		background: #f8faff;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 12px;
		margin: 0;
		font-family: inherit;
		font-size: 13px;
		line-height: 1.6;
		color: #17233b;
	}
	.smtp-meta-line {
		margin: 10px 0;
	}
	.consent {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 12px;
		line-height: 1.5;
		margin: 12px 0;
	}
	.consent input {
		margin-top: 3px;
		accent-color: #2563eb;
	}
	.smtp-actions-row {
		margin-top: 12px;
	}
	.smtp-status-box {
		padding: 10px 12px;
		border-radius: 8px;
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #065f46;
		font-size: 12px;
		margin-bottom: 10px;
	}
	@media (max-width: 600px) {
		.smtp-review-fields > div {
			grid-template-columns: 1fr;
			gap: 2px;
		}
	}
</style>
