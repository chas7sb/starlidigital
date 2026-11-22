# AgentX 10 status

Updated: 2026-11-22. Ownership limited to `docs/README-draft.md`, `docs/architecture.md`, and this file.

## First-run implementation follow-up

LATEST RETRY (ports18280/18281): full fresh bootstrap PASSED again with new administratorEmail policy and owner company. Windows account-MCP ACL source fix cleared prior gate. Dashboard now fails before HTTP listener on unconditional `import fcntl` in `dashboard/backend/starli_memory/store.py`; AgentX5 independently reports same remaining source blocker. No HTTP sign-in, VM bridge, or frame success is claimed from this attempt. All test service children stopped by harness. Disposable private state/logs: work/onboarding-e2e-002f46dd2c5a. No credentials emitted.

QA harness now supports `--serve` to retain a successfully tested instance for Prime visual QA; uses18280/18281, stores credentials/processIDs/result/frame only in ignored private work state, and checks authenticated VM status+PNG without any guest input. Five helper tests pass. Setup environment now also overrides inherited STARLI_DATA_DIR/config/workspace/assets/videos with own private paths; provider Node24 resolves to an absolute executable so dashboard Node22 PATH cannot accidentally select the wrong provider runtime. Ready to rerun after fcntl source portability fix.

CURRENT RESULT: dashboard Python dependencies installed. Actual disposable setup PASSED with application migrations, dashboard admin insertion, Node admin insertion, explicit private binding and fresh owner company. Initial real dashboard startup exposed Windows CP1252 banner failure; onboarding environment now sets PYTHONUTF8=1/PYTHONIOENCODING=utf-8 and exact local CORS. Retried full services: Node API started on loopback18981, dashboard failed before HTTP listening at main.py:997 -> oauth_connect.Store:52 with MCP_OAUTH_STORAGE_DENIED (Windows st_mode POSIX permission test; subsequent os.O_NOFOLLOW also needs portable source handling). AgentX5 independently recorded the same blocker. No source bypass applied. Full real sign-in/admin/customer/company HTTP checks remain pending this source fix. Test-owned services were stopped by harness. Five helper tests and syntax checks pass.

VM handoff implemented: private native onboarding env explicitly sets STARLI_LOCAL_VM_ENABLED=1; check performs Bearer+same-origin read-only local-vm/status and reports no guest readiness/control inference. No VM start/stop/input was called. Provider runtime directory corrected to platform/extensions/starli-runtime, with Node24 selected. Node owner now imports administratorEmail and supplies the entered operator email through in-memory process.env.ADMIN_EMAIL; explicit ID binding remains authority. README production suffix claim removed.

Latest follow-up: company authority is now included. Inspected mounted `/api/v1/companies` route factory and actual inherited `Authority.create`. Added explicit company-name prompt; trusted creation of a fresh company with dashboard owner membership; authenticated list and capabilities checks. Important integration detail: mounted routers/companies.py uses DATA_DIR/company-authority.sqlite3 directly, so helper sets STARLI_COMPANY_DATABASE to that identical path rather than a different company.sqlite file. Node owner script now imports new source accountEmail policy with local.invalid domain. Source ownership remains unchanged.

Latest QA attempt after preflight improvement: qa_e2e.py fails cleanly before setup/config/database creation because all required dashboard modules are still absent in shared venv (typer, uvicorn, fastapi, sqlalchemy, alembic, passlib, bcrypt, peewee, peewee_migrate, redis, jwt, pytz, markdown, bs4, requests, pydantic). Synthetic credentials/logs remain in private ignored work only. Full HTTP test is ready to rerun once AgentX5 finishes requirements installation. No additional package installation was started by AgentX10.

Actual model validation PASSED: Node administrator created in disposable own database with qaowner@local.invalid; second owner bootstrap refused; actual company Authority.create/require_member/list_companies returned the fresh owner. Four helper security/state tests plus Python/Node syntax checks PASS. Full disposable qa_e2e.py attempt still stopped at missing typer in the shared Python venv before account creation; downloads/install remain owned by AgentX5. No HTTP sign-in/identity/company route success is claimed yet.

Frontend coordination: new `/setup` reuses Providers and is documented as post-CLI owner setup. Its existing conditional “Create administrator account” public-signup branch conflicts with auths.py's zero-user 503 policy; AgentX2 should replace that branch with trusted local CLI setup instructions. No dashboard source edited here. QA harness is ready: installer/.runtime/python/Scripts/python.exe onboarding/qa_e2e.py (POSIX equivalent uses bin/python). It launches isolated ports 18980/18981, keeps generated credentials only in ignored private work state, checks real sign-in/admin/customer identity/company authority and unauthenticated denial, and stops its own children.

Prime additionally assigned `onboarding/`. Implemented interactive first_run.py setup/start/check, actual offline dashboard-model owner creation, actual Node Store/hashPassword owner creation through stdin, private explicit admin bindings, fresh shared source database configuration, stable generated session secret, literal-loopback and redirect/proxy restrictions, and credential-free output. Native-only helper; existing services/databases untouched.

Identity finding: no missing ordinary customer bridge: ensure_native_customer already creates nonce-checked password-disabled Node service users. Platform administrator reads require explicit STARLI_BINDINGS_PATH mapping plus both native admin roles. Public signup intentionally returns 503 on zero users, requiring trusted offline owner bootstrap. Helper creates the explicit admin mapping and now the separate company owner authority through its supported model. Bots remain outside this helper.

Validation: Python compilation, Node syntax and loopback validation passed. Actual disposable offline bootstrap attempt stopped at missing Python `typer` dependency in the shared venv (dependency installation still in progress under AgentX5). No owner creation or runtime API sign-in success is claimed. Disposable partial config is under ignored work/onboarding-qa-*; actual onboarding/.local not created. Source owners need no source edits for the observed customer/admin bridge; installer owner should route fresh native onboarding through onboarding/README.md and preserve the helper's environment on launch.

## Completed

- Read shared Prime ledger and packaging status.
- Inspected upstream source using read-only tools; resolved both current release symlinks directly.
- Drafted self-hosting onboarding, feature map, architectural boundaries, source evidence, and explicit missing release gates.
- Wrote only the three owned documentation files. No production changes, ledger writes, external publication, account mutations, or runtime tests performed.

## Integration findings

- Backend root requires Node >=24; separate existing Svelte dashboard declares Node 18.13–22.x. No shared engine version satisfies both manifests.
- Existing dashboard includes a Python FastAPI/Open WebUI API requiring Python 3.11/3.12. Node root build targets its own `web` workspace, not this separate dashboard.
- Node `static.ts` serves `web/dist`; do not assume that is the existing dashboard.
- Node defaults to loopback port 4100, uses SQLite via `node:sqlite`, and accepts `DATABASE_PATH`.
- Company dashboard calls `/api/v1/starli/*`; proxy/identity integration needs verification.
- Dedicated Browser panel is evidence of a UI surface, not proof of requested VM lifecycle/isolation.

## Validation and blockers

Documentation checked against listed source files; no install/runtime/parity claims made. Packaging, license clearance, sanitized source completeness, provider configuration, full dashboard integration, three-platform verification, and VM acceptance remain release blockers for the integration owners. The draft should become the final README only after these are resolved and concrete launcher commands are available.
