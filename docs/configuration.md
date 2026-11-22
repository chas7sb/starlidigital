# Configuration and bring-your-own integrations

Configuration review date: 2026-11-22. Scope: production source names inspected through read-only StarliDigital code tools. No production environment file or configured values was read. Files under config/ contain invented local defaults and empty secrets.

## Loading and portable paths

Templates are split by responsibility. Merge relevant templates into the process environment using the installer/runtime adapter. Current platform server/src/index.ts:42 loads platform-root .env then server/.env; control-plane/src/index.ts:18-24 loads platform-root .env then control-plane/.env. Neither entrypoint automatically reads config/*.env.example. Keep actual .env files private.

Run platform and control plane with the same working directory and explicit DATABASE_PATH; relative paths are resolved by source against the working directory. Create writable data/ and workspace/ directories before launch. Use forward slashes on Windows or absolute paths appropriate to each host. ASSET_STORAGE_DIR, VIDEO_STORAGE_DIR and STARLI_WORKSPACE_ROOT must point to persistent writable directories. SQLite is the observed database; a PostgreSQL or S3 configuration switch is not established by this inspection. Back up SQLite and the filesystem assets/video together. Keep EMAIL_OUTBOX_KEY stable for existing encrypted messages.

ADMIN_USERNAME and ADMIN_PASSWORD bootstrap an admin only when both are supplied (server/src/index.ts:45-50); password must have at least 14 characters. Generate your own strong password. Do not include one in a distributable template.

## Integration matrix

| Capability | Source configuration names | BYO support and limitations |
| --- | --- | --- |
| AI chat/build | STARLI_AI_PROVIDER, OPENAI_API_KEY, OPENAI_MODEL, OPENAI_CHAT_MODEL, OPENAI_BUILD_MODEL | OPENAI and OUTLIER provider selection is observed in server/src/ai.ts:9-23. OpenAI requests use a fixed API URL; arbitrary compatible base URL is not verified. Empty credentials leave AI unavailable. |
| Other AI tasks | OPENAI_BLOG_MODEL, OPENAI_OPERATOR_MODEL, OPENAI_RESEARCH_MODEL, OPENAI_IMAGE_MODEL, OPENROUTER_API_KEY, HOSTED_AGENTS_DAILY_MODEL_BUDGET | Names observed in ai.ts, operator-model.ts via bounded search, research.ts via bounded search, images.ts via bounded search, and hosted-agents/service.ts. Confirm chosen models with account access. |
| Private inference tool | STARLI_INFERENCE_BASE_URL, STARLI_INFERENCE_API_KEY | control-plane/src/tools/starli-inference.ts; this tool configuration does not establish a universal provider replacement. |
| Outlier | STARLI_* names in config/outlier.env.example | Source-specific authenticated adapter. outlier-client.ts:6 defines its runtime allowlist; :193 enforces the official origin. Bring your own authorized credentials; no production session is included. |
| Proposal email | SMTP_ENABLED, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_REPLY_TO, EMAIL_PROPOSAL_PROVIDER, EMAIL_OUTBOX_KEY | SMTP transport configurable in server/src/smtp.ts:42-49; proposal provider selection in email.ts:75-77. Disabled by default. SMTP is not currently a universal transactional transport. |
| Transactional email | RESEND_API_KEY, RESEND_WEBHOOK_SECRET, EMAIL_FROM, EMAIL_OUTBOX_KEY, PUBLIC_APP_URL | server/src/email.ts uses Resend for non-proposal mail and requires original sender domain; source change required for portable BYO sender. |
| Mailbox | IMAP_HOST, IMAP_PORT, IMAP_SECURE, IMAP_USER, IMAP_PASS | server/src/mailbox/service.ts:69-73; override original-account default. Empty password prevents a useful authenticated connection, but is not a verified worker-disable switch. |
| Database/files | DATABASE_PATH, ASSET_STORAGE_DIR, VIDEO_STORAGE_DIR, PYTHON_BIN | Local SQLite and filesystem storage observed in store.ts, assets/service.ts, video/service.ts. No verified S3 adapter. |
| Web deployment/domain | VERCEL_TOKEN, VERCEL_TEAM_ID, DOMAIN_PURCHASE_ENABLED | Actual consumed names in integrations/vercel.ts and domains.ts. Remote account required; leave blank/disabled for local extraction. |
| Billing | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_LIVE_ENABLED, STRIPE_SITE_PRICE_CENTS, STRIPE_CURRENCY | billing.ts; leave live mode disabled until separately configured and tested. |
| Analytics | PLAUSIBLE_BASE_URL, PLAUSIBLE_API_KEY | control-plane/src/analytics.ts bounded search. |

## Hardcoded production dependencies requiring owner follow-up

| Source path and line | Observed dependency | Needed portable behavior |
| --- | --- | --- |
| control-plane/src/index.ts:35-37,70 | Production OAuth issuer/resource defaults; issuer equality selects native token verifier | Explicit portable native-auth mode or configured BYO issuer. Empty environment strings trigger fallback and do not select fixture mode. |
| control-plane/src/index.ts:61-62,105 | Production Linux SQLite/workspace defaults | Set DATABASE_PATH and STARLI_WORKSPACE_ROOT; eliminate production fallback in portable runtime. |
| control-plane/src/tools/config.ts:95 | secret_manage persists to a fixed Linux production environment path | Replace with private runtime config location in extracted source before enabling secret writes. Do not call this tool against production. |
| server/src/assets/service.ts:105-108 | Public asset URL defaults to original API domain | Set PUBLIC_API_URL to local API origin. |
| server/src/index.ts:46,50 | Admin identifiers get original email-domain suffix | Source owner must decide portable account identity policy. |
| server/src/email.ts:110,126-130 | Default original sender plus enforced original sender for non-proposal mail | Configurable validated transactional sender; environment change alone is insufficient. |
| server/src/email.ts:185 | SMTP message IDs use original outreach domain | Derive from configured owned domain. |
| server/src/email.ts:268 | Fixed Resend API endpoint | BYO Resend account supported; alternate transactional provider requires adapter work. |
| server/src/mailbox/service.ts:72 | Original mailbox username default | Explicit IMAP_USER supplied in template. |
| server/src/outlier-client.ts:178,193,223-224 | Fixed official Outlier endpoint/origin constraints | Keep source-specific provider behavior; do not describe as generic API adapter. |
| server/src/video/service.ts:50 | Host-specific Windows Python and Linux video-venv fallbacks | Set PYTHON_BIN to installed interpreter/container interpreter. |
| server/src/ai.ts:182 | Fixed OpenAI responses endpoint | Add explicit adapter/base URL support if arbitrary AI providers are required. |

## Inventory coverage and discrepancies

config/source-inventory.json records names and source evidence only, with no values. It includes targeted primary files and a separate catalog-only group from control-plane/src/tools/config.ts:24-32. That catalog lists VERCEL_API_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID and OUTLIER_COOKIE/OUTLIER_CSRF_TOKEN, whereas inspected runtime source consumes VERCEL_TOKEN/VERCEL_TEAM_ID and STARLI_COOKIE/STARLI_CSRF_TOKEN. Do not assume catalog names work as aliases.

Search results cap at 50 and nested historical/staging trees consume that cap; broad searches also encountered EACCES. This is an evidenced partial inventory, not a claim of exhaustive production configuration. The MCP workspace path webui-current/backend/open_webui was unavailable (ENOENT). A subsequent bounded read-only Python scan of the actual /srv/starlidigital/webui-current/backend source succeeded through server_exec; dashboard names and production references are recorded in the JSON inventories. Computer-use VM wiring still requires its source owner. Do not invent dashboard/VM environment names or copy live settings. Initial configuration inventory did not edit implementation. A subsequently authorized dashboard/backend portability patch is described below.

## Validation status

Templates were checked for dotenv syntax, duplicate keys per file, forbidden live domain defaults and nonempty secret assignments. No runtime install, remote send, provider call, service change, or production mutation was performed. The backend scan only read .py source and emitted configuration names plus domain/path literals; it did not read any live configuration files. Installer environment wiring and complete startup testing are still required to establish deployed behavior.

## Actual dashboard backend configuration

The dashboard has independent Python configuration in backend/open_webui/env.py and config.py. config/dashboard.env.example and dashboard-storage.env.example target that process, not the Node platform. Its OpenAI-compatible adapter exposes OPENAI_API_BASE_URL / OPENAI_API_BASE_URLS and OPENAI_API_KEY / OPENAI_API_KEYS; Ollama exposes OLLAMA_BASE_URL / OLLAMA_BASE_URLS. STORAGE_PROVIDER has S3, GCS and Azure configuration names in config.py; their runtime operation has not been tested here. The full names-only inventory covers backend Python source, including historical snapshots/tests, with paths to distinguish active files. Regex matching may miss dynamic names (for example STARLI_DRIVE_ prefixes), aliases and non-Python launch configuration.

ENABLE_PERSISTENT_CONFIG=false makes the template suitable for explicit environment-driven setup; review existing database-backed configuration precedence before migrating an existing dashboard. Keep WEBUI_AUTH enabled and provide a private WEBUI_SECRET_KEY before startup. Empty secret placeholders are not a ready-to-run authentication setup.

Dashboard-native company email lives in the engine-connection APIs and can use stored per-company credentials rather than platform SMTP environment variables. Do not assume Node SMTP_* settings configure dashboard company mail. No company credential database was read.

Production references are enumerated by path and line in config/dashboard-dependencies.json. These require source-owner review, especially:
- routers/starli_guest_provider.py:11 and starli_runtime_adapter.py:419 read the fixed production environment path.
- starli_account_mcp/account_mcp/firstparty_mcp.py:20 and oauth_connect.py:20 default to the original API/MCP origin; OAuth redirect allowlists include original domains.
- starli_company_computer/company_compute.py:133, starli_company_n8n/production.py:16, starli_automations/production.py:20, starli_company_social/production.py:23 and starli_engine_connections/production.py:11 read fixed production JSON configuration paths.
- starli_company_computer/app_previews.py:20 and company_compute.py:103,170 use the original public preview prefix.
- starli_state.py:16, starli_v3_native.py:93,106, and starli_registrations.py:46 default to production databases; use explicit portable paths and review unconfigurable branches.
- priority gateway production policy paths and agent wake broker key paths require a local VM/runtime config contract.

Merely copying templates does not remove these dependencies. The dependency JSON records the original source baseline. Dashboard/backend references covered by the subsequent patch now use portable configuration; platform and external runtime implementation remain with their owners.

## Implemented dashboard portability patch

backend/starli_portable.py centralizes server-owned paths and origins. The change manifest is config/portability-changes.json. Active backend production installation paths now resolve from the extracted tree, with operator overrides:

| Setting | Default / purpose |
| --- | --- |
| STARLI_CONFIG_DIR | repository config/private; optional JSON/key/runtime environment files remain private and absent until configured |
| STARLI_DATA_DIR or DATA_DIR | dashboard/backend/data; durable dashboard state |
| STARLI_PLATFORM_SOURCE_ROOT | repository platform; shared Node source database defaults to platform/server/data/starli.sqlite |
| STARLI_RUNTIME_BUNDLE_DIR | repository runtime/vendor; separately supplied reviewed brokers/gateways |
| STARLI_WORKSPACE_ROOT | repository workspace; engineering workspace |
| STARLI_NODE_BINARY | Node discovered through server PATH |
| STARLI_BROWSER_EXECUTABLE_PATH | Chromium/Chrome discovered through server PATH; missing browser returns unavailable |
| STARLI_PUBLIC_ORIGIN or WEBUI_URL | http://localhost:8080; dashboard callbacks, preview URLs, request origins |
| STARLI_PLATFORM_ORIGIN | http://127.0.0.1:4100; native customer/OAuth/GraphQL service |
| STARLI_COMPANY_PLATFORM_ORIGIN | defaults to configured platform origin; enrolled computer producer/publisher service |
| STARLI_CONTROL_PLANE_ORIGIN | http://127.0.0.1:4120; first-party public MCP registration URL |
| STARLI_ALLOWED_ORIGINS | explicit comma-separated origin allowlist, otherwise public origin only |

Public/callback origins reject credentials, control characters, URL paths/query/fragment, and external cleartext HTTP. HTTPS and loopback HTTP are supported. Internal service_origin validation separately accepts explicit operator HTTP(S) DNS/private endpoints, including Compose service names, while rejecting credentials, paths, query/fragment and malformed host/port values. OAuth host maps include configured ports and reject hosts outside that explicit allowlist. Authentication, cookie security attributes, no-follow private storage checks, broker code hashes and POSIX ownership requirements were preserved. The account MCP transport uses the operator-configured internal control-plane origin; its public registration URL is validated separately. Arbitrary request-supplied destinations remain excluded.

Original service-domain fallbacks were removed from active callback/public URL builders and origin checks. Social consent cookie domain validation is pinned to the configured platform issuer hostname. Company GraphQL producer URLs must match the configured platform origin and the exact supported GraphQL path. Guest OpenRouter uses an operator environment key or private local config, never the production host file. Missing optional config/broker files keep the integration unavailable under existing readiness handling; these changes do not fabricate credentials or success.

Historical automation snapshots, test/sample references, and the QA-only stage guard were intentionally not rewritten. The old production IPv4 appears in SSRF protection deny rules; it is a deny target, not a service fallback, and was preserved to avoid weakening network protections. Broker ownership checks are POSIX-specific and remain a runtime/VM deployment constraint. These edits do not make those brokers execute natively on Windows.

Validation: eight isolated tests cover extracted-tree defaults, operator path overrides, custom origins/host allowlists, invalid-origin rejection, executable resolution and the shared platform database default. Full backend compileall passed on Windows Python 3.14. Full dashboard startup, live OAuth/providers, per-company email and the VM were not exercised. Source files were untracked at extraction time, so no commit or external PR was created; the manifest provides the focused review boundary.

### Installer integration: internal service addresses

Internal-only settings are STARLI_PLATFORM_ORIGIN, STARLI_CONTROL_PLANE_ORIGIN and STARLI_COMPANY_PLATFORM_ORIGIN. Compose should set these to http://platform:4100, http://control-plane:4120 and http://platform:4100 respectively. They are trusted operator settings, never browser/request input. Native defaults use 127.0.0.1 with platform port 4100 and control-plane port 4120.

Browser/OAuth settings remain strict: STARLI_PLATFORM_PUBLIC_ORIGIN defaults to http://127.0.0.1:4100, STARLI_CONTROL_PLANE_PUBLIC_ORIGIN to http://127.0.0.1:4120, and dashboard STARLI_PUBLIC_ORIGIN/WEBUI_URL to http://localhost:8080. HTTPS public endpoints can be supplied independently from container DNS names. OAuth token/API requests use internal origins; advertised authorization issuer/resource URLs use public origins. Public HTTP container DNS names are rejected.

The database contract is explicit STARLI_SOURCE_DATABASE for the dashboard and DATABASE_PATH for Node. Native defaults align with installer/native.mjs at platform/server/data/starli.sqlite. Compose uses platform-data:/data with DATABASE_PATH=/data/starli.sqlite; dashboard and task-worker need that same volume mounted at a separate read-only path (for example /platform-data) and STARLI_SOURCE_DATABASE=/platform-data/starli.sqlite. Installer owns applying these service environment and mount entries; the backend cannot infer a database shared across isolated containers. The control plane likewise needs the shared platform database path configured by its owner.

Follow-up validation: eight isolated tests pass, including Compose DNS/private IPv6 addresses, malformed endpoints, public/internal separation and native shared database resolution. Full backend compilation passes. No container services were started for these checks.
