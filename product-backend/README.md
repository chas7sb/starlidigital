# New company product backend

This directory contains the recovered autonomous-company candidate and a runnable local composition of its native identity, company, bot, messaging, guest-workspace and claim services. The retained `dashboard/backend` is a native foundation dependency. The old GraphQL platform is not the canonical product API.

From the repository root, after installing the locked dashboard Python dependencies:

```powershell
installer/.runtime/python/Scripts/python.exe product-backend/local_server.py init --state work/new-product-local --port 18381
installer/.runtime/python/Scripts/python.exe product-backend/local_server.py serve --state work/new-product-local --port 18381
```

`init` prompts for the local owner credentials. It refuses to replace existing users. `serve` binds127.0.0.1, uses fresh private state under `work/`, and preserves state on restart. Do not pass production directories, configuration or credentials. The session key is generated locally and checked through the existing private-owner storage policy. `--origin` can specify a separate literal-loopback frontend origin.

The selected frontend must proxy the backend `/api/` paths to this service. Authentication uses native `/api/v1/auths/signin`; collaboration uses native companies, bot-directory, company-pilot admission and company messaging. New guest/claim routes are under `/api/v1/starli/{public/grokbot1,grokbot1}`. See [backend map](../docs/new-product-backend.md).

Open `/api/local/provider` through the trusted frontend proxy to sign in, select a company, enter your own OpenRouter key and select its bots. The older `/local/provider` alias also exists. Use the same browser origin supplied by `--origin`; for a frontend on5186, serve with `--origin http://127.0.0.1:5186` and open `http://127.0.0.1:5186/api/local/provider`. The setup page is loopback-only, no-store, and keeps its bearer token only in memory. Saving makes no inference call. Keys are encrypted in the private company vault and are never returned in API responses. Ambient OpenAI or upstream production credentials are never used.

The selected model is `nvidia/nemotron-3-ultra-550b-a55b:free`, verified against the official OpenRouter catalog on2026-11-22. Requests use the fixed HTTPS OpenRouter endpoint, no redirects/proxies, no paid fallback and zero-price routing. No implicit model retry occurs. Key syntax validation/configuration does not prove provider acceptance: health remains `CONFIGURED_NOT_YET_VERIFIED` until actual calls are independently checked.

Native company provider connection/options/selection and bot profile/create routes are mounted. Each bot requires an explicit company-owned selection; revocation, membership, profile and provider revisions are rechecked. Native conversation turns persist agent-attributed messages and run state. Bounded human-started collaboration can ask approved teammates and return a Boss synthesis: at most4 teammates,2 rounds,12 model calls,90seconds per model call and360seconds total. The Boss must return a strict JSON plan selecting only admitted IDs. There are no execution tools, recursive agent dispatch or automatic background loops.

The full joined `start_native_model_apps.py` generated-app/preview chain remains reference source, not a portable runtime default. Linux process/sandbox controls and the trusted generated-app preview host remain outstanding. Bounded text collaboration is distinct from autonomous tool execution and full joined-preview parity.

API integration:

- Single native turn: `/api/v1/starli/companies/{company}/rooms/{room}/bots/{bot}/runtime/turns`, with native run polling/events/cancel.
- Collaboration: POST `/api/v1/starli/companies/{company}/messaging/rooms/{room}/collaborations` with `bossId`, `teammateIds`, `sourceMessageId` and `Idempotency-Key`; GET `/{run}` for persisted status/messages/model receipts; POST `/{run}/stop` for bounded cancellation. The source must already be an actual canonical message by the initiating human. Use a normal private group conversation containing the approved bots, not the separate native work-session protocol.
- Native provider usage evidence: `/api/v1/companies/{company}/rooms/{room}/model-receipts?runId={run}`. Receipts contain provider/model/response ID and allowed numeric usage/cost, never credentials or session scope.

Collaboration message attribution uses native `message.meta.collaboration.runId` and the dedicated team API's native message IDs. Its `cm_messages.run` / normal message DTO `runId` is null. Those normal fields are reserved for real `cr_turns` IDs, which the company frontend polls through the single-bot runtime API. Collaboration never fabricates a `cr_turns` record; ordinary native chat retains its real turn ID.

Mutations require current native bearer authentication, the configured Origin and company/room/bot permissions. Restart never automatically replays a pending model request or resumes an orphan collaboration. Unknown effects retain review/pending states; no synthetic success receipt is substituted.

Run actual native HTTP/ASGI regression checks with:

```powershell
installer/.runtime/python/Scripts/python.exe product-backend/test_local_server.py
installer/.runtime/python/Scripts/python.exe product-backend/test_local_provider.py
installer/.runtime/python/Scripts/python.exe product-backend/test_provider_transport.py
installer/.runtime/python/Scripts/python.exe product-backend/test_native_collaboration_routes.py
```

The core tests create random disposable private state under `work/`, use actual native password hashing/session verification, install/admit bots and verify persisted native work. Provider configuration/security tests make no external calls. Transport and collaboration route tests explicitly use model fixtures and do not constitute actual inference evidence. The separate collaboration engine test suite checks stop, budgets, authority changes and malformed plans. Actual Boss/teammate conversation proof requires a user-supplied key and persisted successful provider response IDs.

Source hashes and unresolved assembled/historical references are in `SOURCE-MANIFEST.json`. Critical adapted native dependency hashes are in `LOCAL-NATIVE-PINS.json`; all15 selected native files were canonicalized to LF before pinning, matching fresh Git checkout bytes. Verification remains strict. Review and repin deliberately after native dependency edits. No production state or credentials are source deliverables.
