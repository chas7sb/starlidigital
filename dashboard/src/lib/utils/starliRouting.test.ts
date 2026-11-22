import { describe, expect, it } from 'vitest';
import { isCurrentStarliConversation, parseDirectedStarliMessage } from './starliRouting';

describe('STARLI V3 autonomous routing', () => {
    it('must not steer the previous Boss while creating the first Agent1 chat', () => {
        expect(isCurrentStarliConversation('', 'boss-chat')).toBe(false);
        expect(isCurrentStarliConversation(null, 'boss-chat')).toBe(false);
    });
    it('must not steer Boss while switching to an existing Agent1 chat', () => {
        expect(isCurrentStarliConversation('agent1-chat', 'boss-chat')).toBe(false);
    });
    it('allows steering only when the chat IDs match', () => {
        expect(isCurrentStarliConversation('boss-chat', 'boss-chat')).toBe(true);
        expect(isCurrentStarliConversation('agent1-chat', 'agent1-chat')).toBe(true);
    });
    it('detects explicit directed messages before steering', () => {
        expect(parseDirectedStarliMessage('/message AGENT1 Fix the runtime')).toEqual({
            recipient: 'AGENT1', message: 'Fix the runtime'
        });
        expect(parseDirectedStarliMessage('@AGENT1 Please inspect logs')).toEqual({
            recipient: 'AGENT1', message: 'Please inspect logs'
        });
    });
    it('does not reinterpret ordinary Boss instructions as direct messages', () => {
        expect(parseDirectedStarliMessage('Keep working autonomously')).toBe(null);
        expect(parseDirectedStarliMessage('/steer Switch priorities')).toBe(null);
        expect(parseDirectedStarliMessage('/auto off')).toBe(null);
    });
});
