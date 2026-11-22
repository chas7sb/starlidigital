# Source inventory and extraction recommendations

**UI scope corrected:** this initial inventory does not identify the requested new ULTRA BO$$ product. See docs/new-product-source.md for the active joined Starli/Boss/bots/teams candidate. Old Open WebUI UI is not an authorized release target.

Observed 2026-11-22 using bounded, read-only StarliDigital server_exec. No production files, services, environment values, customer databases, or ledger were changed. Shared docs/prime-ledger.md and docs/agentx9-status.md were read.

## Confirmed source origins

| Component | Resolved production origin | Evidence |
|---|---|---|
| Platform API/React | /srv/starlidigital/releases/native-customer-oauth-dev-v34-20261118 | current symlink; effective API systemd WorkingDirectory=/srv/starlidigital/current |
| Svelte/Python dashboard | /srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119 | webui-current symlink; effective webui and task-worker WorkingDirectory point to backend |
| **Active MCP control plane** | **/srv/starlidigital/releases/20261109-luna-openwebui-writes/control-plane** | **effective starlidigital-control.service WorkingDirectory; Node --import tsx src/index.ts** |

Critical: current/control-plane is NOT the active MCP tree. It has 32 source files; active MCP has 40. Active-only: browser-bridge.ts, mission-control-mcp.ts, tools/browser-bridge.ts, tools/one-time-agents.test.ts, tools/one-time-agents.ts, tools/pi-xai-agent.ts, tools/starli-inference.ts, tools/worker-mcp-bridge.ts. Shared files changed: server.ts, tools/index.ts, tools/security.ts. Preserve active MCP as authoritative runtime input; reconcile rather than silently overwrite. SHA256 evidence is in work/agentx1/source-map.json.

No AGENTS.md was found in checked source roots/ancestors or recursive deployed source searches excluding node_modules. Local shared project ancestors were also checked; none found. The broad Documents scan was slow; explicit applicable ancestor checks were used.

## Scope map

Platform source: server/src (110 files), control-plane/src (32), web/src (73), web/public (11), CLI, device agent including Android SMS, video-engine/engine (19), and scripts. API modules include hosted agents/integrations, CRM, mailbox, visitors, assets, OAuth, video. React includes wallet/payments, commerce/domains, projects/build/editor, recovery, diagnostics, admin, CRM, mailbox, hosted agents, video and memory.

Primary dashboard: src/routes (39 files), src/lib (443), static assets, backend/open_webui (308), backend/wave_panels (28), backend/starli_company_computer (38), company_messaging (17), enterprise_browser (8), plus memory, automations, scheduling/wake/triggers, connector execution, engine connections, integration catalog, company tools/social/n8n, workflow tools, priority gateway, and search-gateway/gateway (4). Counts exclude dependencies, caches, data, build trees, and models; they are inventory counts, not parity assertions.

Routes include chat, home, workspace tools/prompts/models/knowledge, Starli sections, admin users/settings/functions/evaluations, playground/completions/notes, channels, shared chat and authentication. Keep authenticated home/dashboard routes. Platform HomePage.tsx/homepage.css are marketing candidates requiring route tracing in mixed main.tsx before removal. Retain product proposal/share functionality where needed for existing features.

## Dependencies and build implications

- Platform root requires Node >=24.0.0, npm workspaces, TypeScript/tsx. React 19/Vite 6. Root package-lock v3 has 441 package entries; SHA256 68176af57c33f86aeb94adc5eb2d53efdcb6b79e003d590efafd0bd54501b162.
- **server/package.json and control-plane/package.json are absent from current**, despite workspace declarations. Their direct dependency entries survive in root lockfile, captured in source-map.json. Server requires dotenv, graphql, graphql-ws, graphql-yoga, imapflow, svix, ws. Reconstructing scripts/tsconfig requires source-origin recovery or independent validation.
- Active MCP includes package.json, tsconfig.json, test/, and standalone lockfile; dependencies MCP SDK ^1.32.2, jose ^6.2.14, zod ^3.25.76; dev tsx ^4.20.6, TypeScript ^5.9.3 and Node types ^24.10.0. Build is tsc --noEmit; start tsx src/index.ts. Lock SHA256 84f96959c872b2828866efb5e2b57922a537fcb8a64161e4ac9d4b76c2d06d03.
- WebUI package declares Node >=18.13.0 <=22.x.x, Svelte 4, SvelteKit 2, Vite 5. Use a separate Node 22 build environment from platform Node 24. adapter-static outputs build/ with index.html fallback. npm build first runs prepare-pyodide.js.
- WebUI lock v3 has 1054 package entries; SHA256 b6ee060eee0ccd0921d35c1024efc3650d623e867e3e4c347ac85b557c132504. Complete declared frontend dependency/devDependency entries are in source-map.json.
- Python project requires >=3.11,<3.13. FastAPI/Uvicorn, SQLAlchemy/Alembic/Peewee, Chroma/vector/search clients, AI SDKs, retrieval/document/media libraries, Playwright, whisper, cloud storage/identity, LDAP and telemetry. Full captured manifests: work/agentx1/python.txt and python-project.txt. They differ: azure-identity 1.21.0 in requirements vs 1.20.0 in pyproject; requirements adds OpenTelemetry, pyproject adds storage test emulators. Several dependencies are unpinned. No Python lockfile appeared at root/depth2; reproducible clean resolution remains a release gate.
- Video engine separately pins Pillow 12.3.0, numpy 2.4.4, opencv-python-headless 4.13.0.92, edge-tts 7.3.1. These conflict with WebUI Pillow/OpenCV pins; isolate its Python environment.
- workspace_entry.py imports wave_panels/workspace_app.py; launching only open_webui.main loses the actual deployed wrapper. Python custom modules spawn Node mail/computer workers. Preserve cross-language worker paths and dependencies.
- enterprise_browser/native.py defaults Chromium to /opt/starlidigital/webui-chromium/chrome-linux/chrome. Replace with configured portable browser location inside the isolated VM; browser binaries and OS libraries are additional runtime inputs, not supplied by source alone.
- scripts/starli-runtime has 22 files and local TTS scripts/service templates. Optional voice/model assets and provider integrations require explicit portable configuration. Installed production Python/npm environments were not treated as clean dependency locks.

