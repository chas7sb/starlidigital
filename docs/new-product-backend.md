# New bots / teams / Starli coordinator backend map

AgentX3 source inventory and local composition, 2026-11-22. This supersedes treating the old Node platform as the product backend.

## Three distinct source generations

1. `C:/Users/Administrator/Desktop/starlidigital-app` is an older React/Express/Prisma checkout. Its API defaults to port3002 and `/api`; package/backend routes cover chat, projects, agents, social and mail. It does not contain the new company bot/team orchestration implementation. It is reference evidence, not selected canonical source.
2. `/srv/starlidigital/webui-current` is the native v33 Svelte/Python foundation already extracted under `dashboard/`. Company authority, bot registry, company messaging, private bot memory, work sessions, provider capture and native bot turns remain real dependencies of the new product. Retain this backend foundation; the old generic dashboard frontend is not thereby canonical.
3. The current autonomous-company candidate is under `/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/`. Coordinator state explicitly points at private joined v9 and subsequent Nov22 work. The v9 joined pin file is actually `codex/assembly-r1/next-v9/JOINED-RELEASE-PINS.json`, not under `runtime-private-demo-r3/next-v9`. Its accepted private-demo URL was localhost17281; expiry/viewing-ended artifacts mean that record is historical acceptance evidence, not proof a listener is currently available. Later v12 source/build exists, but its handoff says browser sign-in/claim acceptance was pending. No visual acceptance of v12 is claimed here.

## Actual backend responsibilities

| Product behavior | Actual source |
|---|---|
| Native users/sessions and verified requests | `dashboard/backend/open_webui/models/{users,auths}.py`, `utils/auth.py`, session fence/revocation routers |
| Company owner/member roles and capabilities | `dashboard/backend/open_webui/company_authority/` |
| Company bots, personal Boss identity mapping, grants and memory audiences | `dashboard/backend/starli_memory/`; Boss is an identity/role in native registry, not evidence of autonomous delegation by itself |
| Rooms, messages, mentions, DMs, attribution and durable events | `dashboard/backend/company_messaging/{store,http,native_mount,internal_send,context}.py` |
| Bounded bot-to-bot work transcript and human floor/pause/resume | `dashboard/backend/company_messaging/work_sessions.py`; source explicitly does not schedule inference or external execution |
| Provider-selected bot turns and private SDK worker IPC | `dashboard/backend/starli_company_computer/runtime/company_bot_runtime/` |
| Guest cookie intent and provisional company; registered claim/reauth | recovered wave `grokbot1/{grokbot1_claim,grokbot1_routes}.py` plus `vendor/guest_intents.py` and `vendor/provisional.py` |
| Guest workspace history, frozen claim transfer, original user/assistant attribution | wave `codex/guest-company-authority-r1/` and `assembly-r1/adapters/native_company_chat_with_transfer.py` |
| One-time Starli coordinator naming and postclaim bot execution grants | wave `codex/postclaim-name-r1/claimed_coordinator_name.py`, `assembly-r1/adapters/claimed_chat_defaults.py` |
| Actual execution graph/agency receipts/Stop | wave `codex/native-wiring-r3/` with `gemini1/orchestration-r6/`, plus sibling `customer-capabilities`, `machinery-run`, `starli-orchestrator`, `agency-execution`, `business-engine` |
| Model-built app / trusted CRUD host / private preview and owner facts | richer `assembly-r1/scripts/start_native_model_apps.py`, `assembly-r1/adapters/install_model_apps_repair.py`, guest-build-tools, model-app-execution/persistence/compile-repair/controlled-reopen components |

`start_native_chat.py` is an older reduced composition and omits the model-build/authority/owner-facts chain. `NativeChat` calls one provider completion and explicitly forbids claims of new execution without receipts. Mentions or a successful DM are not an autonomous multi-agent execution acceptance test. The recovered native worker service has separate deterministic workers with `modelCalls:0`; this is not multiple autonomous model agents.

## HTTP contracts traced in actual source

- Guest: `/api/v1/starli/public/session`; `/api/v1/starli/public/grokbot1/intents`; `.../intents/{intent}/workspace`; `.../workspace/messages`; `.../workspace/setup`.
- Claim/owner: `/api/v1/starli/public/grokbot1/claims`; `/api/v1/starli/grokbot1/reauth`; `/claims/{intent}/navigation`, `/resume`, `/conversation`.
- Native team/company surfaces: `/api/v1/companies`, `/api/v1/bot-directory`, company messaging rooms/messages/work-sessions mounted by `company_messaging.native_mount`.
- Worker: `/api/v1/starli/grokbot1/claims/{intent}/execute`, `/api/v1/starli/orchestration/graphs/{graph}/progress`, `/stop`.
- Preview authority: owner/guest build tickets, `/internal/v1/model-app-authority/{build}/{redeem,authorize}`, and claim preview/bootstrap/restart/stop routes.

AgentX1/2 should map the selected frontend against these contracts. Stable frontend-workspace enterprise clients are an intermediate generation; joined `assembly-r1/next-v9` and later source locks are the newer source of truth to compare visually. Do not wire the new UI to the old GraphQL dashboard solely because that API builds successfully.

## Extraction and pins

