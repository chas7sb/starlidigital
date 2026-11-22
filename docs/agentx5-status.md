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

Second startup completed SQLite migrations, then exposed a Windows console UnicodeEncodeError in upstream startup banner (cp1252 cannot encode characters). Native launcher now forces PYTHONUTF8=1 and PYTHONIOENCODING=utf-8. CORS defaults now explicit local origins; telemetry default disabled. Retrying actual backend. Also honors explicit DATA_DIR when deriving fresh SQLite URL, so first_run.py's private installation stays consistent.

Onboarding integration documented in docs/install.md. first_run.py startup supplies private DATA_DIR/secret/bindings and native now derives SQLite from that DATA_DIR. Ignored unrelated generic DATABASE_URL avoids the observed host PostgreSQL setting. New docs include native health command and hash-lock target scope.

URGENT current native backend blocker after UTF8 fix: startup now reaches main.py line997 install_account_mcp_oauth; oauth_connect.Store.__init__ rejects Windows parent.stat().st_mode & 0o077 and raises503 MCP_OAUTH_STORAGE_DENIED (oauth_connect.py lines50–52), then uses os.O_NOFOLLOW which is also POSIX-specific. Windows permission policy needs real ACL implementation in source, not bypass. Also logged model initialization error pyarrow requires NumPy2.0 found1.26.4 (not fatal at that point); hash locks resolved incompatible runtime ABI. Source owner/Prime must coordinate Windows storage helper; installer will continue Docker/native runtime wiring.

Docker runtime integrated: dashboard build now uses root context, Node22 frontend stage, Node24 provider-runtime npm-ci stage, Python3.11 hash-locked Linux-x64 final image with copied Node24 and restored extension. Explicit linux/amd64 gate until reviewed Linux ARM64 Python lock exists. Native install platform also installs extension lock; native env supplies STARLI_NODE_BINARY/STARLI_NODE_BIN/STARLI_PYTHON_BIN. AgentX7 added reviewed internal service-origin support, so Compose reverted to independent service namespaces with platform/control-plane DNS internals and separate browser-loopback public origins; shared source DB remains RW due actual bridge writes. Config check PASSED.

Source-owner action pending: cannot finish Windows dashboard HTTP startup until oauth_connect.Store supports real Windows private ACL checks (unconditional POSIX bits reject every Windows directory). Do not disable this check. Existing auth provider vault also contains similar POSIX mode policy and needs Windows review. Runtime ABI issue: pyarrow26 import requires NumPy2, resolved environment has NumPy1.26 required by legacy stack; needs compatible pyarrow pin + regenerated hash locks. Request packaging/source owner to coordinate; do not claim resolver success establishes import compatibility.

Isolated native venv compatibility experiment: tested PyArrow21.0.0 (satisfies datasets>=21 requirement) instead of resolved26 to address NumPy1.26 ABI failure. This is a local diagnostic override and intentionally NOT yet a hash-lock claim; packaging must pin compatible source requirement and regenerate target locks before final installer reproducibility. Original lock reinstall would otherwise restore26.

Compatibility experiment PASSED: pyarrow21.0.0 imports with numpy1.26.4; datasets5.0.1 imports successfully. Packaging action: pin pyarrow21.0.0 as reviewed compatibility constraint and regenerate all hash locks. Local venv currently has this diagnostic override. Windows private-ACL source blocker still prevents native dashboard startup; awaiting source-owner fix. No HTTP dashboard readiness yet.

Video runtime isolation implemented: native install platform creates installer/.runtime/video-python separately and installs pinned platform/video-engine/requirements.txt; startup sets PYTHON_BIN to it (STARLI_VIDEO_PYTHON deliberate override). Compose platform image now includes Python3 venv + ffmpeg + pinned video requirements, sets PYTHON_BIN=/opt/video-python/bin/python. Native host ffmpeg found in WinGet Links. Actual separate video venv installation running. Dashboard Python remains isolated NumPy1.26; video needs NumPy2.4.

Separate video venv install PASSED (16 packages), imports Pillow12.3/NumPy2.4/OpenCV4.13/edge_tts verified. Native DATA_DIR now consistently derives all default dashboard state/company/memory paths, so custom fresh-data and onboarding launches do not mix default state. Testing Windows ACL fix using fresh installer/.runtime/dashboard-smoke-v2 (prior failed permissive empty account-mcp dir preserved; no silent repair/bypass).

Windows ACL fresh-state launch now PASSED account-MCP private DB initialization (oauth-connect.sqlite and oauth-external.sqlite created privately). NEXT actual import blocker: dashboard/backend/starli_memory/store.py line3 unconditionally imports fcntl, ModuleNotFoundError on Windows through workspace_mount. Prime/source owner needs cross-platform locking equivalent (do not remove synchronization). Full traceback from native workspace_entry confirmed; no backend HTTP yet. Updated 322-package Windows lock sync PASSED after NumPy1.26/PyArrow21 pin regeneration. Frontend dashboard/build is now available and SHAverified by AgentX9.

Frontend install/build env aligned to CI: ONNXRUNTIME_NODE_INSTALL_CUDA=skip, CYPRESS_INSTALL_BINARY=0, NODE_OPTIONS=--max-old-space-size=6144 for dashboard native and Docker build. Runtime extension has actual locked npm dependencies now. Running actual video render/preview tests explicitly against isolated video Python (no system-Python accidental dependencies).

Actual isolated video tests PASSED:8/8, including Python validation, PNG preview and real small MP4 worker completion. Explicit PYTHON_BIN used installer/.runtime/video-python, not global Python. Docker doctor now bounds captured diagnostics at15seconds; real build/install commands remain unbounded by that short diagnostic limit. Executing actual doctor to verify unavailable engine exits promptly. Current remaining backend import blocker is fcntl in starli_memory/store.py.

Frontdoor contract implemented per Prime: `node installer/starli.mjs install --native` bootstrapsNode22 if absent, native installall including isolated video/provider deps, then buildsall; `setup --native` invokes actual onboarding/first_run.py setup interactively; `start --native` requires onboarding/.local/setup.json then invokes first_run.py start. Native doctor/build/health delegated; --docker is explicit; defaultDocker retained with clear help and no owner-provisioning claim. PowerShell adds -Native/-Docker; POSIX forwards flags. Dry-run/syntax checks passed. Root npm scripts may map to this contract. Install/docs now leads with these3commands.

Memory source now includes reviewed Windows_io path instead of unconditional fcntl. Retrying actual dashboard startup with existing private fresh-smoke-v2 state (its MCP ACL creation already passed). Native doctor all now verifies both Python import sets + ffmpeg and PASSED. Docker doctor verified15s nonzero actionable timeout on unavailableengine. Native frontdoor3command flow dry-runs passed; actual onboarding auth smoke remains source-owner QA and next gate.

Docker dashboard final image now includes the platform source+root npm dependencies as well as provider extension dependencies, with STARLI_PLATFORM_SOURCE_ROOT=/app/platform. This avoids an absent source-root contract for existing dashboard subprocess/features. Built source/keys/runtime data still excluded from context by Dockerfile-specific ignore. No Docker image execution claim: engine remains unavailable.

Memory fcntl fix now passed import. Next startup failure was installer-disabled local in-app messaging: workspace_app unconditionally installs enterprise messaging, which requires main.py's company_messaging store initialized only when STARLI_COMPANY_MESSAGING_ENABLED==1. Native/Compose now enable this LOCAL store/room feature (no production SMTP/provider credentials, no external sends configured). This is required by existing full workspace adapter, distinct from enabling external messaging integrations. Retrying after contract correction.
