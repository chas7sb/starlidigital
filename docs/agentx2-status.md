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

## ManageOllama runtime bug fixed

Prime-requested undefined createModelTag fix completed in dashboard/src/lib/components/admin/Settings/Models/Manage/ManageOllama.svelte. It was a progress-label reference, not a missing API helper. Existing createModel API remains in use. Added declared progress tag captured from the exact create request payload, preserving existing JSON model override behavior, then cleared with the other creation state. Feature not removed or warning suppressed.

Validation: Svelte compilation passes with no undefined createModelTag diagnostic. Executed actual extracted createModelHandler with mocked existing API to verify form tag, JSON override, request/label agreement, completion cleanup, and invalid JSON preventing request while clearing loading state. No live model creation performed. AgentX9 rebuild handoff: include updated ManageOllama.svelte in final snapshot; source change is justified runtime fix.

## Windows workspace fix active

Prime assigned AgentX2 filesystem functions ONLY in backend/open_webui/routers/starli_workspace.py to fix authenticated file PUT failing on POSIX flags. AgentX7 please avoid this file temporarily. No backend configuration changes planned. Will reuse existing private ACL/handle primitives, retain POSIX implementation, add Windows held-ancestor/no-reparse/hardlink/private-ACL tests, then hand off actual HTTP rerun to AgentX8.

## Windows project filesystem handoff READY

Fixed starli_workspace.py filesystem functions with Windows branch; POSIX dirfd code retained. Windows pins every ancestor with handles denying both write and delete sharing (prevents rename and reparse mutation), opens no-follow/reparse-point handles, validates current-user protected DACLs, rejects hardlinks/nonregular/reparse files, bounds reads, creates private temporary files, flushes and atomically replaces via MoveFileExW WRITE_THROUGH. Rollback unlink now dispatches through anchored Windows parent. Windows aliases/ADS/device names rejected. No authentication, API, DB or config logic changed.

Six actual Windows filesystem tests PASS, no skips: write/read/replace with private ACL, blocked ancestor rename while held, hardlink read/replace rejection, final + ancestor symlink rejection with unchanged external target, broad ACL rejection, Windows aliases. Tests execute actual helpers from source through AST isolation to avoid booting unrelated application workers; no fake Windows APIs.

AgentX8: restart/reload local dashboard backend and rerun actual authenticated project PUT/read. Fresh project/create/detail were already passing per Prime. Prior process must reload this source. Owner-only paths created by earlier code remain fail-closed if ACLs broad; do not silently repair them. AgentX7: filesystem patch complete; this file can be read but coordinate further edits. Additional POSIX regression validation being prepared.

CORRECTION / STILL ACTIVE: stronger reparse-mutation probe showed metadata-only handles do not enforce the earlier claimed write-sharing denial; forcing listing access then breaks Windows atomic rename. Initial six tests passed, but no release claim should rely on that sharing assertion. Implementation now uses NtCreateFile/NtSetInformationFile rooted directly in held parent handles, with OBJ_DONT_REPARSE and explicit no-follow, to prevent junction traversal even if a directory is mutated. Actual reparse-mutation regression under test. AgentX8 please wait for next READY note before HTTP rerun.

WINDOWS FILESYSTEM READY (supersedes earlier implementation notes): eight real Windows tests now pass, including actual FSCTL junction mutation, blocked ancestor rename, hardlink/symlink rejection, private ACL validation, UTF-16 filename handling, read/write/replace and Windows aliases. The final implementation uses NT RootDirectory-relative opens for EVERY directory component and file operation, protected current-user DACLs on exclusive creation, OBJ_DONT_REPARSE/no-follow flags, held ancestor handles without delete sharing, and root-relative atomic rename/unlink. Thus neither traversal nor file creation/rename can be redirected through a concurrently changed junction. File data is flushed before atomic NT rename; no unsupported WRITE_THROUGH durability claim for NT rename is made. Linux POSIX path preserved.

AgentX8/Prime: reload local backend source and rerun authenticated project file PUT/read now. AgentX2 owns only filesystem helpers and rollback unlink dispatch in starli_workspace.py plus backend/tests/test_workspace_windows_io.py. No backend auth/config/DB route edits. Full API success not claimed by AgentX2 yet; awaiting AgentX8 observed result.

Final filesystem verification: all eight tests also PASS using the installation's actual Python 3.11 executable, including anchored rollback unlink. Actual current POSIX helpers exercised through private SSH Python stdin using only a disposable /tmp directory: create/read/replace, hardlink rejection, ancestor rename detection PASS; no services touched or production paths written. Windows helper suite remains in backend/tests/test_workspace_windows_io.py for regression.
