# Local installation

These entry points deploy the extracted application. A computer-use VM has its own lifecycle under `runtime/`; Docker application containers do not supply a desktop VM. Full integration readiness, external providers and feature parity must be checked separately.

## Native Windows, macOS and Linux

Install Node 24 or later with npm, `uv` and `ffmpeg` on PATH. The launcher uses Node24 for the platform/provider runtime, Node22 for the dashboard frontend, Python3.11 for the dashboard and a separate video Python environment. Run these commands from the repository root:

```text
node installer/starli.mjs install --native
node installer/starli.mjs setup --native
node installer/starli.mjs start --native
```

`install` bootstraps checksum-verified Node22 if needed, installs dependencies and builds both apps. `setup` invokes the existing trusted interactive owner-provisioning helper; passwords are prompted privately. `start` requires that setup and launches its private installation in the foreground. Setup/start are not successful until they actually complete; Ctrl+C stops the services. Native Windows startup validation is still being completed; see status below. PowerShell equivalents use `./installer/starli.ps1 install -Native` and corresponding setup/start commands. POSIX uses `sh installer/starli.sh install --native`.

Advanced component commands are available separately:

```text
node installer/native.mjs bootstrap-node22
node installer/native.mjs install all
node installer/native.mjs doctor all
node installer/native.mjs build all
node installer/native.mjs start all
```

`bootstrap-node22` obtains the latest official Node 22 LTS distribution from nodejs.org, checks its SHA256 against that release's official checksum file, then extracts it under `installer/.runtime/node22`. This verifies download integrity over HTTPS; it is not signature verification. It preserves an existing runtime directory. Set `STARLI_NODE22` and `STARLI_NODE24` to executable paths to use preinstalled distributions instead. Node/npm must be installed together.

Use `platform` or `dashboard` instead of `all` to install, build, diagnose or start one component. Backend install uses `uv venv --python 3.11` and a reviewed host-specific Python hash lock from `packaging/locks/` with `--require-hashes`. The launcher validates the lock and source hashes first. Locks cover Windows x64, Linux x64 and macOS x64/ARM64; other targets fail explicitly. Use `install-backend dashboard` to skip npm or `install-frontend dashboard` to skip Python. Downloads and native builds can take time. Dependency installation does not establish feature availability.

Native startup stays in the foreground. Ctrl+C terminates its owned child process trees. It reports that processes were launched, not that they are ready. Platform defaults to `http://127.0.0.1:4100/health`; dashboard defaults to `http://127.0.0.1:8080/health`. The dashboard preserves the production `workspace_entry:app` adapter and stores its fresh local data under `installer/.runtime/dashboard-data`. Platform stores fresh data under its source-relative `server/data` unless `DATABASE_PATH` is set. No production data is provided.

Read `config/*.env.example` and `config/` documentation before integrating services. Copy only reviewed local settings into the appropriate component environment file or process environment. The native launcher does not import every config file automatically. It generates/preserves the session secret in ignored `installer/local.env`, enables authentication, disables signup and remote model APIs, enables offline mode, and isolates mutable dashboard state. Explicit process environment overrides these defaults. A fresh authenticated account still requires a reviewed local provisioning flow; the launcher does not insert an administrator into a database. Set provider credentials privately; do not reuse production databases or session secrets. Local start covers the API and dashboard, not the MCP control plane, task worker, broker, search, OpenPencil or Mission Control extensions. Those require their individual runtime contracts and validation.

For the first real installation owner, use the trusted interactive flow in `onboarding/README.md` after dependency installation. Stop the default services first. That flow creates separate private state and an explicit administrator binding; always start that installation through its own helper. Then open `http://127.0.0.1:8080/setup`. Native startup derives SQLite from `DATA_DIR` and ignores an unrelated inherited host `DATABASE_URL`; use `STARLI_DASHBOARD_DATABASE_URL` only for a deliberate dashboard database alternative. Windows backend processes use UTF-8 encoding. Check HTTP readiness with `node installer/native.mjs health all`.

## Docker application deployment

Requires Node 18+ for the portable launcher, Docker with a running Linux-container engine, and Compose v2 supporting `up --wait`. Windows/macOS can use Docker Desktop; Linux can use Docker Engine and its Compose plugin. Application images isolate the conflicting Node requirements.

```text
node installer/starli.mjs doctor
node installer/starli.mjs init
node installer/starli.mjs config
node installer/starli.mjs install
node installer/starli.mjs start
node installer/starli.mjs status
node installer/starli.mjs logs
node installer/starli.mjs stop
```

PowerShell wrapper: `./installer/starli.ps1 install`. POSIX wrapper: `sh installer/starli.sh install`. All launcher commands accept `--dry-run` (`-DryRun` with PowerShell). Paths resolve relative to the launcher, regardless of the caller's working directory. `init` creates a fresh random dashboard session secret in ignored `installer/local.env`; existing configuration is preserved. On Windows, this file inherits the directory ACL. Keep it private. `config` validates without printing interpolated secrets.

`install` builds images and fails on a missing source/lockfile or failed upstream build. `start` starts the two core app services and waits up to 300 seconds for their health checks. Health checks establish HTTP readiness only. Ports bind to loopback by default. Internal API URLs use Compose service names; browser/public origins use host loopback URLs. The dashboard shares fresh platform database state with write access because its existing identity bridge provisions service identities there. Change the two port variables in `installer/local.env` and corresponding origin settings together. `stop` removes containers and networks while retaining data volumes. No launcher command deletes volumes, production services or user files.

Optional services are defined under Compose profile `extended`: the extracted MCP control plane and dashboard task worker. Their presence is not an integration success claim. Review config and authentication before explicitly running:

```text
docker compose --env-file installer/local.env -f installer/compose.yaml --profile extended up -d
```

The dashboard Dockerfile builds its Svelte frontend with Node22, installs the restored provider runtime with Node24 and copies that runtime into Python3.11. It uses the reviewed Linux x64 Python hash lock; Linux ARM64 Docker builds fail explicitly until a reviewed matching lock is supplied. Native macOS ARM64 is a separate supported lock target. Both Docker builds exclude environment files, databases, dependencies, caches, private keys and generated builds. Review provenance and release security gates before distributing images. Never place secrets in build arguments.

## Current validation limits

See `docs/agentx5-status.md` for observed results. The current Windows platform install/build and HTTP health pass. Dashboard Python dependency installation passes, but Windows private-storage ACL handling and runtime dependency compatibility exposed further startup gates; consult current status before expecting dashboard readiness. The Svelte frontend has a separate build gate. Each native host and Docker image must be validated independently; a Compose syntax check cannot establish a working Docker engine.
