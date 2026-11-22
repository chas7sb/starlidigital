# Enterprise mention and member components — 15 November 2026

Only new messaging components and local verification files were changed. Root owns route/header/sidebar/send integration; agent12 owns native room roster and bot membership endpoints. No product messages or participant changes were made by this lane.

## MentionComposer.svelte
Required props: people, bots (actual authorized company directory entries id/name plus optional role/email), currentRoom, draft, accessSignal. Optional: mentionRanges, disabled, busy, working, stopping, placeholder. Slot tools: existing root-owned plus/actions control.

Events:
- draft {roomId,draft,mentions,mentionRanges}. Parent should keep draft+mentionRanges together per conversation and ignore events for a stale room. Mentions use native kinds human/agent and canonical IDs. Text copied/pasted without a selected mention does not fabricate identity bindings.
- send {roomId,draft,content,mentions,dispatchAgentIds,mentionRanges}. This component does NOT POST, allocate request IDs, clear after success, join bots or invoke tools. Parent owns fresh authorization, room admission and exactly-once/idempotent delivery. Parent may perform supported native admission for explicitly mentioned bots before dispatching them into a private DM. All selected bot IDs are emitted; no silent truncation to an older dispatch ceiling. Backend capacity/permission errors must retain the draft.
- stop {roomId}. Parent owns exact-run cancellation.

Keyboard: @query at caret including multiword names; excludes email-style at-signs; Up/Down wrap, Enter/Tab select, Esc dismiss, Shift+Enter newline, IME Enter never sends. Selection preserves text after caret. Anchored ranges shift for edits before a mention and drop when the selected label/boundary is edited or identity disappears. Duplicate mentions deduplicate native ID metadata. Scope abort clears tokens/draft/menu and disables input.

## RoomMembersPane.svelte
Props: companyId, actorId, accessSignal; currentRoom or explicit roomId. Optional stable membersApi port (bind once per actual company/session, not a fresh object on every parent render).

The pane always verifies native company capabilities and GET /api/v1/starli/companies/{c}/messaging/rooms/{r}. Existing room.agentIds is NOT a complete human roster and is never used as one. Without a roster adapter it shows actual room name/visibility and an honest unavailable-members state. No invented online/presence indicators.

membersApi contract:
- snapshot(roomId,signal) => {companyId,roomId,revision,members:[{id,kind:'human'|'agent',name,canRemove:boolean,role?:string}],canManageMembers:boolean}
- remove(roomId,{id,kind},freshRevision,signal) => actual native removal receipt; after it returns, a fresh snapshot must show that participant absent before the UI reports removal.
The trusted assembly maps actual backend12 DTOs/endpoints into this shape; this shape itself grants no permission. The component validates company/room/unique identities, uses only fresh server removal flags, blocks self-removal, confirms the chosen participant, rechecks before writing, and never retries/removes optimistically. Parent must bind correct human vs bot endpoint; no route guessed in this component.

Events: loaded/changed {companyId,roomId,room,roster}; close; denied {status}. Parent can use verified roster count/avatar identities for its #name/chevron/header stack. Parent owns unread/read receipts and direct-sidebar list.

## Verification
- Both Svelte components compile with0warnings.
- verify-mentions.cjs:9 actual caret/range/event tests PASS.
- verify-mention-browser.cjs:5 isolated headless Chrome journeys on actual Vite component PASS: native person/bot structured metadata, keyboard, Escape+ShiftEnter, mid-text caret preservation, abort clears/disables;0APIrequests,0browsererrors. Not a product-user session or real message send.
- verify-member-functions.cjs:8 actual controller/typed-port tests PASS: cross-company/duplicate rejection, strips presence fields, uses fresh revision, no unauthorized/self removal, abort blocks late roster, no false removal success, session cleanup.
- Live native roster/add/remove acceptance remains pending backend12 contract/adapter. Do not label participant management production-ready based only on these tests.

## /app wiring update — 15 November 2026

Direct Alex request authorized finishing actual mentions, bot admission and removal. Ultra Bo$$ explicitly released /app route to this frontend lane for narrow wiring, preserving its current multi-panel host/resources/account routes. Native RoomMembersApi now in native-room-members.ts binds the exact agent12 candidate contract: GET participants; PUT/DELETE agents; existing DELETE human members. It never invents human canKick from createdBy or role. Missing participants endpoint with readable room becomes a503 unavailable state, not a false room revocation.

/app now mounts MentionComposer, persists per-conversation text and mention ranges, builds idempotency fingerprints from exact content+native IDs, and dispatches only explicit bot targets (ordinary canonical bot-DM chat retains the already-present primary bot). Human DMs use the native direct-messages endpoint. Selected room #name/description/avatar count opens RoomMembersPane through the preserved PanelWorkspace. Added bot chooser/removal use verified native receipts and a fresh participant read. Message auto-join belongs to agent12's native send transaction; parent does not do a separate speculative join before message admission. Activity access denial rechecks readable room so removing a bot does not clear the authorized human transcript or fabricate CANCELLED.

Actual room index drives channel unread counts; current visible chat marks only actually loaded sequence read and refetches native unread value. Human-DM mappings come from authorized participants, not guessed room names. Directory refresh removes stale company people/bots. All scoped caches and mention drafts clear on revocation.

Joined /app controlled-browser acceptance: actual new route in isolated headless Chrome with all API requests intercepted by a native-contract fixture. Human DM selection, typed @Agata native mention/dispatch, members-pane bot removal, explicit bot add, permission-approved human removal and uncertain send retry with SAME IdempotencyKey passed. MultiPanelWorkspace preserved;0browsererrors,0realaccountwrites/modelcalls. app-messaging-browser-receipt.json is controlled evidence, NOT live membership acceptance.

New native adapter8 tests pass; shared services12 tests pass; /app and2components compile0warnings. Previous22 component/controller/browser checks retained. Live native member API acceptance remains pending root activation and authenticated tests with credentials held only by root; this lane will not infer/reuse a changed password. Existing native participant API was not active at initial source inspection. Backend12 must provide fresh human canKick metadata; until then removal is gated off for humans, rather than guessed.
