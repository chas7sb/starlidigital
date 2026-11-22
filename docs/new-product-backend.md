# Company product backend

The installed self-hosted profile permits exactly one company. `product-backend/local_server.py` composes native identity, company authority, bots and messaging from `dashboard/backend` with the recovered autonomous-company candidate. The older Node/GraphQL platform is reference source.

## First browser visit

Start `product-backend/local_server.py serve --state work/new-product-local --port 18381 --origin http://127.0.0.1:5186` with the locked Python 3.11 environment. The frontend proxies `/api/` to the loopback backend. First-run browser setup creates the administrator and sole company; later visits show the workspace or native sign-in. CLI `init`, registration, guest intents, provisional companies and claims are disabled.

GET `/api/v1/setup/status` reports `setupRequired`, `singleCompany:true`, `registrationAllowed:false`, `setupLocked` and `companyConfigured`. POST `/api/v1/setup` accepts `name`, `email`, `password`, `companyName`, the configured Origin and `X-Starli-Setup: 1`. Success returns 201 with `setupComplete:true`, `companyId` and `signInRequired:true`, without credentials or a token. Racing losers and subsequent attempts receive 409.

`local_installation.py` commits the native account, authentication record, company, owner membership, canonical membership audit and permanent lock in one transaction. Failures roll everything back. Database triggers prevent second-company creation and deletion of the binding or setup lock. Configured legacy installations retain their owner, company, bots, separate databases and encrypted vault. Multiple existing companies fail closed with migration required; none are deleted.

## Provider and team behavior

`local_provider.py` mounts encrypted company connections, per-bot selections, profiles and native model turns. `/api/local/provider` accepts the user's own OpenRouter key through the trusted frontend origin; saving makes no model call. The fixed model is `nvidia/nemotron-3-ultra-550b-a55b:free`, with zero-price routing and no paid fallback, ambient credentials, redirects or automatic retry. Fresh installations require their own connection. Configured health alone does not prove inference.

`local_collaboration.py` and `local_collaboration_routes.py` implement human-started Boss/team discussion with native persisted messages, authority fences and durable receipts. Limits are 4 teammates, 2 rounds, 12 model calls, 90 seconds per call and 360 seconds total. Every selected teammate must reply before completion. There are no execution tools or automatic orphan resumes. Collaboration messages use native metadata for their team run ID; normal message `runId` remains reserved for actual native single-bot turns. Historical incomplete completion records are exposed for review without rewriting stored journals.

Native identity and roles live in `open_webui/models`, `utils/auth.py` and `company_authority/`; bot registry/grants/memory in `starli_memory/`; rooms, attribution, messages and human floor commands in `company_messaging/` under `dashboard/backend`.

## Validation and evidence

Current singleton checks pass for rollback, concurrent setup, permanent lock, malformed Host/Origin denial, alternate company writers, tenant boundaries, disabled signup/guest/claim routes, native sign-in, and first-owner team creation plus persisted human direction. Results are in `SINGLE-COMPANY-VALIDATION.json` and `LOCAL-VALIDATION.json`. Provider configuration/security and 3 transport tests make no external calls. Native chat/collaboration adapter checks use explicit model fixtures; the core collaboration suite has 19 tests. Fixtures are not actual inference proof.

Historical actual Windows inference proof is `qa/results/new-product-live-proof.json`, tied to commit `8283115df7c116e2d620048d508df5795da511b0`: a UI-triggered Boss/team discussion produced 5 provider calls, persisted receipts and reported cost 0. This predates current singleton working changes and does not claim a new inference run against them. Singleton validation made no model calls. Controlled preview reload preserved 1 owner, 1 company, 3 bots, 1 encrypted connection and 3 selections; setup remains locked.

Generated-app execution, autonomous tools and full joined preview remain unconfigured. Their recovered Linux-specific process/sandbox and trusted preview-host source is retained for portability work.

## Provenance and source identity

`server-src/` preserves 304 recovered source files; `SOURCE-MANIFEST.json` retains upstream hashes and unresolved historical references. No upstream private state or credentials were imported. Guest/claim modules remain historical source only and are not mounted.

All 15 native dependency pins match exact canonical LF bytes in `LOCAL-NATIVE-PINS.json`; verification remains strict. `runtime-contract.json` identifies current sources by canonical LF SHA256 and uses commit 8283115 as the prior baseline, not a claim that changed working bytes were committed or tested there. `SOURCE-CHECKPOINT.json` hashes that contract. The release owner reconciles the final committed snapshot and CI evidence.
