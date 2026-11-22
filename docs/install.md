# Local installation

These entry points deploy the extracted application. A computer-use VM has its own lifecycle under `runtime/`; Docker application containers do not supply a desktop VM. Full integration readiness, external providers and feature parity must be checked separately.

## Native Windows, macOS and Linux

Install Node 24 or later with npm and `uv`. The launcher uses Node 24 for `platform/`, Node 22 for the dashboard frontend and an isolated Python 3.11 virtual environment for its backend. Python 3.14 is unsupported by the dashboard manifest. Run commands from the repository root:

```text
node installer/native.mjs bootstrap-node22
node installer/native.mjs doctor all
node installer/native.mjs install all
node installer/native.mjs build all
node installer/native.mjs start all
```

`bootstrap-node22` obtains the latest official Node 22 LTS distribution from nodejs.org, checks its SHA256 against that release's official checksum file, then extracts it under `installer/.runtime/node22`. This verifies download integrity over HTTPS; it is not signature verification. It preserves an existing runtime directory. Set `STARLI_NODE22` and `STARLI_NODE24` to executable paths to use preinstalled distributions instead. Node/npm must be installed together.

Use `platform` or `dashboard` instead of `all` to install, build, diagnose or start one component. `install dashboard` uses `uv venv --python 3.11` and installs the extracted backend requirements. Downloads and native dependency builds can take time; the upstream Python requirements include machine learning packages and some unpinned dependencies. A successful install does not establish reproducibility or feature availability.

Native startup stays in the foreground. Ctrl+C terminates its owned child process trees. It reports that processes were launched, not that they are ready. Platform defaults to `http://127.0.0.1:4100/health`; dashboard defaults to `http://127.0.0.1:8080/health`. The dashboard preserves the production `workspace_entry:app` adapter and stores its fresh local data under `installer/.runtime/dashboard-data`. Platform stores fresh data under its source-relative `server/data` unless `DATABASE_PATH` is set. No production data is provided.

Read `config/*.env.example` and `config/` documentation before integrating services. Copy only reviewed local settings into the appropriate component environment file or process environment. The native launcher does not import every config file automatically. It generates/preserves the session secret in ignored `installer/local.env`, enables authentication, disables signup and remote model APIs, enables offline mode, and isolates mutable dashboard state. Explicit process environment overrides these defaults. A fresh authenticated account still requires a reviewed local provisioning flow; the launcher does not insert an administrator into a database. Set provider credentials privately; do not reuse production databases or session secrets. Local start covers the API and dashboard, not the MCP control plane, task worker, broker, search, OpenPencil or Mission Control extensions. Those require their individual runtime contracts and validation.

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

`install` builds images and fails on a missing source/lockfile or failed upstream build. `start` starts the two core app services and waits up to 300 seconds for their health checks. Health checks establish HTTP readiness only. Ports bind to loopback by default. Change the two port variables in `installer/local.env` and the corresponding app origin settings together. `stop` removes application containers and networks while retaining named data volumes. No launcher command deletes volumes, production services or user files.

Optional services are defined under Compose profile `extended`: the extracted MCP control plane and dashboard task worker. Their presence is not an integration success claim. Review config and authentication before explicitly running:

```text
docker compose --env-file installer/local.env -f installer/compose.yaml --profile extended up -d
```

The dashboard and platform Docker builds exclude environment files, databases, dependencies, caches, private key files and generated builds from their contexts. Review extraction provenance and the release security gates before distributing images. Never place secrets in Docker build arguments.

## Current validation limits

See `docs/agentx5-status.md` for observed install/build results. Source has been arriving concurrently from extraction owners; original manifests and lockfiles must remain consistent. Missing marketing modules referenced by a legacy platform frontend can block the root platform build even though the Svelte dashboard is a separate app. The Docker engine and each native host platform must be validated independently; a Compose syntax check cannot establish a working Docker engine.
