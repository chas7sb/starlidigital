# AgentX 2 dashboard extraction status

2026-11-22: Existing dashboard frontend transferred privately from authoritative active webui release native-company-mcp-always-v33-20261119. 4,373 source/static asset files verified against per-file SHA256 manifest and extracted into dashboard/. No marketing routes identified; all routes preserved. LICENSE retained unchanged (Timothy Jaeryang Baek, 2023–2025, BSD-style three conditions).

Dashboard Python backend and search-gateway archive now transferring (585 allowlisted source/runtime asset files). Includes workspace_entry.py and open_webui modules; dependencies, Python caches, data, uploads, databases, generated application builds omitted. static/pyodide cache omitted and restored by existing prepare-pyodide.js build step.

No services changed. No public transfer or publication. Build/runtime validation pending; release not yet certified.

Extraction update: backend + search-gateway transferred and verified (585 files). workspace_entry.py and open_webui/starli_task_worker.py are present. 513 Python files parse successfully with ast.parse; no syntax failures. Basic credential-pattern scan yielded one intentional fake-key test fixture only (test_starli_result_status.py). This is not a full privacy audit.

A supplemental 17-file archive adds .mts provider/runtime source, webmanifest, empty CSV import template, migration README and ignore notices omitted by initial extension allowlist. No existing backend files will be overwritten. AgentX7 may patch existing backend config now. AgentX5 owns dependency/build validation; local Node is 24.19.0 while frontend requires <=22. No npm install attempted by AgentX2.

COMPLETE: 4,975 upstream files extracted and hash-verified (4,373 frontend/static + 585 backend/search + 17 supplement). No marketing routes removed because none identified. Supplemental .mts provider sources and empty import CSV now present; no backend patches by AgentX2.

Frontend portability audit fixed two production assumptions: Intelligence now defaults to same-origin /graphql, with explicit VITE_STARLI_INTELLIGENCE_ENDPOINT supporting HTTPS or local-loopback HTTP; Social auth destination now defaults to same origin, with explicit VITE_STARLI_SOCIAL_AUTH_ORIGIN. Credentials/query/hash/incorrect path rejected by Intelligence resolver. Nine focused resolver assertions passed. Remaining starlidigital references are an invalid placeholder URL in safe-render and author attribution in function template, not production API destinations. AgentX9 should build the latest frontend snapshot after these changes.

Backend: all 513 Python files passed AST syntax parsing. Dependencies, startup, integrations, cross-platform runtime, browser/VM parity remain for integration owners. Local Node24 is outside original frontend engine range; no duplicate dependency install/build run per Prime instruction.

## Setup UI coordination (active)

AgentX2 is adding top-level /setup outside (app) layout, reusing existing Providers.svelte for actual connect/session/model-selection operations. Existing auth first-run signup will return to /setup; ordinary sign-ins preserved. Setup shows authenticated account state and only confirmed provider state, with refresh and settings/chat links. Existing Providers UI already supports API keys, OAuth/device-code and model choice from installed Pi catalog; no duplicate credential handling planned.

AgentX10: please record concrete supported initial-admin provisioning command/flow in your status when discovered. Current launcher disables signup, so UI will link existing sign-in and avoid claiming an account can be created until real backend config permits it. AgentX9: build handoff will follow in this status once new components ready.

Setup UI source ready for build handoff: new dashboard/src/routes/setup/+page.svelte and lib/components/starli-setup/SetupPanel.svelte. Reuses original Providers.svelte; added state event and explicit Refresh, corrected unselected account's misleading managed-model text. Auth first-run signup redirects to /setup, skips promotional OnBoarding overlay, and links local setup from sign-in. Pending/unsigned accounts do not render credential controls. Setup distinguishes saved credentials/model selection from successful inference.

AgentX9: please use latest four frontend files (new route, new SetupPanel, Providers.svelte, auth/+page.svelte) in build snapshot. No duplicate npm installation by AgentX2. AgentX10 CLI provisioning command still pending; setup currently refers to local installation guide when signup is disabled.

Setup UI validation complete: all five changed Svelte files compile with the installed Svelte compiler and TypeScript preprocessing, zero compiler warnings. Five state assertions passed: empty account; saved credential count; valid selected provider; disconnected selected provider; failed status request. Source-only check used AgentX9 scratch dependencies read-only; no duplicate dependency installation.

Fifth build handoff file: lib/components/chat/SettingsModal.svelte now links /setup for later access. Existing sign-in retains safe relative redirect validation. New /setup lives outside the protected app layout so fresh installations can reach account guidance. First-run signup uses existing auth endpoints, not a new bootstrap or database mutation. Installer should open /setup and documentation should direct users there after account provisioning. CLI command intentionally not invented; waiting for AgentX10 auth discovery before adding any concrete CLI instructions.
