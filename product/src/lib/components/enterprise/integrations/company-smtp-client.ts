export type SmtpTlsMode = 'implicit_tls' | 'required_starttls';

export interface SmtpConnection {
	id: string;
	connectionId: string;
	name: string;
	host: string;
	port: 465 | 587;
	tlsMode: SmtpTlsMode;
	username: string;
	passwordConfigured: boolean;
	senderEmail: string;
	senderName: string;
	status: 'ACTIVE' | 'REVOKED';
	revision: number;
	lastTestStatus: 'PASSED' | 'FAILED' | null;
	lastTestCode: string | null;
	lastTestAt: number | null;
	revokedAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface SmtpDraft {
	id: string;
	draftId: string;
	connectionId: string;
	connectionRevision: number;
	sourceConversationId: string;
	botId: string;
	actorUserId: string;
	senderEmail: string;
	senderName: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	textBody: string;
	htmlBody: string | null;
	hasHtml: boolean;
	reviewHash: string;
	state: string;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface SmtpReceipt {
	id: string;
	receiptId: string;
	approvalId: string;
	draftId: string;
	connectionId: string;
	connectionRevision: number;
	sourceConversationId: string;
	botId: string;
	actorUserId: string;
	approverUserId: string;
	reviewHash: string;
	idempotencyKey: string;
	status: 'SENDING' | 'SMTP_ACCEPTED' | 'SMTP_REFUSED' | 'FAILED_PRE_SEND' | 'UNCERTAIN';
	smtpAccepted: boolean | null;
	deliveryVerified: boolean;
	retryAllowed: boolean;
	attemptCount: number;
	smtpCode: number | null;
	smtpMessage: string | null;
	errorCode: string | null;
	messageIdHeader: string | null;
	resolvedIp: string | null;
	tlsProtocol: string | null;
	tlsCipher: string | null;
	createdAt: number;
	completedAt: number | null;
}

export interface SmtpApproval {
	id: string;
	approvalId: string;
	companyId: string;
	draftId: string;
	draftRevision: number;
	connectionId: string;
	connectionRevision: number;
	connectionName: string;
	connectionHost: string;
	connectionPort: number | null;
	connectionTlsMode: string;
	connectionActive: boolean;
	sourceConversationId: string;
	botId: string;
	actorUserId: string;
	assistantMessageId: string | null;
	reviewHash: string;
	state:
		| 'PENDING'
		| 'APPROVED'
		| 'REJECTED'
		| 'EXPIRED'
		| 'SENDING'
		| 'SMTP_ACCEPTED'
		| 'SMTP_REFUSED'
		| 'FAILED_PRE_SEND'
		| 'UNCERTAIN'
		| 'CANCELLED';
	approverUserId: string | null;
	decisionNote: string | null;
	decidedAt: number | null;
	expiresAt: number;
	createdAt: number;
	updatedAt: number;
	draft: SmtpDraft | null;
	receipt: SmtpReceipt | null;
	deliveryVerified: boolean;
}

export interface SmtpDashboard {
	version: string;
	companyId: string;
	connections: SmtpConnection[];
	approvals: SmtpApproval[];
	receipts: SmtpReceipt[];
	actions: { canManage: boolean };
	policy: {
		supportedPorts: number[];
		tlsModes: SmtpTlsMode[];
		plaintextAllowed: boolean;
	};
}

export interface SmtpConnectionFormInput {
	name: string;
	host: string;
	port: 465 | 587;
	tlsMode: SmtpTlsMode;
	username: string;
	password: string;
	senderEmail: string;
	senderName: string;
}

const VERSION = 'starli.company-smtp.v1';

const MESSAGES: Record<string, string> = {
	NATIVE_BEARER_REQUIRED: 'Sign in again to manage company SMTP integrations.',
	NATIVE_JWT_REQUIRED: 'Your workspace session could not be verified.',
	COMPANY_PERMISSION_DENIED: 'A company administrator must perform this action.',
	PRIVATE_DESTINATION_DENIED: 'Private, loopback, or internal SMTP hostnames and IPs are blocked for security.',
	SMTP_HOSTNAME_REQUIRED: 'Enter an external DNS hostname (not an IP address) so TLS certificates verify properly.',
	SMTP_HOST_INVALID: 'Enter a valid SMTP server domain name such as smtp.gmail.com.',
	SMTP_TLS_POLICY_DENIED: 'Only Implicit TLS on port 465 or Required STARTTLS on port 587 are supported.',
	SMTP_STARTTLS_REQUIRED: 'The SMTP server did not advertise STARTTLS; plaintext fallback is never allowed.',
	TLS_CERTIFICATE_INVALID: 'The SMTP server TLS certificate is invalid, untrusted, or does not match the hostname.',
	SMTP_TLS_HANDSHAKE_FAILED: 'Could not complete a secure TLS handshake with the SMTP server.',
	SMTP_AUTH_FAILED: 'SMTP authentication failed. Check the username, password, or app password.',
	SMTP_CONNECT_TIMEOUT: 'Timed out waiting for the SMTP server.',
	SMTP_CONNECT_FAILED: 'Could not connect to the SMTP server on the specified hostname and port.',
	SMTP_DNS_RESOLUTION_FAILED: 'Could not resolve DNS for that SMTP hostname.',
	SMTP_CONNECTION_REVOKED: 'This SMTP connection was revoked. Reconfigure an active connection before sending.',
	CREDENTIAL_REVISION_CHANGED: 'SMTP credentials changed after review. Request fresh approval before sending.',
	SMTP_REVIEW_CHANGED: 'The email review details changed. Refresh and review again before acting.',
	SMTP_APPROVAL_EXPIRED: 'This approval expired before the email was sent.',
	SMTP_APPROVAL_REJECTED: 'This email draft was rejected and cannot be sent.',
	SMTP_APPROVAL_NOT_PENDING: 'This approval decision has already been recorded.',
	SMTP_APPROVAL_ALREADY_SENT: 'This approved email was already sent.',
	SMTP_SEND_UNCERTAIN: 'The SMTP outcome became uncertain after transmission started; automatic retry is disabled.',
	SMTP_SEND_UNCERTAIN_NO_RETRY: 'A prior send attempt is already uncertain; inspect the Sent mailbox rather than retrying.',
	REVISION_CONFLICT: 'The SMTP connection was modified elsewhere. Refresh and try again.'
};

export class SmtpError extends Error {
	status: number;
	code: string;
	receipt: SmtpReceipt | null;

	constructor(status: number, code: string, message: string, receipt: SmtpReceipt | null = null) {
		super(message);
		this.name = 'SmtpError';
		this.status = status;
		this.code = code;
		this.receipt = receipt;
	}
}

export class CompanySmtpClient {
	private companyId: string;
	private token: () => string;
	private controller = new AbortController();

	constructor(companyId: string, token: () => string, externalSignal?: AbortSignal) {
		this.companyId = companyId;
		this.token = token;
		if (externalSignal) {
			if (externalSignal.aborted) {
				this.controller.abort();
			} else {
				externalSignal.addEventListener('abort', () => this.close(), { once: true });
			}
		}
	}

	close(): void {
		this.controller.abort();
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const bearer = this.token();
		if (!bearer) {
			throw new SmtpError(401, 'NATIVE_BEARER_REQUIRED', MESSAGES.NATIVE_BEARER_REQUIRED);
		}
		const url = `/api/v1/starli/companies/${encodeURIComponent(this.companyId)}/integrations/smtp${path}`;
		const res = await fetch(url, {
			...init,
			signal: this.controller.signal,
			cache: 'no-store',
			headers: {
				Authorization: `Bearer ${bearer}`,
				...(init.body ? { 'Content-Type': 'application/json' } : {}),
				...(init.headers || {})
			}
		});
		const text = await res.text();
		let parsed: any = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = null;
		}
		if (!res.ok) {
			const detail = parsed?.detail;
			const code = typeof detail?.code === 'string' ? detail.code : 'SMTP_REQUEST_FAILED';
			const receipt = (detail?.receipt as SmtpReceipt | undefined) || null;
			throw new SmtpError(res.status, code, MESSAGES[code] || `SMTP request failed (${code}).`, receipt);
		}
		if (!parsed || parsed.version !== VERSION || parsed.companyId !== this.companyId) {
			throw new SmtpError(502, 'SMTP_RESPONSE_SCOPE_INVALID', 'Unexpected company SMTP response scope.');
		}
		return parsed as T;
	}

	async dashboard(): Promise<SmtpDashboard> {
		return this.request<SmtpDashboard>('/connections');
	}

	async createConnection(input: SmtpConnectionFormInput): Promise<SmtpConnection> {
		const res = await this.request<{ connection: SmtpConnection }>('/connections', {
			method: 'POST',
			body: JSON.stringify(input)
		});
		return res.connection;
	}

	async updateConnection(
		connectionId: string,
		expectedRevision: number,
		input: Omit<SmtpConnectionFormInput, 'password'> & { password?: string }
	): Promise<SmtpConnection> {
		const payload: Record<string, unknown> = {
			expectedRevision,
			name: input.name,
			host: input.host,
			port: input.port,
			tlsMode: input.tlsMode,
			username: input.username,
			senderEmail: input.senderEmail,
			senderName: input.senderName
		};
		if (input.password && input.password.length > 0) {
			payload.password = input.password;
		}
		const res = await this.request<{ connection: SmtpConnection }>(
			`/connections/${encodeURIComponent(connectionId)}`,
			{
				method: 'PUT',
				body: JSON.stringify(payload)
			}
		);
		return res.connection;
	}

	async testConnection(
		connectionId: string
	): Promise<{ connection: SmtpConnection; test: { tested: boolean; messageSent: boolean; tlsProtocol?: string; tlsCipher?: string; smtpCode?: number } }> {
		return this.request(`/connections/${encodeURIComponent(connectionId)}/test`, {
			method: 'POST',
			body: '{}'
		});
	}

	async revokeConnection(connectionId: string, expectedRevision: number): Promise<SmtpConnection> {
		const res = await this.request<{ connection: SmtpConnection }>(
			`/connections/${encodeURIComponent(connectionId)}/revoke`,
			{
				method: 'POST',
				body: JSON.stringify({ expectedRevision })
			}
		);
		return res.connection;
	}

	async getApproval(approvalId: string, conversationId?: string): Promise<SmtpApproval> {
		const qs = conversationId ? `?sourceConversationId=${encodeURIComponent(conversationId)}` : '';
		const res = await this.request<{ approval: SmtpApproval }>(
			`/approvals/${encodeURIComponent(approvalId)}${qs}`
		);
		return res.approval;
	}

	async decideApproval(
		approvalId: string,
		decision: 'APPROVE' | 'REJECT',
		expectedReviewHash: string,
		conversationId?: string,
		note?: string
	): Promise<SmtpApproval> {
		const payload: Record<string, unknown> = {
			decision,
			expectedReviewHash
		};
		if (conversationId) payload.sourceConversationId = conversationId;
		if (note && note.trim()) payload.note = note.trim();
		const res = await this.request<{ approval: SmtpApproval }>(
			`/approvals/${encodeURIComponent(approvalId)}/decision`,
			{
				method: 'POST',
				body: JSON.stringify(payload)
			}
		);
		return res.approval;
	}

	async sendApproval(approvalId: string, idempotencyKey: string, conversationId?: string): Promise<{ approval: SmtpApproval; receipt: SmtpReceipt; idempotentReplay: boolean }> {
		const payload: Record<string, unknown> = { idempotencyKey };
		if (conversationId) payload.sourceConversationId = conversationId;
		return this.request(`/approvals/${encodeURIComponent(approvalId)}/send`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});
	}
}
