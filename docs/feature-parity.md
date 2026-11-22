# Dashboard feature parity and acceptance

This is the historical legacy dashboard inventory, not acceptance of the new product. Use [new product API coverage](new-product-api-coverage.md) and [the native runtime contract](../product-backend/runtime-contract.json) for the current installation target. Legacy pass counts cannot establish Boss/team/model behavior.

Status: NOT VERIFIED. Source inventory is evidence of implementation presence, not evidence of working behavior. Observed 2026-11-22 via read-only bounded server commands. Baseline webui symlink: native-company-mcp-always-v33-20261119. Platform symlink: native-customer-oauth-dev-v34-20261118.

## Evidence and limits

qa/source-evidence/ui-files.txt lists all observed dashboard route files and Starli panel files. panels.json records actual named functions, literal API references and visible text extracted from all 29 Starli panel components. backend-routes.json records all 708 literal Python route decorators across the dashboard backend, including method, relative path, handler, source file and line. Route paths are decorator-local, not necessarily full mounted URLs. Dynamic registrations and imported mounts require runtime OpenAPI comparison. The companion source contract checks retained files, action functions and route declarations; it cannot establish reachability or correct authorization.

## Dashboard destinations

| Destination | Required behavior |
|---|---|
| / | Chat, streaming, stop/retry/edit, history, model and provider selection, attachments, tools, artifacts, delegation and execution activity; persisted conversations survive restart |
| /starli/company | Company overview, credits availability, native capabilities and business resource links |
| /starli/projects | Search and paginate saved projects, inspect details, safe external links; chat toolbar selection, shared file editor, save, desktop/tablet/mobile preview, build and reconnect |
| /starli/crm | Search and paginate companies; create/edit company, notes, detail/contact/opportunity/task/interaction views; chat handoff for tasks and opportunities |
| /starli/social | Account connection, reconnect, prepared publishing actions, exact review and receipts |
| /starli/browser | Capability/access check, live frame, navigation, coordinate click, type, key, scroll, refresh, close and reconnect; same session displayed in dock |
| /starli/proposals | Search, paginate, inspect proposals and safe links |
| /starli/mailbox | Connection settings/test/disconnect, sync/search/pagination, message detail, read flag, attachments, create/edit/reply draft, exact send review/reject/receipt |
| /starli/hosted-agents | Read-only resource list, search, pagination and details; lifecycle actions through actual tools/chat |
| /starli/videos | Read-only video resource list, search, pagination and details; composition/render actions through actual tools/chat |
| /starli/activity | Saved resource list plus tool execution status and project files within chat |
| /starli/tools | Search connected tools, inspect schema, typed and nested parameters, invoke permitted tools, prepare sensitive actions for review and show actual result |
| /starli/approvals | Prepared chat actions and exact review; approved, rejected, expired, pending and uncertain states must remain distinct |
| /starli/billing | Wallet availability, ledger/reservations display; unavailable is not zero; no production ledger tests |
| /starli/admin | Admin-only platform connections, release status, evaluations and functions |
| /starli/agents | Existing redirect to chat; do not invent an agents listing |

## Additional existing application surfaces

- Authentication, sign-in/account creation, guest chat and guest project preview/build; shared chat /s/[id], saved /c/[id], /[botChat], /watch and error routes.
- Workspace model create/edit, prompt create/edit, tool create/edit, function create, knowledge create/detail; workspace landing and home.
- Admin users, settings, evaluations, function create/edit; playground chat/completions/notes; channels and threads.
- Chat settings, tags/folders/search/history, sharing, shortcuts, model selector, tool servers, input/media/voice controls and rendered artifacts must be reviewed against retained component tree before claiming complete interaction parity.
- Intelligence observations with source/confidence/expiry, source connections, follow/watchlist save; social profile/moments, area/time filters, watchlists and notifications, review/confirm public share and deletion, retry with same operation identity.
- Live location explicit consent, self/selected audience, coarse/precise controls, expiry, AI access, start/stop; maps opt-in, pan/follow and attribution.
- Native chat platform access, autonomous mode, steer, agent messages/events and provider connections are represented by backend routes. Company messaging, drive, sheets, delivery, engines and computer viewer mounts are included in the route evidence and require separate runtime acceptance.

## Panel action inventory (actual source)

- StarliAccessMode.svelte: current, request, apply, load, change.
- StarliActivityStream.svelte: load, statusClass.
- StarliAdminPanel.svelte: load.
- StarliApprovalsPanel.svelte: declarative component.
- StarliAvatar.svelte: declarative component.
- StarliBillingPanel.svelte: authHeaders, when, load.
- StarliBrand.svelte: declarative component.
- StarliBrowserDock.svelte: poll.
- StarliBrowserPanel.svelte: applyFrame, reset, bindAccount, storage, checkAccess, refresh, action, navigate, interact, scroll, clickScreenshot, pageClick, close, poll.
- StarliCRMPanel.svelte: authHeaders, search, page, label, askStarli, clearTarget, cancel, aborted, load, openCompany, startCreate, startEdit, startNote, toolText, submit, saveCompany, saveNote.
- StarliCollectionsPanel.svelte: safeUrl, when, load, submit.
- StarliCompanyPanel.svelte: headers, capLabel, loadOverview, loadCaps.
- StarliDrawerLinks.svelte: isActive, close, cls.
- StarliGuestChat.svelte: activateGuestPreview, resizeGuestPane, stop, newChat, onKey, send, restoreProject, persist, buildProject.
- StarliIntelligencePanel.svelte: connect, reset, evidence, safeLink, when, chooseFollow, save.
- StarliLiveLocationPanel.svelte: clear, stopServer, load, setConsent, start, stop, cancelStart, hidden.
- StarliLiveMap.svelte: move, down, pan, key.
- StarliMailActions.svelte: load, decide.
- StarliMailSettings.svelte: api, load, save, test, disconnect, toggleAdvanced.
- StarliMailboxPanel.svelte: unpack, tool, load, open, newDraft, save, display, editDraft, prepareSend, syncInbox, markRead, ask.
- StarliMessageActivity.svelte: label, color.
- StarliMomentsPanel.svelte: hash, center, applyArea, loadMine, run, retry, watchArea, discussNotice, create, prepare, share, erase, showMap, discuss.
- StarliProjectPanel.svelte: api, load, file, askBuild, save, projectEvent, visible, reconnect, accountChanged.
- StarliProjectToolbar.svelte: syncPane, load, open, select, projectEvent, accountChanged.
- StarliResourcePanel.svelte: loadOverview.
- StarliSocialPanel.svelte: api, load, connect, decision, ask, title, fields.
- StarliToolFields.svelte: set, complex, lines.
- StarliToolsPanel.svelte: api, load, choose, advancedMode, operationKey, argumentsValue, invoke, prepare.
- StarliWhisper.svelte: declarative component.

