# Architecture and extraction boundaries

Evidence inspected on 2026-11-22 through read-only StarliDigital source tools and bounded server reads. These observations describe upstream source; they do not certify the assembled local extraction.

## Source roots

| Root | Resolved upstream release | Role |
| --- | --- | --- |
| `/srv/starlidigital/current` | `/srv/starlidigital/releases/native-customer-oauth-dev-v34-20261118` | Node platform workspaces and video engine |
| `/srv/starlidigital/webui-current` | `/srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119` | Existing Svelte dashboard, Python API, search gateway |

The MCP default workspace is `/srv/starlidigital/mcp-workspace`. Files there are not automatically the current deployment. The default root manifest and a nested `server/src/ai-agency-v1/server/src/index.ts` were inspected for discovery; key runtime facts were then checked against `/srv/starlidigital/current` directly. Extraction should pin resolved release paths rather than assume every tool-relative path identifies live source.

## Runtime components

- **Node platform:** root workspaces are `server`, `web`, `cli`, `device`, and `control-plane`. Node engine is >=24. The server uses TypeScript/tsx, GraphQL Yoga, graphql-ws, ws, dotenv, IMAP support, and webhook dependencies.
- **Existing dashboard:** separate package named `open-webui`, version 0.6.5, with Svelte 4, SvelteKit 2, and Vite 5 tooling. Its manifest declares Node >=18.13 through 22.x. Routes include native Starli panels alongside chat/workspace/admin surfaces.
- **Dashboard API:** separate Python `open-webui` project requiring Python >=3.11 and <3.13, with FastAPI, Uvicorn, Socket.IO, SQLAlchemy/Alembic, provider clients, retrieval/document processing, and other integrations. Dependencies indicate available code paths, not configured or tested features.
- **Other upstream directories:** `video-engine`, `search-gateway`, CLI, device, and control-plane need explicit source/configuration/runtime treatment by their owners. Their presence alone does not prove a portable service.

## Observed request and state boundaries

The Node server exposes `/graphql` over HTTP and subscriptions over WebSocket. It also handles OAuth metadata/authorize/token paths, Stripe and Resend webhook paths, authorized asset/video media, and a device WebSocket upgrade path. Its health endpoint is `/health`. Default binding is `127.0.0.1:4100`; `HOST` and `PORT` override it. `ALLOWED_ORIGINS` defaults to local port 5173 origins, and `PUBLIC_APP_URL` adds an origin. Proxy trust is conditional in the inspected entry point.

The Node store persists JSON records in SQLite and has dedicated users/sessions/resets tables. `DATABASE_PATH` selects its database. It enables WAL and foreign keys. Startup recovers interrupted work rather than reporting it complete and starts scheduler, fulfillment, email, mailbox, domain-commerce, and video workers. A local launcher must account for these background behaviors when optional services are unconfigured.

The existing Company panel calls `/api/v1/starli/overview` and `/api/v1/starli/native-capabilities`. This establishes a dashboard API boundary distinct from directly calling Node GraphQL. The precise proxy and identity mapping must be extracted and verified; it should not be replaced with an invented single-service architecture.

Node's `static.ts` serves `web/dist` when present and `SERVE_WEB` is not `false`. That is not proof that it serves the separate Svelte dashboard. Root `npm run build` also does not build that separate dashboard. Release integration must explicitly choose and wire the existing dashboard.

## Feature routing evidence

`src/routes/(app)/starli/[section]/+page.svelte` dispatches social, mailbox, company, billing, approvals, tools, CRM, admin, and browser to dedicated components. Projects, proposals, hosted agents, videos, and activity use a collections component. The agents section redirects to chat. Unknown sections fall back to a resource panel; a fallback panel is not evidence of complete functionality.

The dashboard route inventory also includes home, workspace tools/prompts/functions/models/knowledge, conversations, channels, administration/users/settings/evaluations/functions, playground/completions/notes, authentication, and shared conversation/watch/error routes. Route existence is a feature inventory aid, not an acceptance test.

## Portability and isolation constraints

1. Backend and dashboard Node engine declarations conflict. Separate build environments or a tested tooling update are required.
2. Python API dependencies and data need independent packaging. A static frontend plus Node API cannot be assumed to cover all chat/workspace capabilities.
3. Upstream system paths, domains, provider endpoints, worker executables, reverse-proxy assumptions, and generated file paths need portable configuration.
4. A computer-use surface must be backed by an isolated VM with verified lifecycle and input/display transport. The inspected UI does not establish that release requirement.
5. Source-only extraction must omit live databases, logs, customer uploads, credentials, caches, dependency directories, and built artifacts unless explicitly sanitized and required.
6. Preserve upstream attribution and review actual license files before public distribution. Package metadata alone is insufficient license clearance.

## Acceptance evidence still required

Fresh install on Windows/macOS/Linux; dashboard authentication and authorization; state persistence across restart; subscriptions/events; upload and download access; optional-provider failure states; background worker behavior; backup/restore; VM isolation/lifecycle; and route-by-route parity against the existing dashboard. No result for these checks is claimed here.

## Inspected files

- `current/package.json`
- `current/server/src/index.ts`
- `current/server/src/store.ts`
- `current/server/src/static.ts`
- `webui-current/package.json`
- `webui-current/pyproject.toml`
- `webui-current/src/routes` page inventory
- `webui-current/src/routes/(app)/starli/[section]/+page.svelte`
- `webui-current/src/lib/components/starli-preview/StarliResourcePanel.svelte`
- `webui-current/src/lib/components/starli-preview/StarliCompanyPanel.svelte`