## Provenance and release blockers

WebUI package identifies open-webui 0.6.5; local pyproject names Open WebUI and Timothy Jaeryang Baek. Deployed LICENSE contains BSD-style three-clause conditions, while pyproject classifiers say MIT. Preserve exact deployed notices and resolve this discrepancy before release. No Git metadata/upstream commit was verified, so an upstream tag cannot be asserted from the version alone.

.workspace-release.json names base codex-tool-fix-WyZbrP and plan hash. RUNTIME-RELEASE-PROVENANCE.json identifies an older r12b release and /opt/starlidigital/search-gateway/releases/research-v2-r1, although current points to v33. It is historical evidence, not proof of current binary/source correspondence. Gateway external install and all runtime /opt references need reconciliation.

Complete transitive/runtime dependency closure is **not proven**: custom Node workers have nested installed node_modules without a wave_panels/package.json, platform manifests are incomplete, Python is not locked, browser/voice/VM assets and external runtime paths remain to audit. No install or parity tests were run in this inventory task.

## Recommended extraction sequence

1. Copy sanitized source from all three confirmed origins into distinct staging trees with relative path/SHA256 manifests; include lockfiles, build configuration, tests, assets and notices.
2. Exclude customer data, uploads, database files, credentials, .env files, .webui_secret_key, node_modules, caches and compiled baseline duplicates. Review static assets and fixtures for data rather than assuming every asset is publishable.
3. Recover platform missing manifests; preserve active MCP patches; trace wrapper imports and worker launches before consolidating folders.
4. Keep full dashboard and feature routes; remove marketing entry routes/assets after import tracing. Avoid broad deletion of mixed UI modules.
5. Pin Python dependency resolutions per isolated environment, retain npm locks, externalize Linux production paths, and give each OS a launcher. Provide fresh local state and explicit optional provider setup.
6. Run API/dashboard/worker tests and feature parity against an isolated test instance, then validate isolated VM lifecycle and Windows/macOS/Linux fresh installs. Do not point extraction tests at production.

Ownership: only this document and work/agentx1 files were written. Source-map JSON is intentionally under work/agentx1 per assigned ownership; Prime may relocate it to a root deliverable during integration.

## Additional live roots confirmed after integration cross-check

Read-only systemctl Id/WorkingDirectory/ExecStart checks confirm these additional source origins beyond the initial two roots. No Environment properties were requested.

| Feature | Source origin / entrypoint |
|---|---|
| Company computer broker | /srv/starlidigital/mcp-workspace/agata-computer-production-20261114/broker/production-broker.mjs |
| OpenPencil | /srv/starlidigital/mcp-workspace/openpencil/runtime/start-mcp.mjs and runtime/server.mjs |
| Mission Control preview | /opt/starlidigital/mission-control-preview/current -> /opt/starlidigital/mission-control-preview/releases/conversation-titles-d5488e53084068d21b6e2a099794ffe45cafac48; server/src/mission-control/preview-entrypoint.ts |
| Search (SearXNG) | /opt/starlidigital/search/releases/de722ab1b-20261113-r1; venv Python launches gunicorn with gunicorn.conf.py and wsgi:application |
| Network child broker | /opt/starlidigital/network-child/releases/v1/broker.py, system Python isolated mode -I |

Additional manifests, resolved paths, top-level inventory and available lock/license hashes are in source-map.json additionalRuntimeRoots. OpenPencil has runtime/package.json plus lock and root LICENSE. Mission Control contains server/package.json and control-plane/package.json: these are useful recovery candidates for missing platform manifests, but must be validated against actual platform source before reuse. SearXNG source/requirements.txt is pinned; gunicorn is a runtime requirement from ExecStart beyond that requirements list. Search source LICENSE must be retained and reviewed.

Do not extract OpenPencil documents/, broker working state, venv/node_modules, activation snapshots, or production profiles as portable defaults. The network-child tree includes Linux-specific network.nft and kernel/boundary probes: cross-platform VM adaptation remains necessary. AgentX3 owns actual additional Node/runtime extraction; this inventory does not claim those sources are locally copied or that their full external dependency closure is complete.
