export interface SmtpApprovalHint {
	approvalId: string;
	draftId: string;
	connectionId: string;
	requestingBotId: string;
	assistantMessageId: string;
}

const VALID_ID = /^[A-Za-z0-9._:/-]{1,260}$/;

export function smtpApprovalSelection(
	message: { id: string; speaker?: { kind: string; id: string }; data?: unknown },
	roomId: string,
	companyId: string
): SmtpApprovalHint | null {
	const data = message?.data;
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
	const card = (data as Record<string, unknown>).starliSmtpApproval as Record<string, unknown> | undefined;
	if (!card || typeof card !== 'object') return null;
	if (
		card.version !== 'starli.company-smtp.v1' ||
		card.kind !== 'smtp_approval' ||
		card.companyId !== companyId ||
		card.sourceConversationId !== roomId ||
		card.assistantMessageId !== message.id ||
		message.speaker?.kind !== 'agent' ||
		card.requestingBotId !== message.speaker.id ||
		typeof card.approvalId !== 'string' ||
		!VALID_ID.test(card.approvalId) ||
		typeof card.draftId !== 'string' ||
		!VALID_ID.test(card.draftId) ||
		typeof card.connectionId !== 'string' ||
		!VALID_ID.test(card.connectionId)
	) {
		return null;
	}
	return {
		approvalId: card.approvalId,
		draftId: card.draftId,
		connectionId: card.connectionId,
		requestingBotId: card.requestingBotId,
		assistantMessageId: card.assistantMessageId
	};
}
