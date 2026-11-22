/** Prevent a previously active agent chat from intercepting a new chat's first message. */
export const isCurrentStarliConversation = (loadedChatId: string | null | undefined, activeChatId: string | null | undefined): boolean =>
    Boolean(loadedChatId && activeChatId && loadedChatId === activeChatId);

/** Explicit, single-recipient operator command. Ordinary text is never retargeted. */
export const parseDirectedStarliMessage = (input: unknown): { recipient: string; message: string } | null => {
    if (typeof input !== 'string') return null;
    const match = input.trim().match(/^(?:\/message\s+|@)([^\s]+)\s+([\s\S]+)$/i);
    return match ? { recipient: match[1], message: match[2].trim() } : null;
};
