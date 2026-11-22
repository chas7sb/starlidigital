# StarliDigital owner-flow and feature notes

This supplemental draft summarizes AgentX10's verified owner flow. Use the [root README](../README.md) and [installation guide](install.md) as the authoritative entry points; this file does not replace their current commands or certify a completed release.

## Install and first owner

The root README currently directs native users to run:

```text
npm run doctor
npm run install:app
npm run setup
npm start
```

Follow the [installation guide](install.md) for prerequisites, build steps, runtime downloads, platform differences and Docker options. The existing dashboard needs its Python backend as well as its frontend. The installer separates Node24 for the platform/provider runtime from Node22 for dashboard frontend tooling, and isolates dashboard and video Python environments.

[First-run details](../onboarding/README.md) describe trusted local owner/company provisioning and setup/start/check commands. Setup prompts privately, creates fresh local state and a stable session secret, and establishes an explicit dashboard-to-platform administrator binding. Public signup cannot bootstrap a zero-user installation. After owner provisioning, use /setup to sign in, connect an account provider and select a model.

Never copy upstream production databases, environments, credentials, sessions or customer files into a fresh installation. Bring your own provider accounts; catalog availability alone does not establish a working provider connection.

## Verified Windows owner flow

Actual disposable runtime checks passed for migrations and fresh dashboard/Node administrators, private identity binding, owner company membership, registry initialization, both HTTP health endpoints, dashboard sign-in, platform administration, customer identity, company listing and owner capabilities. Unauthenticated admin access was denied.

After controlled source reload, the same state returned 42 providers and 69 authorized tools through real authenticated application routes. VM status and a valid PNG frame passed with Bearer authentication and same-origin requests. No provider inference, tool execution, external send or guest control was issued in these checks.

Same-state resume preserved the owner/company/Node IDs, databases, credentials and session secret. Eleven onboarding/resume tests passed on Windows, including ambient database override protection, fail-closed explicit broad-ACL rejection, private file creation and resume path/port safeguards. See [AgentX10 status](agentx10-status.md) for exact evidence and the retained private QA handoff.

This is core owner/catalog/VM-read evidence, not full feature parity or three-OS native-boot certification.

## Feature map and evidence boundaries

Use the current [feature parity matrix](feature-parity.md) for detailed acceptance status. These application surfaces exist in source; a route or panel alone does not establish complete behavior.

| Area | Evidence from this owner-flow work | Remaining acceptance boundary |
| --- | --- | --- |
| Authentication and administration | Fresh owner login, role checks and private platform binding passed | Complete administration/evaluation workflows remain with feature owners |
| Company | Actual company creation, owner listing and capabilities passed | Complete company resource and member workflows remain separate |
| Providers and tools | Real authenticated catalogs returned 42 providers and 69 tools | Provider login/inference and tool execution require their own checks |
| Computer | Authenticated installation-owner VM status/PNG frame passed | Guest lifecycle, input, isolation, persistence and portability use runtime evidence |
| Chat, conversations and subagents | Existing dashboard/chat source retained | Model-backed chat and complete agent workflows are not established here |
| Workspace, knowledge, models and prompts | Existing source/routes retained | End-to-end workspace acceptance is tracked in feature parity |
| CRM, projects, proposals, hosted agents, videos and activity | Existing operational panels retained | Consult each owner's runtime validation; not certified by owner-flow smoke |
| Mailbox, social, billing and channels | Existing operational surfaces retained | External account configuration and communications/commercial workflows remain separate |

Marketing pages are excluded. Operational website generation, projects and proposals remain application features even when their outputs can be public.

## State and configuration

The platform uses SQLite through node:sqlite. The owner flow sets explicit private paths for the dashboard database, platform database, authority/registry stores, memory, assets and workspace. DATABASE_URL and STARLI_DASHBOARD_DATABASE_URL resolve to the same generated private dashboard SQLite database, preventing an ambient launcher override from redirecting state.

Configuration, bindings and credentials are created and checked through the shared private-storage policy. Existing broad Windows ACLs are refused without repair; new files receive protected owner-only ACLs at creation. The explicit ID binding and both administrator roles confer platform authority; matching email addresses do not.

Back up the session secret, binding, owner metadata, all application databases and generated assets using the project's verified procedure. The existence of a backup script alone is not evidence of a complete successful restore.

## Separate release gates

Complete feature parity, external-provider execution, three-platform native boot, VM acceptance, backup/restore/upgrade/uninstall, provenance/license review and distribution readiness are separately owned gates. Check their current guides and results instead of interpreting this owner-flow smoke as certification.

See [architecture](architecture.md), [configuration](configuration.md), [installation](install.md), [runtime](runtime.md) and [feature parity](feature-parity.md). Historical initial-inventory blockers in earlier drafts are superseded where the current status records passing runtime checks.

