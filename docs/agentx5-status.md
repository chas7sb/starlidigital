# AgentX 5 — installer handoff

Ownership: installer/, docs/install.md and this status. All production reads were read-only; no production services, credentials, data, ledgers or publication modified by AgentX5.

## Supported frontdoor contract

From repository root, with Node24/npm, uv and ffmpeg installed:

1. node installer/starli.mjs install --native
2. node installer/starli.mjs setup --native
3. node installer/starli.mjs start --native

Install bootstraps checksum-verified official Node22 if absent, installs platform root + restored provider extension, separate dashboard/video Python environments, dashboard frontend, and builds both apps. Setup invokes actual onboarding/first_run.py setup interactively. Start requires onboarding/.local/setup.json and invokes its private-state start. Passwords are never arguments. Native doctor/build/health delegated. PowerShell -Native/-Docker and POSIX forwarding available. Root bin/npm scripts can use this contract. Native is the default; Docker requires explicit --docker. Docker mode does NOT claim owner provisioning.

## Implemented

- Native Node24 platform/provider + Node22 frontend; verified executable selection; UV Python3.11 dashboard hash-lock install; isolated video Python with pinned Pillow12.3/NumPy2.4/OpenCV4.13/edge-tts.
- Source/lock prerequisites; metadata/source/hash-lock freshness check; CPU-only ONNX frontend install, Cypress binary skip,6GB Node build heap.
- Foreground child-process supervision; local stable secret; UTF8 Python on Windows; explicit local data/state/company/memory/provider paths; platform origin4100; verified Node/Python paths for provider runtime.
- Deliberate dashboard DB URL override is STARLI_DASHBOARD_DATABASE_URL. Otherwise local SQLite derives from DATA_DIR, ignoring unrelated generic host DATABASE_URL (observed host PostgreSQL inherited setting caused first startup failure).
- Local company messaging store enabled because full workspace adapter requires it; source/registry database defaults share company-authority.sqlite3. External providers/messaging transports have no production credentials configured. Model APIs/offline defaults remain disabled/offline unless explicitly configured.
- Docker Compose: Node24 platform+Python video runtime; Node22 dashboard frontend+Node24 provider/platform source dependencies+Python3.11 hash-locked backend; loopback published ports, separate internal/public origins, fresh persistent state. Dashboard shares platform DB RW because identity provisioning writes it. Optional MCP/task-worker profile explicit.
- Docker contexts exclude secret/config/data/dependency/generated trees. Dashboard Linux image explicitly requires amd64 until reviewed Linux ARM64 Python lock exists. App deployment is NOT a desktop VM.
- Compose diagnostics bounded15seconds with actionable unavailable-engine message; real installs/builds do not inherit that short timeout. Start waits HTTP health; no false readiness claim from process launch.

## Actual Windows validation

- Node24.19.0/npm11.17.0 and official Node22.23.5/npm10.9.9 verified. Node22 archive SHA2564a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3.
- Platform clean npm ci PASSED; current shared full build PASSED server/control-plane/cli/device/web. Original extracted source TypeScript/missing-module failures were fixed by source owners, then native build rerun passed.
- Platform API /health HTTP200 with database=true. Earlier raw local API launch remains for integration at127.0.0.1:4100; it predates final video-env wiring, so separate explicit video tests establish that wiring.
- Dashboard322-package Windows hash-lock sync PASSED after reviewed NumPy1.26.4/PyArrow21.0.0 pins. Actual imports plus datasets import passed. AgentX9 supplied dashboard/build after refreshed frontend full build succeeded; no duplicate shared frontend install performed.
- Separate video environment install/imports PASSED. Actual video tests8/8 PASSED using its explicit PYTHON_BIN, including real PNG preview and small MP4 completion.
- Native doctor all PASSED: both Node/npm versions, both Python import sets and ffmpeg. Native frontdoor dry-runs, PowerShell mode forwarding, JS syntax, Compose config checks PASSED.
- Docker CLI/Compose exist (v2.40.3-desktop.1); engine unresponsive. Actual doctor exited nonzero after15seconds as designed. No Docker image build/run claim.

## Startup findings and ownership

Actual workspace_entry launches exposed and drove fixes: inherited generic DATABASE_URL, Windows console encoding, account-MCP POSIX mode checks, memory fcntl import, incompatible PyArrow ABI, local messaging initialization, and missing initial company DB mappings. UTF8/DB/messaging/path fixes are in installer; private ACL/memory portability and compatible locked pins integrated by source/packaging owners. Fresh account-MCP ACL database creation passed. Raw empty-state launch correctly requires EXISTING_DATABASE_MAPPING_REQUIRED, so trusted owner setup is necessary.

AgentX10 owns full fresh-owner/dashboard auth/company/VM end-to-end validation and --serve. AgentX5 attempted its QA only on distinct18380/18381, then stopped only that own process tree per Prime to avoid redundant work. Standard18280/18281 validation was not disturbed. No completed dashboardHTTP/auth/VM readiness claim by AgentX5. Await AgentX10 result for final release claim; helper first_run.environment now supplies local messaging1.

Remaining limits: no macOS/Linux native execution by AgentX5; Docker daemon unavailable; Compose fresh-owner provisioning not implemented; provider inference needs real user credentials and separate check; VM owned runtime/ team. Private scratch/logs/data remain ignored, no secrets printed or published by AgentX5. Documentation matches these limits.

Follow-up: dashboardEnv now includes PYTHON_BIN=STARLI_VIDEO_PYTHON or isolated videoPython(), alongside STARLI_PYTHON_BIN for the separate dashboard/provider Python. This supplies the trusted video runtime to the starli_tools bridge child after AgentX7 whitelist forwarding. Native JS syntax and actual video Python imports passed. Existing explicit process environment PYTHON_BIN remains an operator override through the launch merge.

Final frontdoor correction: NATIVE IS NOW DEFAULT when neither flag is supplied. install/setup/start/doctor need no --native and never select Docker implicitly. --native remains optional; --docker is required for every Docker command; explicit mode conflict fails before launch. Help/docs/wrappers/dry-runs updated, Ctrl+C foreground stop explicit. Six CLI routing regressions passed (default install/setup/start/doctor, explicit Docker status, conflicting modes); Compose config remains valid. Supersedes historical compatibility/defaultDocker statement above.

Host cleanup completed: verified4100 listenerPID121736 ancestry through shared platform tsx/server to original owned native launcherPID154828 (installer/native.mjs start platform). Stopped only that launcher process tree. Ports4100 and8080 now free for firstowner setup. DeliveredQA18280/18281 listeners remain intact (PIDs187492/44616 at verification). No files removed, no unrelated service stopped. Earlier status saying original4100smoke remains running is superseded.
