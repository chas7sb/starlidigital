# New bots / teams / Boss product: configuration and backend reuse

This document supersedes frontend-target assumptions in the earlier configuration notes. Prior Windows/backend/VM security tests remain component evidence; they do not establish acceptance of this new product frontend.

## Source evidence and candidate selection

The Desktop directory C:/Users/Administrator/Desktop/starlidigital-app is an older React19/Vite7 app. It has no root package.json or AGENTS.md in the inspected tree. Its frontend/src/services/api.ts uses /api on localhost:3002, a production API fallback, and a production retry interceptor. Its backend is Express5/Prisma7/PostgreSQL. That API contract is distinct from the joined bots/teams/Boss product. No Desktop source was edited.

The server's /srv/starlidigital/frontend-workspace DEPLOYMENT.md identifies a canonical editable Svelte /app workspace. However, the later user correction identifies the ACTIVE ULTRA BO$$ joined candidate as the extraction target; source naming alone does not establish the correct UI.

Base for joined evidence:
server/src/grokbot-gemini-autonomous-company-wave1-20261120/codex/ under the MCP workspace.

coordinator-r1/CURRENT-VERIFIED-STATE.json latestPrivateDemo (record dated 2026-11-21) points to next-v9/JOINED-RELEASE-PINS.json. The actual file is under assembly-r1/next-v9, not runtime-private-demo-r3. SHA256 of the observed pins file:
6b6307c5ff3031df981dfbe05e891a09921a562c01f020c3e547dca3345fbbc4.

Nine pinned code-file hashes checked against current source all matched. next-v10, next-v11 and next-v12 also exist, with newer build receipts, but this review did not find JOINED-RELEASE-PINS.json inside those version roots. Therefore v9 is evidenced as a joined baseline, not asserted to be the latest live candidate. Source owner must bind extraction to the currently active preview and independent visual acceptance. Do not select v12 merely because its directory number is highest.

The referenced private preview origin is http://127.0.0.1:17281. The coordinator records cosmic input-only entry, guest workspace, real guest reply and reload persistence, then company DM. That is recorded evidence, not a fresh visual check by this configuration task. Source/visual verification remains with AgentX1/2 and Prime; no UI acceptance claim is made here.

## Frontend portable configuration

Inspected joined frontend root: assembly-r1/next-v9/frontend/app. Its package keeps the upstream name open-webui; package name does not prove old-UI identity. Node engine is >=18.13 <=22; build script is vite build. Product selection must use mounted routes, exact pins and visual evidence.

src/lib/constants.ts:8-13 uses empty WEBUI_BASE_URL and same-origin /api/v1. Do NOT add the Desktop React VITE_API_URL setting to this candidate and assume it works. Socket settings actually consumed:
- VITE_STARLI_SOCKET_URL: blank means same-origin.
- VITE_STARLI_SOCKET_PATH: default /ws/socket.io.

src/routes/+page.ts:9-23 reads PUBLIC_STARLI_BOSS_INTAKE_ENABLED and PUBLIC_STARLI_GROKBOT1_WIRE_ENABLED from window.__STARLI_RUNTIME_CONFIG__ first. It also accepts VITE_PUBLIC_STARLI_* aliases at build time. The safe example keeps both disabled until matching native routes pass readiness. No flags constitute readiness evidence.

The root component is named lib/components/marketing/Homepage.svelte but in this candidate implements the requested cosmic input -> /guest?intent=... product entry. Do not delete or redirect that entry merely because of the directory name. It is distinct from unrelated pricing/blog/marketing pages. Source owners must preserve this product flow while applying the user's no-marketing scope.

vite.config.ts:49-64 proxies API/websocket routes to the original production host and rewrites related headers. This is an active portability issue for the frontend owner: replace with a trusted LOCAL configured gateway/backend, retain WS upgrade behavior, and remove production Origin/Referer rewriting. No dev server should silently call production.

New-product templates are under config/new-product-*.env.example. They are examples only; no live demo key, session, private profile or customer state is included.

## Backend reuse and route contract

