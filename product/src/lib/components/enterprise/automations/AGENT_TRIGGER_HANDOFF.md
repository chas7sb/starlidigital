# Native daily bot activation

AgentTriggerCard.svelte props: companyId, actorId, conversationId, triggerId, accessSignal. Events close / denied {status}. Import agentTriggerSelection from agent-trigger-client.ts; it validates starliAgentTrigger version/company/conversation/native agent/current assistant message binding and returns only triggerId. All authority is freshly fetched.

Exact GET /api/v1/starli/companies/{c}/automations/agent-triggers/{id}?conversationId. POST /{activate|pause|resume|test} carries {conversationId,expectedRevision,reviewedHash}. No human Create. Activate/resume require separate standing-rule checkbox; Test only ACTIVE+server canTest and separate explicit immediate-wake checkbox. Shows exact escaped prompt, bot, source chat, daily time and IANA timezone. No engine branding or templates. Polls ACTIVATING/PAUSING every2sec and ACTIVE every5sec only intersecting visible card + visible document; no automatic test. UNKNOWN has no replay. Session/access change clears state and aborts.

Verification: scoped Svelte0errors/0warnings; strict client fixtures scope/metadata/timezone/exact approval/no uncertain resume/session fence PASS; actual Chrome390px controlled transport activation→explicit immediate test→pause→resume reapproval PASS, no horizontal overflow/errors. No real scheduled bot wake or provider action was performed by UI tests.
