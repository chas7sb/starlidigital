# AgentX 7 — configuration and dashboard portability

Completed seven safe config templates, source names inventory, original dashboard dependency inventory and BYO integration documentation. Subsequently authorized dashboard/backend portability patch is complete; config/portability-changes.json lists every affected source/test file.

Central backend/starli_portable.py resolves local config/data/platform/runtime/workspace paths, PATH executables and explicit service/public origins. Active production /srv,/opt,/etc and /var fallbacks were replaced; callback/origin checks follow the configured deployment while preserving authentication, strict allowlists, cookie security and broker verification. Shared Node database defaults to platform/server/data/starli.sqlite. Optional providers still require BYO config; absent broker files remain unavailable.

Validation passed: 8 isolated unittest cases and complete backend Python compilation. No live service/provider/OAuth/VM tests. No production writes, service operations, publication or ledger edits. No platform/ changes. Historical snapshots, tests and QA stage roots intentionally unchanged. Existing old-production-IP SSRF deny rules and POSIX broker trust checks preserved.

Integration constraints for Prime/AgentX2: keep backend/starli_portable.py in the backend Python import path; preserve local patches if re-extracting source. Installer must supply origins for its topology; first-party MCP execution uses the server-configured internal control-plane origin; its public resource URL is separate. runtime/vendor reviewed network bundles and Python/Node package dependencies must be supplied by runtime/source owners. Original config/dashboard-dependencies.json is pre-patch evidence, not a remaining-blocker list.

## Integration update: internal services

Implemented service_origin() for explicit operator HTTP(S) origins, including Compose DNS/private IP endpoints, with no credentials/path/query/fragment and strict host/port syntax checks. Public/callback origin validation stays HTTPS-or-loopback. platform_url/company_platform_url/control_plane_url use internal validation; separate platform_public_url/control_plane_public_url retain strict public validation. MCP public resource and transport URLs are now distinct; OAuth back-channel/API requests use internal addresses while authorization URLs retain public issuer addresses.

Defaults aligned to port4100 and platform/server/data/starli.sqlite. Tests now 8/8; complete backend compilation passes. Config templates and docs updated.

AgentX5 contract: Compose dashboard+task-worker should supply STARLI_PLATFORM_ORIGIN=http://platform:4100, STARLI_CONTROL_PLANE_ORIGIN=http://control-plane:4120, STARLI_COMPANY_PLATFORM_ORIGIN=http://platform:4100; public origins remain browser-reachable localhost/HTTPS URLs. Mount platform-data at e.g. /platform-data read-only and set STARLI_SOURCE_DATABASE=/platform-data/starli.sqlite. Backend ownership does not include installer edits, so those environment/mount entries are pending AgentX5 integration. Native source DB default matches installer/native.mjs. Native/custom published ports should supply matching public-origin settings.

## Windows privacy API available

Shared reusable module: dashboard/backend/starli_private_fs.py. API require_private_file(path) validates an existing absolute regular file AND immediate parent directory without reading contents, creating files, repairing ACLs or changing modes. Raises PrivateStorageError (OSError subclass) or OSError; callers must fail closed. Windows uses GetSecurityInfo on no-follow handles, current token SID ownership, protected DACL, rejects non-current-user/non-LocalSystem access grants, reparse points and file hard links. It requires current-user full control. POSIX requires current uid, owner-only modes, no symlinks and single-link regular file. Existing permissive ACLs are deliberately rejected. ensure_private_database(path) atomically creates missing Windows objects with protected current-user-only ACL then validates. POSIX creation/checks preserve original account-MCP behavior. Provider-infer can load this exact server-owned module and call require_private_file(path); do not catch-and-allow.

Windows smoke creation+validation accepted current-user private directory/file. Broad ACL and actual backend startup checks are next. AgentX5 must use a fresh account-mcp directory if prior failed startup left a permissive empty directory; this API never silently grants privacy to existing broad storage.

## Windows startup and privacy COMPLETE

Actual native backend launched through node installer/native.mjs start dashboard with a fresh isolated AgentX7 scratch DATA_DIR (port8087). /health returned HTTP200 {status:true}; /api/config HTTP200; unauthenticated /api/v1/starli/providers and /api/v1/bot-directory returned403. Owned smoke process was stopped afterward;8087 no longer listening. Messaging remained enabled at installer default1; no authentication or company/computer enrollment bypass.

All account-MCP stores now use shared backend/starli_private_fs.py via account_mcp/private_storage.py. Windows current-user-owned protected DACL creation/validation works; actual Everyone-read grant, broad inherited directory, symlink and hard-link cases are rejected. Existing broad directories are NOT automatically repaired. require_private_file(path), ensure_private_directory(path), ensure_private_file(path) (alias of ensure_private_database), and create_private_file(path,bytes) (exclusive, no overwrite) are available to provider-infer. Parent+file privacy checks never read credential contents.

starli_providers.py now creates providers root, accounts.sqlite, master.key and per-owner homes using those helpers. Provider route/storage tests pass with mocked catalog only; real Fernet encrypted round-trip and shared helper validation pass. No external provider login/inference was performed.

POSIX correction completed: directory checks use O_DIRECTORY|O_NOFOLLOW then opened-fstat owner/type/mode checks. Database creation uses O_NOFOLLOW|O_NONBLOCK then current-euid/single-link/regular-file/mode checks, rejecting foreign-owned0700/0600 and FIFO/device storage before SQLite. Metadata tests passed; actual mkfifo test exists and is skipped on Windows (no POSIX filesystem execution claimed).

