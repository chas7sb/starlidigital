# Enterprise local workspace handoff

Owner scope: src/routes/enterprise/+page.svelte and src/lib/components/enterprise/* only. Production unchanged.

- Native /auths/ and /auths/signin; token stays in native localStorage. No fixture identity or provider switching.
- Verified native company list/switch/directory. Prefer real StarliDigital then StarliDigital2 membership, otherwise first membership. Display actual company name.
- Actual company messaging rooms: canonical private bot DM create/reuse; channels from actual company-scoped rooms. No seeded bot/channel/message data.
- Human channel sends dispatch no bot unless explicitly selected from room-authorized bot roster. Private DM dispatches selected bot.
- Canonical messages refresh on verified SSE events and periodic fallback. Latest100 via room lastMessageSequence. Per-conversation in-memory drafts; uncertain-send request IDs survive switching.
- Actual run/assistant scoped tool lifecycle, Working spinner, elapsed and detail dropdown. Status derives from runtime only. Stop POST exact turn /cancel, receipt verified before local state projection.
- No older UI panels, no fabricated browser/preview or project/App contents. Those views honestly state unconnected.

Verification: all3 Svelte components compile0warnings. Four executed controller checks with synthetic transport pass: channel no-dispatch; DM selected-bot dispatch; network uncertainty preserves draft + write ID; stale-room response cannot overwrite new state. External model calls0. Actual local route GET200; protected real company API unauth403. Root owns browser render/authenticated acceptance and provider migration. Existing provider unavailable at first inspection, do not claim inference success until root proves actual run.

Security update: company capabilities checked with parseNativeAuthority on periodic/event refresh even without an open room. Confirmed company401/403/404 or malformed scope clears all company state/caches and aborts parent Activity signal;401 opens sign-in with renewed controller. Room denials verify company separately. Lifecycle/selection guards cover late JSON, initialize, send/Stop callbacks. Existing safe auth400 detail parser preserved.

Security verification:6 executed controller tests (controlled HTTP, not live membership mutation) pass for full403 clearing,401 new sign-in, room-only denial preserving company, malformed scope fail-close, late JSON after revoke, cross-tab session cleanup. Actual Activity subscription test passes for child abort, tool-row clearing and rejected late event. Existing4controller tests and3Svelte compiles still pass. No new features, inference or production changes from this lane.

Bots directory update: Bots navigation opens BotDirectory ('Your AI team') while sidebar bot selection remains Bots DM. Main menu now Company/Bots/Projects/Apps/Team plus real company channels. New BotsDirectory receives actual bots only, no seeded cards/count/purposes. Cards emit select {botId}; page validates roster and emits starli-enterprise-agent-settings {companyId,botId,membershipRevision}; root owns Agent12 editor wiring. selectedSettingsBotId resets on revocation. Directory purpose accepts actual purpose/description metadata if available; native directory projection currently strips these, so verified metadata enrichment remains root/Agent12 integration. Four Svelte compiles0warnings, existing11focused behavior/security checks pass.