## Execution acceptance

Each feature requires a recorded local URL, OS/runtime versions, build identity, timestamp, test steps, expected/actual results and evidence. Fixture mutations run only in an isolated local test database and mock integrations; external sends/publishing and production ledger changes are excluded. An unconfigured paid integration must show a truthful unavailable state; it does not count as successful end-to-end integration.

1. Clean install on Windows, macOS and Linux using release documentation and locked dependencies, with no /srv paths, production credentials, copied database or private npm cache. Record prerequisite versions, install/build exits, first-run admin setup and health. Start/stop/restart twice; verify persistence and safe port conflicts. Container app deployment does not satisfy VM acceptance.
2. Test anonymous, normal user, admin and second tenant. Deep links load after refresh; role restrictions and tenant isolation apply at API and UI levels. Logout/reconnect cannot reveal previous account's browser frames, files or resources.
3. Exercise every destination and every panel action above. Empty/loading/error/retry/pagination states must be truthful. Read-only panels remain read-only. Search and detail results come from local durable data.
4. Chat streams genuine configured provider output, stop cancels work, tool results carry real status, and project edits appear in the same durable files and preview. Approvals bind the exact prepared operation; expired/rejected/uncertain actions cannot be reported as sent or delivered.
5. VM: fresh isolated guest boot, visible desktop/frame, actual navigation/click/type/key/scroll, refresh/reconnect, ownership isolation and teardown. Record actual guest and host versions, frame timestamp and input result. A Playwright browser or Docker application container alone is not a computer-use VM.
6. Marketing absence: rendered root is chat/dashboard or authentication; navigation has no pricing/about/landing/contact-sales routes; enumerate built routes and inspect anonymous root/auth/404. Do not remove functional shared-chat, proposal, hosted-agent, generated-project or OAuth endpoints just because they are public. Source filename heuristic is only a preliminary check.
7. Compare runtime OpenAPI/mounted endpoints to source inventory, resolve missing dynamic mounts, then run domain fixtures for mail, CRM, tools, projects, social, providers, messaging, sheets/drive and computer relay. Record intentional exclusions explicitly; no blanket parity claim for untested routes.

## Current verification

Prime's integration findings add mandatory parity surfaces: effective historical MCP control-plane, workspace_entry app and task worker, company computer broker, OpenPencil web/MCP, Mission Control and search. See docs/integration-notes.md for their observed production roots. Their presence, configured local routes, actual responses and failure states must each be checked; a successful main dashboard install is insufficient. Extension inventory remains pending extraction and runtime mounting verification.

qa/source-evidence/platform-operations.json now records 53 literal GraphQL Query/Mutation/Subscription declarations and 65 direct HTTP pathname/router checks from extracted platform TypeScript/JavaScript, including extensions. It includes complete declaration text to preserve operations that lexical field-name extraction may miss. This is lexical evidence, not a claim of all dynamic routes. Refresh with python qa/inventory_platform.py after source changes.

The additional service sources are present under platform/extensions/. Its service-contracts.json marks every extension portableReady=false: broker needs fresh signed company enrollment and Linux permissions; OpenPencil needs private initialization, frontend build and MCP; Mission Control needs fresh auth/state and dependency/workspace normalization; search needs Linux Python, dependencies and private SearXNG settings. Presence does not pass these gates.

Executed local platform GET http://127.0.0.1:4100/health: HTTP 200, ok=true, database=true, service=starlidigital-api. Report: qa/results/platform-health.json. This is platform liveness only; it does not establish dashboard, VM or integration behavior.

Latest source-contract execution returned exit 0, 195 checks passed and 0 failed against the extracted dashboard (independently rerun by AgentX 8 after Prime's matching result). The marketing heuristic requires the source route tree to exist. Report saved to qa/results/source-contract.json. This checks source presence/declarations, not runtime action parity. Dashboard port 8080 was not listening at that check; unauthenticated dashboard smoke remains pending local startup.

Subsequent localhost smoke was executed after a 56-second readiness check: 195 source checks passed; all 3 HTTP checks (/, /auth, /api/config) failed with connection refused because dashboard startup is still pending Python dependency downloads/builds. Report: qa/results/local-smoke.json. Repeat after AgentX5 starts the backend. No HTTP page result or action parity has passed.

Source baseline collected successfully. No clean install, authenticated browser workflow, VM session or integration parity has been executed by AgentX 8 at inventory time. Overall parity remains NOT VERIFIED until execution evidence is attached. See qa/README.md for repeatable tooling and report semantics.
