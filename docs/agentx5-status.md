# AgentX 5 — installer and native startup

Owns installer/ and docs/install.md. Directory contract confirmed: platform/ and dashboard/. No production writes, service changes or publication.

## Delivered

- Portable Node Compose launcher plus PowerShell/POSIX wrappers; diagnostics, local secret init, build/start/health-wait/stop/status/log/config and dry-run.
- Compose app isolation: platform Node24; dashboard Node22 frontend and Python3.11 runtime. Loopback published ports, fresh persistent volumes. Preserves workspace_entry:app adapter. Optional extended MCP/task-worker services are explicit, not a parity claim.
- Docker context exclusions for environments, databases, keys, caches and dependencies. Compose deployment is not the computer-use VM.
- Native launcher: official checksum-verified Node22 bootstrap, separate Node24/npm and Node22/npm, uv Python3.11 venv, split frontend/backend installation, upstream build, foreground owned-process lifecycle.
- Native dashboard safe defaults: authentication on; signup, remote model APIs, community sharing, messaging and version check off; offline mode; stable generated session secret in ignored local.env; isolated local state. Process env overrides defaults.

## Actual Windows checks

- Node24.19.0/npm11.17.0 and official Node22.23.5/npm10.9.9 verified. Node22 archive SHA256 4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3.
- Native platform npm ci PASSED (360 packages; npm reported 2 moderate/1 high vulnerabilities, not auto-fixed).
- Native platform API starts on 127.0.0.1:4100; /health returned {"ok":true,"service":"starlidigital-api","database":true}. Running for integration/QA in launcher session.
- Full platform npm build FAILED: oauth/trusted_clients.ts strict-nullability errors; schema.ts PasswordAccount typing; server tests import missing src/business-events.js. Integration/source owner must resolve; no installer claim of full build success.
- Compose config --quiet PASSED. Docker CLI + Compose v2.40.3-desktop.1 exist, but engine info hangs; no container build/start validated.
- Node syntax checks, native doctor all, PowerShell dry-run and Compose config checks passed.
- uv Python3.11.9 venv created at installer/.runtime/python. Full requirements resolution PASSED (321 packages); package downloads/native builds still running. Backend startup is the next gate.
- AgentX9 owns dashboard frontend build in isolated scratch. AgentX5 avoids redundant npm install and owns shared Python backend startup.

No macOS/Linux native execution, Docker image build, desktop VM integration or full feature parity has been established by these checks. Remaining app services/providers require explicit config/integration.

Native readiness command added: `node installer/native.mjs health platform` returns health HTTP200. `health all` independently checks both loopback health endpoints with a five-second timeout. Python downloads continue; no backend readiness claim yet.

Topology aligned per Prime: native STARLI_PLATFORM_ORIGIN explicitly points to http://127.0.0.1:4100. Compose dashboard/task-worker share the platform network namespace so the strict portable origin helper can use loopback HTTP without relaxing its HTTPS/loopback validation. Platform publishes both host loopback ports; dashboard gets platform-data read-only at /platform-data and STARLI_SOURCE_DATABASE=/platform-data/starli.sqlite for identity bridge. Compose config validation rerun after alignment.

Correction after exact identity-source inspection: ensure_native_customer() in dashboard/backend/open_webui/routers/starli_customer_identity.py lines50–73 opens source_database() for writes, creates webui_customer_identities and inserts a password-disabled service user. Compose platform-data mount is therefore RW for dashboard/task worker; prior read-only status is superseded. This is fresh LOCAL state only. Native uses the same fresh platform/server/data/starli.sqlite path. Database mutation features require this contract; do not claim read-only safety.

Prime/packaging coordination update: AgentX9 reports refreshed platform root build PASSED and tests 483 passed/2 skipped; earlier source blocker list is historical and may be resolved. AgentX5 rerunning current shared native build now. Full Python uv install still downloading large wheels, no startup result yet. AgentX9 moved hash-lock generation to isolated cache to avoid contention.

Current shared native platform build PASSED end-to-end via node installer/native.mjs build platform: server/control-plane/cli/device/web. Earlier source failures are resolved in current shared tree. Native API health remains HTTP200. Remaining AgentX5 blocker is full Python dependency download/install, then dashboard workspace_entry startup and auth/config health checks.

Provider runtime correction: native STARLI_RUNTIME_CODE_DIR now targets platform/extensions/starli-runtime per Prime restoration contract. It does not currently exist; no provider-execution readiness claim. Core app startup and provider setup are independent gates. Dashboard provider subprocess also needs Node/tsx dependency resolution from its working directory; awaiting extension dependency contract before wiring final NODE/PATH.

Native provider NODE now explicitly selects the verified Node24 executable through STARLI_NODE_BINARY; dashboard frontend remains Node22. Provider subprocess cwd is runtime_code_dir, so restored extension npm dependencies must be available there or its platform ancestors. Docker dashboard currently has Python only and does not include that not-yet-restored Node runtime; Compose provider setup remains an explicit unvalidated integration gap.

Packaging's reviewed target Python3.11 hash locks are now adopted by native backend install (Windows x64, Linux x64, macOS x64/ARM64): validates metadata/source/lock hashes, invokes uv --require-hashes, fails on stale/missing lock. Current initial unpinned install finishing; will revalidate against hashed lock next. Native owner flow sets STARLI_LOCAL_VM_ENABLED=1 per Prime; actual routes retain admin/private-binding/Bearer/origin checks. No default Compose VM bridge enabled.

Python install COMPLETED: all321 packages installed after 10m56s preparation/download and24.93s installation. Not hung: downloads continuously progressed, native peewee/docx2txt/langdetect/etc builds succeeded. Now running hash-lock revalidation and actual workspace_entry backend startup. Readiness not yet claimed.

Hash-lock install PASSED (322 pinned packages; hf-xet added, soupsieve aligned). First actual backend launch failed because generic inherited DATABASE_URL selected a PostgreSQL DSN with unsupported schema option. No inherited URL value printed or copied. Native launcher now forces its fresh local SQLite URL unless the operator explicitly supplies STARLI_DASHBOARD_DATABASE_URL; retrying. This prevents accidental host-service DB inheritance.
