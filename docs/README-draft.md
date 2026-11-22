# StarliDigital dashboard extraction — self-hosting draft

This project is extracting the existing StarliDigital application dashboard, without its marketing pages. It is not yet a validated portable release. Source presence, a working upstream deployment, and a working fresh installation are separate milestones.

## Current installation status

Windows, macOS, and Linux installation are requested targets. No platform is certified by this document. Use the release packaging instructions only after the source, lockfiles, configuration, and launch scripts have been integrated and tested. Do not copy an upstream database, environment file, session store, uploaded customer files, or credentials into a fresh installation.

The inspected backend manifest requires Node.js 24 or later. The separate dashboard manifest declares Node.js 18.13–22.x. These ranges do not overlap: use separate build environments until the integration owner verifies a common supported version or updates the dashboard tooling. The dashboard Python manifest requires Python 3.11 or 3.12. A Node-only installation does not establish full dashboard parity.

## Onboarding sequence

An implementation is now available in `onboarding/README.md`: trusted local first-owner and company setup, fresh private state, native start, and actual authenticated checks. Run it with the installed dashboard Python after dependency installation completes. Then use the dashboard `/setup` page to configure a provider/model. Actual disposable first-owner/company creation and migrations have passed. Full HTTP integration currently reaches a Windows-incompatible `fcntl` import in the memory store during dashboard startup; the earlier account-MCP ACL gate has been fixed. Helper tests do not override source gates. The public signup endpoint intentionally refuses zero-user bootstrap.

1. Obtain a complete sanitized source archive with its dependency lockfiles and required upstream notices. Confirm the archive includes the dashboard and its Python API, not only the older `web` workspace.
2. Follow the integrated packaging instructions to install dependencies and build each runtime. Upstream commands below are evidence for maintainers, not a tested installation recipe.
3. Configure a new writable application data directory and fresh secrets. Set local service URLs and allowed origins; replace upstream domains and host paths through the integrated configuration layer.
4. Bootstrap a new administrator using the documented local mechanism. The inspected Node entry point supports `ADMIN_USERNAME` and `ADMIN_PASSWORD`; its password minimum is 14 characters and its username validation allows 3–30 lowercase letters, digits, dots, underscores, and hyphens, starting with a letter or digit. This does not establish dashboard/Python identity synchronization.
5. Start the application through the release launcher. Verify the Node API health endpoint and dashboard sign-in separately, then exercise a new local record through the dashboard.
6. Configure optional providers individually with your own credentials. Validate one local workflow before enabling workers that can send messages, create billable resources, or publish content.
7. Configure the isolated computer-use VM through its own lifecycle instructions. A visible Browser panel alone does not prove an isolated VM exists.

## Upstream command evidence

The inspected platform root provides `npm run build`, `npm test`, `npm run start`, `npm run check`, and `npm run backup`. Its build covers `server`, `cli`, `device`, and `web`; `control-plane` is a workspace but is not included in that root build chain. The server build runs TypeScript checking (`tsc --noEmit`) and start runs `tsx src/index.ts`.

The separate dashboard provides `npm run build` (Pyodide preparation followed by Vite), `npm run check`, and `npm run test:frontend`. Its `dev` command binds Vite with `--host`; choose the integrated launcher's local binding policy before using it on a network. Dependency download and Pyodide preparation may require network access.

## Dashboard feature map

The following surfaces exist in inspected source. Their complete local behavior remains subject to extraction and integration testing.

| Area | Source evidence | Local readiness |
| --- | --- | --- |
| Chat and conversations | Main app, conversation route, bot chat route, shared conversation route | Not verified |
| Workspace | Models, knowledge, prompts, tools, function creation routes | Not verified |
| Administration | Users, settings, functions, evaluations routes | Not verified |
| Channels and playground | Channel route, playground, completions, notes | Not verified |
| Company | Dedicated Company panel, overview and native-capabilities API calls | Not verified |
| CRM | Dedicated CRM panel | Not verified |
| Projects, proposals, hosted agents, videos, activity | Collection panel dispatch in `/starli/[section]` | Not verified |
| Mailbox and social | Dedicated Mailbox and Social panels | Provider setup and local behavior not verified |
| Billing, approvals, tools | Dedicated panels | Provider setup and local behavior not verified |
| Browser | Dedicated Browser panel | VM isolation and lifecycle not verified |
| Subagents | `agents` section redirects to chat | Chat integration not verified |

Marketing pages are outside the extraction scope. Operational website generation, projects, and proposals are application features and should not be removed merely because their outputs can be public.

## Data and configuration

The Node store uses SQLite through `node:sqlite`, with WAL mode, and accepts `DATABASE_PATH`. Its default is `server/data/starli.sqlite` relative to the source module. It stores application records, users, sessions, and reset tokens. The Node HTTP listener defaults to `127.0.0.1:4100`; `/health` checks a database query and `/graphql` serves the schema. Dashboard/Python storage is a separate concern and must be documented by its extraction owner.

Keep backups of all integrated data volumes and generated assets using the release's verified backup procedure. The existence of an upstream `backup` script is not proof that it captures every dashboard service or restores successfully.

## Known release blockers

- Complete sanitized source and license/provenance review are not established here.
- Dashboard/Python and Node authentication, proxy routing, configuration, storage, and startup must be integrated.
- Runtime version conflict must be resolved or supported through separate environments.
- Optional integrations need explicit enabled/disabled behavior and fresh credentials; no upstream account access is bundled.
- Windows/macOS/Linux install, restart, upgrade, backup/restore, and uninstall need clean-machine verification.
- Computer-use VM creation, start/stop/reset, display/input, persistence, and host isolation need end-to-end verification.
- Full dashboard parity has not passed acceptance testing.

See `architecture.md` for the source boundaries and evidence scope.
