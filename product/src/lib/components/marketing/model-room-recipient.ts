export function modelRoomRecipient(
 coordinatorId: string,
 roomAgentIds: unknown,
 directory: ReadonlyArray<{ id: string; active?: boolean }>,
 mentions: ReadonlyArray<{ kind: string }>
): string | null {
 if (!coordinatorId || mentions.some(mention => mention.kind === 'agent')) return null;
 if (!Array.isArray(roomAgentIds) || !roomAgentIds.includes(coordinatorId)) return null;
 return directory.some(bot => bot.id === coordinatorId && bot.active !== false) ? coordinatorId : null;
}