Memory remains enabled: starli_memory/windows_io.py provides protected ACL files, no-reparse ancestor validation with held no-delete directory handles, bounded Windows byte locks and flushed exclusive files plus atomic MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH). The existing CAS/HEAD/history/deduplication algorithm is shared; original POSIX dirfd/flock path remains. backend/starli_file_lock.py mirrors integration child's stdlib runtime_file_lock implementation so dashboard does not require an external source-tree import. Only former unconditional fcntl import found in backend was starli_memory/store.py; now POSIX-conditional.

Windows memory tests pass: CAS conflict/idempotency/history; before-HEAD failure rollback; broad root refusal; held ancestor blocks rename; added hardlink to revision yields MEMORY_UNSAFE_PATH;3 concurrent Python subprocesses preserve30 updates(final revision31 including initial revision). No memory feature was disabled.

Further startup fixes: fresh enabled messaging bootstraps EMPTY authority/bot-registry schemas only at configured local DATA_DIR missing-file paths, with exclusive creation, no overwriting external/existing mappings and no membership/bot/enrollment seeding. Optional enterprise messaging/SMTP mounts now retain authenticated503 config-required endpoints when their underlying runtime is absent instead of crashing core startup. Configured runtimes still install original implementations.

Requested bridge child-env whitelist now includes only trusted server STARLI_PLATFORM_ORIGIN, STARLI_WORKSPACE_ROOT and PYTHON_BIN in starli_tools.py. No browser/request paths or commands were admitted.

Final tests on target Python3.11: configuration8 passed; private storage9 run,8 passed/1 POSIX FIFO skipped; Windows memory6 passed; provider storage/routes3 passed. All4 MCP constructors passed additional smoke. Full backend compilation passed. Nonfatal offline embedding-cache/telemetry/dependency warnings still appeared during boot and are outside this storage patch; no model/provider readiness claim.

## Urgent actual provider catalog fix

Reproduced exact server child environment (PATH/LANG/HOME only): Node24 aborted with exit134 and CSPRNG initialization assertion before any SDK output. Adding SYSTEMROOT alone returned exit0 and42 providers, stderr empty. starli_providers.environment() now passes SYSTEMROOT from trusted host OS settings on Windows and sets USERPROFILE to the isolated per-owner HOME. It still excludes operator API keys, cloud credentials, proxies and unrelated profile directories. Added regression checks. Actual8280 server was temporarily down during initial authenticated probe; restart required for code reload. Current follow-up is actual authenticated API verification after AgentX10 restart. No providers were fabricated and no provider credentials used.

## All filtered Windows Node paths fixed; ACTUAL authenticated catalogs PASS

Central starli_portable.child_environment() now adds trusted SYSTEMROOT on Windows, sets USERPROFILE/AppData locations to the isolated HOME, remaps a missing or operator-profile HOME to private child-homes/default, and never adds API keys/proxies/operator profile auth. Applied to every filtered Node subprocess and broker launch in provider catalog/auth, tools bridge, primary Pi worker, runtime adapter, project build, intelligence, session revocation, account-MCP remote, company provider catalog/install, company Node runner and company vision. Existing explicitly selected caller capability variables remain intact. AgentX2's starli_workspace.py was not edited.

Exact restricted-env REAL Node tests: SDK catalog exit0,42 providers/1712 models without credentials; platform bridge exit0,113 tools, isError=false. Native failure exit134/CSPRNG assertion is eliminated by SYSTEMROOT; no fake catalog or inference fallback was added. Added actual-Node SDK regression and credential/profile exclusion checks.

Actual authenticated original QA API at http://127.0.0.1:18280 reproduced HTTP502 Provider operation failed before restart. QA credentials were read privately and never printed, copied into logs, or included in source. A separate new-source QA backend was launched at http://127.0.0.1:18282 using the same disposable QA owner/state and session secret. On18282, real sign-in followed by GET /api/v1/starli/providers returned HTTP200 with42 items; GET /api/v1/starli/tools/catalog returned HTTP200 with69 account-authorized tools, no isError. These were real authenticated application routes and real SDK/bridge calls, not mocked catalogs.

RESTART COORDINATION FOR AGENTX10/8/PRIME:18280 still runs old imported code and needs owner-controlled restart to load source changes. Fixed alternate18282 is currently available for browser QA; supervised by AgentX7 exec session55041 (Python parent + uvicorn). Do not accidentally stop the original VM/browser QA process. Prime can reuse18282 temporarily or have AgentX10 restart18280, then stop this alternate. Any tool/provider/backend worker started before this patch needs reload. No external AI credentials/provider login/inference were used.

Encoding interruption during bulk edits affected starli_pi_master.py; restored its current tracked Git version and reapplied the child environment wrapper as UTF8. Syntax compilation passes; other source owners' workspace changes untouched. Updated review manifest includes all central-helper call sites.

## QA handoff complete

Prime reports original18280 controlled reload passed42providers/69tools, VMframe,11owner checks and10extended features. AgentX7 independently verified original18280 /health HTTP200, then stopped ONLY its alternate18282 QA session55041. Original18280/18281 and VM were not stopped. Prior restart-pending note is superseded. No files were cleaned up.
