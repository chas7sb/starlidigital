# AgentX 10 status

Updated: 2026-11-22. This is the current result; the historical section below is explicitly superseded.

## Ownership and completed work

Prime assigned docs/README-draft.md, docs/architecture.md, this status file, and subsequently onboarding/. Implemented the trusted first-owner setup/start/check flow and disposable real-service QA with same-state resume. No production service, production ledger, customer database, packaging workflow, or another agent's source directory was modified.

## Current verified result

Actual Windows runtime checks passed against the existing dashboard Python application and Node platform:

- Fresh application migrations, dashboard administrator creation, Node administrator creation through the actual Store/password functions, and private ID binding.
- Company creation through the actual Authority model, owner membership, and actual BotRegistry schema initialization. No bot identities or grants were fabricated.
- Both HTTP health endpoints; real owner sign-in; platform administrator access; native customer identity resolving to the expected Node owner; company listing and owner capabilities.
- Unauthenticated platform administrator access denied with HTTP 403.
- Authenticated SDK catalog returned 42 providers; authenticated account catalog returned 69 authorized tools without an isError result.
- Same-origin Bearer VM status and a valid image/png frame. No VM lifecycle or guest input command was sent by this QA.
- Controlled resume preserved the same databases and owner/company/Node IDs. Byte-content comparisons confirmed setup.json, owner.json, bindings.json and qa-credentials.json remained unchanged, preserving the session secret and browser authentication.

All 11 onboarding/resume regression tests passed on Windows, and Python/Node syntax checks passed. These results establish the tested core owner/catalog/VM-read boundaries. They do not establish full dashboard feature parity, successful provider inference, tool execution, or native boot on all three operating systems.

## Current retained QA instance

Dashboard: http://127.0.0.1:18280/setup. Node API: http://127.0.0.1:18281.

State remains in ignored work/onboarding-e2e-a73d69bf46c9. Synthetic credentials exist only in its private qa-credentials.json; do not emit them to chat, logs or command arguments. Current qa-processes.json records supervisor 168624 and direct children 44616/80544 (exec session 84673). Verify the current manifest and actual process identities before any future stop; PID values can become stale.

Current qa-result.json records core_passed=true, resumed=true, owner_files_unchanged=true, provider_count=42, tool_count=69 and vm.passed=true. Previous QA results/process manifests are retained privately under history names. The source reload reused this state and did not bootstrap a new owner. The instance is retained for Prime's browser QA and AgentX8's extended checks. Do not launch a competing 182xx instance.

## Identity, paths and privacy fixes

- Public signup deliberately refuses zero-user owner bootstrap. Trusted local setup uses the application's actual migrations, hashing and models before services start.
- Ordinary native customers already have a nonce-checked, password-disabled Node service identity bridge. Platform administration additionally requires the private WebUI-ID to Node-ID mapping plus both native administrator roles. Email equality does not confer authority.
- Node owner creation uses the source administratorEmail policy with the supplied operator email; general account identifiers use local.invalid. No production email suffix is forced by onboarding.
- Company authority uses DATA_DIR/company-authority.sqlite3. STARLI_COMPANY_DATABASE points at that exact file, and the separate configured registry database is initialized through BotRegistry before the full workspace starts.
- Both DATABASE_URL and the native launcher's higher-priority STARLI_DASHBOARD_DATABASE_URL are forced to the same private dashboard SQLite path. The regression test rejects accidental redirection through an ambient override.
- STARLI_DATA_DIR, source database, config, workspace, assets, videos, company and memory paths are explicitly local to this owner state. Local company messaging is enabled because the full workspace requires its room store; no external transport credentials are implied.
- private_write uses shared starli_private_fs.create_private_file. Private directories/files are created with protected owner-only Windows DACLs from the outset; existing broad explicit grants are rejected without repair. private_read validates files through require_private_file before reading configuration, credentials or bindings.
- Actual Windows tests cover explicit Everyone-directory grant rejection, no secret write/no repair, exclusive creation and acceptance by the shared private-file validator.
- Origins are literal loopback HTTP with explicit ports; checks reject redirects and environment HTTP proxies. Local CORS/origins and Python UTF-8 settings are explicit.
- Trusted binary configuration supplies dashboard sys.executable as STARLI_PYTHON_BIN, resolved Node24 as STARLI_NODE_BIN/STARLI_NODE_BINARY, and the isolated video interpreter as PYTHON_BIN. Provider runtime code uses platform/extensions/starli-runtime.
- Source-owner Windows ACL/memory portability and SYSTEMROOT child-environment fixes are now loaded in the retained instance. The real provider/tool catalogs passed after reload; these are not mocked catalogs.

## Controlled resume and CI contract

qa_e2e.py --resume PRIVATE_DIR --serve validates containment under ROOT/work, rejects symlink/reparse traversal, validates private config/credentials/owner/binding and database locations, refuses occupied ports and skips bootstrap. Only QA logs/result/process metadata are rotated; owner files, databases and credentials are reused.

Regression tests cover outside-work and linked-directory rejection, binding mismatch, occupied-port refusal before bootstrap/spawn, and unchanged owner files during actual resumed QA.

The first_run setup, environment, private_read and private_write interfaces remain available for the independently owned packaging/native_boot_smoke.py workflow. AgentX10 did not start a duplicate 184xx instance or edit packaging/CI files. Windows runtime evidence here must not be described as three-OS native-boot evidence.

## Remaining scope and limits

Full dashboard parity remains tracked by docs/feature-parity.md and the integration owners. Provider login/inference, external communications, commercial services, complete tool execution, backup/restore/upgrade/uninstall, release provenance and distribution gates are separate from these owner-flow checks. VM status/frame does not certify guest readiness, input behavior, isolation or portability. Refer to the runtime owner's evidence for those claims.

Use the root README, docs/install.md and onboarding/README.md for current install/setup/start commands. Keep the current QA server running until Prime completes the visual handoff.

## Superseded historical observations

The initial documentation-only inventory preceded implementation and must not be treated as current readiness. Its statements that no runtime tests had run, all integration was unverified, or no launcher existed are superseded by the results above.

Earlier attempts encountered missing Python packages, CP1252 banner output, POSIX-only account-MCP permission checks, an unconditional fcntl import, disabled local messaging, an absent registry database, an ambient dashboard database override, and insufficient private-file ACL creation. Dependencies, source-owner portability fixes and the onboarding changes described above resolved those gates; no bypass or fake factory was used.

The VM briefly reported stopped/503 during export/restart. Subsequent authenticated status/frame checks passed; that stopped result is historical rather than the current QA result. Earlier supervisors 16588 and 205332 were verified and retired. Their historical credentials/process records must not be used for the current service.

The original backend and dashboard Node manifests declared non-overlapping versions. The installer now uses separate Node24 and Node22 runtimes plus dashboard Python, rather than assuming a single Node environment covers the full application.