Recovered `product-backend/server-src/` preserves server-relative paths, including the wave directory and sibling canonical machinery modules. `product-backend/SOURCE-MANIFEST.json` has 304 unique original source files and per-file SHA256 values. The base bounded archive hash is `26511689d660103a0026862f0a133b70ac2235c9bebb86e2220d51cc8dae85db`; the manifest separately records the transitive-source closure archive hash and unresolved references. Initial 162-file snapshot was superseded by this larger source layout.

Only source/test code, SQL, patches, package manifests/locks and notices were selected. No private controller JSON, keys, tokens, provider profiles, sessions, databases, logs, receipts containing customer state, or generated customer projects were copied. Targeted credential/private-key patterns found no matches. All upstream access was read-only, without modifying the active ULTRA work.

Some frozen components intentionally reference an assembled layout or absent historical test fixtures; those unresolved paths are retained in the manifest rather than silently fabricated. `SOURCE-MANIFEST.json` preserves upstream hashes, while local runtime files and LOCAL-NATIVE-PINS.json record the selected local composition. Three native foundation files differ from original v33 pins due to already reviewed local portability work: session revocation, public router and messaging mount.

## Runnable local native composition

`product-backend/local_server.py` composes actual native authentication, company authority/directory, messaging and the new guest/provisional/claim/transfer routes against a private fresh state under repository `work/`. It does not launch the old GraphQL API or old frontend. It uses native database constructors and real session verification. No synthetic users or test JWTs are created by normal startup; `init` interactively creates the first owner using native password hashing and requires subsequent real sign-in.

Commands from repository root using the installed dashboard Python3.11:

```powershell
installer/.runtime/python/Scripts/python.exe product-backend/local_server.py init --state work/new-product-local --port 18381
installer/.runtime/python/Scripts/python.exe product-backend/local_server.py serve --state work/new-product-local --port 18381
```

AgentX5 can replace the interpreter path with its selected dashboard Python on macOS/Linux. Bind is literal127.0.0.1 only. An explicit frontend origin may be supplied using `--origin http://127.0.0.1:PORT`; no public hosts or inherited production configuration are accepted. Session key and private state use the existing current-owner private-file policy; existing broad/unowned storage is refused. `LOCAL-NATIVE-PINS.json` fails closed if critical local foundation source changes; review and repin after coordinated source edits.

This local composition deliberately reports provider/worker execution as NOT_CONFIGURED. It is a real runnable native backend subset, not full joined-product parity. The richer model-app/worker chain still requires a portable implementation of the upstream Linux-specific private-root, UID997, `/proc` start-time and Unix-socket controls, plus BYO provider configuration and a trusted generated-app host. No upstream key paths are reused and no fake worker or model receipts are supplied. These limitations must remain visible in installer/frontend capability state until independently exercised.

Local validation is recorded in `product-backend/LOCAL-VALIDATION.json` when tests pass. Browser acceptance, provider inference and full joined execution are separate gates.

Current observed result: twelve actual native ASGI checks pass, including native password sign-in, company create, directory authorization, two bot installs and explicit admissions, persisted two-bot work session, guest intent/provisional workspace/readback, and fail-closed unconfigured inference/worker responses. A separately spawned real Uvicorn process also bound loopback and returned truthful fresh-state health, then its owned child was stopped. Zero model calls or external actions were made. `product-backend/runtime-contract.json` records the exact local service command, source hashes, capabilities and disabled boundaries for AgentX5/AgentX2 integration.

## Provider and bounded collaboration source checkpoint

The local composition now mounts the canonical company provider vault/selection, bot profile/create APIs and native bot runtime. `local_provider.py` implements explicit OpenRouter Nemotron Ultra free calls with zero-price routing, no paid fallback, no redirects/ambient credential fallback and bounded requests. Each actual successful response must supply a model-matching response ID; persisted receipts omit secrets. The key-entry page is `/api/local/provider` through the frontend proxy, not a separate-origin backend Save flow. Key save is configuration only, not a model call. Company tuple DTOs and hidden-form CSS were corrected after actual browser review.

`local_collaboration_routes.py` binds the independently reviewed `local_collaboration.py` to current native sessions, company/bot/room/provider revision fences and an idempotent canonical agent-message sink. Session authority remains server-only. It persists actual request/reply/final message IDs and run/model receipts. This is a bounded human-started text discussion, not arbitrary autonomous tool execution. Source limits are2 rounds,4 teammates,12 model calls,90seconds per call and360seconds wall time. Strict model JSON plans must use only selected admitted teammate IDs; unsupported JSON-object mode is not requested. There are no automatic retries or orphan resumes.

Configuration/security integration and native chat/collaboration adapter tests pass with explicit synthetic credentials/model fixtures and zero external calls. Fixtures are not actual inference proof. The provider transport boundary has3 no-network tests. Actual OpenRouter acceptance and actual Boss/team replies remain pending user key input and subsequent explicit QA. Generated-app execution and preview remain unconfigured.

All15 critical native dependency files now have canonical LF bytes and exact matching raw hashes in LOCAL-NATIVE-PINS.json. LOCAL-PINS-VALIDATION.json reports0 mismatches and0 noncanonical files, so a Git LF checkout does not invalidate startup pins. Runtime contract/readme describe current source capabilities and hashes. The shared18381 server was intentionally left running during user key handoff; latest source receipt-history and timeout/engine refinements require a coordinated same-state restart after save, before final model QA.
