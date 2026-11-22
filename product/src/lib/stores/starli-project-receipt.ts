import {writable} from 'svelte/store';
import type {PreviewReceipt} from '$lib/utils/starli-project-receipt';
/** In-memory active native panel expectation, cleared on account/chat/session change. */
export const activePreviewReceipt=writable<{ownerId:string;receipt:PreviewReceipt}|null>(null);
export const invalidPreviewBuild=writable('');
