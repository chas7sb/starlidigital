# Integration findings

Observed read-only on 2026-11-22. These are source/runtime observations, not a claim that the extracted project runs.

## Transfer

Windows has native OpenSSH (`ssh`, `scp`, `sftp`), `tar.exe`, and `curl.exe`. The existing SSH alias `api.starlidigital.ro` connects as ubuntu with batch mode and strict host verification. Both SSH and MCP report hostname `vps-3c6afbfe`; release symlinks match. No key material needs to be printed or exported. Build explicit allowlisted source archives in private scratch, transfer by SCP, verify checksums, reject absolute/traversal/symlink archive entries before extraction. Do not copy whole release directories, environment files, data, customer projects, caches, or dependencies.

## Actual production topology

| Component | Effective source / command | Observed listener |
|---|---|---|
| Platform API and workers | `/srv/starlidigital/current`; Node `--import tsx server/src/index.ts` | 4119 (control-plane upstream health configuration) |
| MCP control plane | `/srv/starlidigital/releases/20261109-luna-openwebui-writes/control-plane`; Node `--import tsx src/index.ts` | 127.0.0.1:4120 |
| Dashboard backend/static app | `/srv/starlidigital/webui-current/backend`; Python `-m uvicorn workspace_entry:app` | 127.0.0.1:8190 |
| Starli external task worker | dashboard backend; Python `-m open_webui.starli_task_worker` | worker; no listener observed |
| Company computer broker | `/srv/starlidigital/mcp-workspace/agata-computer-production-20261114/broker/production-broker.mjs` | not inspected |
| Mission Control preview | `/opt/starlidigital/mission-control-preview/current`; `server/src/mission-control/preview-entrypoint.ts` | not inspected |
| Search | `/opt/starlidigital/search/releases/de722ab1b-20261113-r1`; gunicorn | not inspected |
| OpenPencil web | `/srv/starlidigital/mcp-workspace/openpencil/runtime/server.mjs` | not inspected |
| OpenPencil MCP | `/srv/starlidigital/mcp-workspace/openpencil/runtime/start-mcp.mjs` | not inspected |

`systemctl show ... -p WorkingDirectory -p ExecStart` confirms the effective MCP working directory differs from `current/control-plane`. Extracting only current platform and dashboard cannot establish full feature parity: broker, OpenPencil, Mission Control and search source/runtime dependencies must also be considered. Stateful company working directories must not be copied.

## Build/runtime compatibility

- Platform root is `starlidigital-platform` 0.1.0, private, with server/web/cli/device/control-plane workspaces and Node >=24.
- Dashboard is `open-webui` 0.6.5, private, Svelte 4 / Vite 5. Its declared engine is Node >=18.13.0 <=22.x.x. Use a separate Node 22 dashboard build stage and Node 24 platform runtime until validated changes justify altering these manifests.
- Dashboard `dev` runs Pyodide preparation then Vite; `build` also runs Pyodide preparation. Dependencies and Python backend requirements must be installed independently from platform npm workspaces.
- Production dashboard launches `workspace_entry:app`, not the unmodified upstream `open_webui.main:app`; preserve the entrypoint and its patches/adapters.
- API and control plane execute TypeScript through `tsx`; current build scripts typecheck rather than emit compiled JavaScript. Packaging must preserve runtime dependency availability or introduce and validate a real emit/bundle step.

## Suggested portable service contract

Keep dashboard backend, platform API, MCP control plane and external task worker as distinct services with configurable localhost endpoints. Serve dashboard built assets through its Python app as production does. Put a single optional reverse proxy in front for a stable local origin; preserve WebSocket and streaming behavior. Treat computer VM, search, OpenPencil and Mission Control as explicit capability services, not silently absent features. A Compose application stack is not itself a computer-use VM.

## Upstream notices

The dashboard's existing LICENSE identifies Timothy Jaeryang Baek, copyright 2023–2025, and contains a three-clause BSD-style redistribution notice. Preserve its exact text and attribution. This observed file does not prove all bundled StarliDigital modules/assets/dependencies share its license or settle distribution rights; inventory them separately. No new project-wide license has been chosen here.

No production service, environment value, database, or working directory was changed during this inspection.
