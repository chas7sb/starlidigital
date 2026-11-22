# Native graph review card

`AutomationGraphCard.svelte` consumes only authoritative company/room-scoped graph DTOs. `graphSelection` accepts canonical native agent message metadata `starliN8nGraph` with exact company, conversation, bot speaker, assistant message and version binding. Metadata is a lookup hint, never authorization.

Props: companyId, actorId, conversationId, graphId, accessSignal. Events: close, denied {status}.

GET `/api/v1/starli/companies/{company}/automations/graphs/{id}?conversationId={room}`. Human POST `/{id}/run-once` carries conversationId, expectedRevision and reviewedHash. Requires server actions.canRun and VALIDATED; an explicit review checkbox approves once. No human create or validation button. Only VALIDATING/RUNNING poll every two seconds. UNKNOWN has no retry control. Access/session changes abort requests and clear review state. No engine/admin IDs are displayed.

Verification: scoped Svelte check 0 errors/0 warnings; graph-client.test.cjs passes scope/metadata/session/exact-body/no-uncertain-run fixtures; verify-graph-browser.cjs passes actual Chrome390px controlled transport review→single POST→RUNNING→COMPLETED with no repeat control or horizontal overflow. Browser tests do not prove a real provider/account connection. Existing Shopify Test/Activate lifecycle remains in AutomationChatFeedback and AutomationReviewCard without modification.