| Route family | Required implementation | Reuse boundary |
| --- | --- | --- |
| /api/v1/auths and local session flow | Native local account authority | Preserve existing auth/session fences; test against new frontend sign-in/claim UI. |
| /api/v1/companies, /api/v1/bot-directory | Company authority and bot registry | Empty local bootstrap schemas add no membership or bot grants. |
| /api/v1/starli/companies/.../messaging | Company DM/room/turn runtime | Preserve membership, per-bot permissions, causal run binding and native receipts. |
| /api/v1/starli/public/grokbot1/intents/{intentId}/workspace and .../messages | provider-integration-r1/guest_workspace.py | Guest identity/session binding and refresh are additional joined services, not provided merely by old dashboard health. |
| /api/v1/starli/grokbot1/claims/{intentId}/execute | native-wiring-r3/native_claim_execution_routes.py | Claim binding plus reviewed dispatcher; no fallback fixture. |
| /api/v1/starli/orchestration/graphs/{graphId}/progress and .../stop | Native worker/orchestration integration | Stop must be truthful about physical work and preserve recorded receipts. |
| Preview/app frame routes | Reviewed preview controller + lease lifecycle | Preserve per-tenant enrollment, origin rules and scoped capabilities; generic local-owner VM is not company enrollment. |
| /api/v1/panels, /api/v1/companies/... resources | Native panels/drive/sheets/email | Confirm response shape in actual product panels; prior component tests do not prove new-UI compatibility. |
| /api/customer/v1 and account MCP routes | Native customer bridge / account registry | Keep public-resource URLs separate from internal service origins; no original-domain fallback. |
| /ws/socket.io | Realtime upstream | Gateway must support upgrade; frontend path is not enough to prove the server speaks this transport. |

Old component evidence that remains useful: Windows owner/DACL storage policy, protected account/provider vaults, Windows memory CAS and locking, restricted Node SYSTEMROOT/profile handling, configurable internal/public origins, and local-owner VM controls with explicit private-admin/platform grants. Reuse those implementations and tests without grafting old frontend navigation onto the new product.

Joined backend launcher assembly-r1/scripts/start_native_chat.py imports:
claim-review-r1/native_auth_staging.py; guest-session-refresh-r1; assembly adapters; provider-integration-r1; native-wiring-r3; preview-lifecycle-r1 when configured. Extract code and dependency metadata only. Rebuild fresh state using supported constructors/onboarding. Never package the demo's runtime-private config files, controller keys, profiles, /tmp native root, preview-state, SQLite, cookies or generated customer projects.

## Portability blockers for source owners

- assembly-r1/adapters/native_company_chat.py:5 hardcodes an immutable production backend release.
- The same adapter:62 requires a disposable /tmp prefix and UID997. Do not delete that check to make startup pass; replace it with a reviewed fresh local-root/owner policy using the existing private filesystem guarantees.
- The joined launcher requires --root, --origin and --port in addition to STARLI_INSTANCE_NONCE. STARLI_PRIVATE_OPENROUTER_KEY_FILE is a BYO file path; no production key is copied. Optional STARLI_PREVIEW_CONTROLLER_URL and STARLI_PREVIEW_CONTROL_KEY remain unconfigured until a local controller is provisioned.
- The joined record says chatToolsExposed=false, deterministic native workers used zero model calls, and productionReady=false. Do not infer full autonomous production readiness from a successful chat demo.
- Enterprise source still contains original API/MCP/social/preview addresses in CompanyApps.svelte, account/CustomerAPI.svelte, social/company-social-client.ts and panes/published-preview.ts. The frontend owner must replace active defaults/allowlists with operator-owned local/public destinations while keeping safety validation. These are not fixed by backend environment variables alone.
- Newer next-v10..12 sources require re-pinning and joint review before adoption.

## Ownership and acceptance

AgentX7 owns config templates and this backend-reuse/configuration contract. No source edits in product/, Desktop, active server workspace or new joined adapters were made in this task. AgentX1 must confirm source pins/current candidate; AgentX2 owns extraction/front-end adjustments/visual comparison; AgentX3 owns joined backend adapter portability. Existing live ULTRA BO$$ work is read-only to this extraction task.

Next acceptance must run on fresh local state with the selected candidate: cosmic entry -> guest workspace -> sign-in/claim -> Starli/Boss/teams -> actual company DM, provider catalog, per-agent grant boundaries, save/read/reload and truthful Stop. Any unavailable BYO provider or controller must report configuration-required, not fabricated success. Old-UI pass counts are not new-product acceptance.
