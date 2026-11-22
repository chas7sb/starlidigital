# Corrected new-product source identification

Observed read-only on 2026-11-22. This supersedes the UI target in source-inventory.md: the requested product is the new Starli/Boss/bots/teams workspace. The earlier old Open WebUI UI extraction is not an approved release candidate.

## Authoritative current work

Base path (R):
/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/codex

The active ULTRA BO$$ work is in R, not the desktop React project and not simply webui-current. Another chat actively owns it; this inspection changed no source, runtime or service there.

| Evidence | Exact path |
|---|---|
| Coordinator state | R/coordinator-r1/CURRENT-VERIFIED-STATE.json |
| Joined V9 release pins | R/assembly-r1/next-v9/JOINED-RELEASE-PINS.json |
| Joined V9 frontend source | R/assembly-r1/next-v9/frontend/app |
| Newest discovered scoped frontend | R/assembly-r1/next-v12/frontend/app |
| V12 source lock | R/assembly-r1/next-v12/SOURCE-LOCK.json |
| V12 build receipt | R/assembly-r1/next-v12/BUILD-V12-RECEIPT.json |
| V12 output | R/runtime-assembly-r1/frontend-build-v12 |
| Joined runtime adapters | R/assembly-r1/adapters |
| Runtime entry scripts | R/assembly-r1/scripts |
| Current mission browser evidence | R/browser-acceptance-r2 |
| Model app runtime work | R/runtime-model-app-browser-r1 |

R is an abbreviation for the absolute base above, not a relative checkout path.

## Pinned versions and acceptance

All **937** V9 SOURCE-LOCK paths and **941** V12 SOURCE-LOCK paths were independently read and SHA256 checked against their respective frontend/ trees: zero missing files, zero mismatches. Every sourcePins entry in the V9 joined manifest also matches its current file. This is source integrity evidence, not proof that the latest live process uses those bytes.

| Item | SHA256 |
|---|---|
| V9 JOINED-RELEASE-PINS.json | 6b6307c5ff3031df981dfbe05e891a09921a562c01f020c3e547dca3345fbbc4 |
| V9 SOURCE-LOCK.json | 08ca05a1dcf005058364d0d369a9fbe41dcff7678ad7a9e2169be20f4678a40c |
| V9 BUILD-V9-RECEIPT.json | 480936b20707c1f2dcd7c836ce8686576bacb3b88da785b634a7667b71de5d8f |
| V12 SOURCE-LOCK.json | 94e9416c4d8aff966dccd52794073160528bde3bea9a4656f8d24006c23c9245 |
| V12 BUILD-V12-RECEIPT.json | 2c984308ed50bc99087f2c94369e11516deb787930f6b86f1a212374e7c6cf2f |

V9 joined pins record actual provider inference for guest/company chat, company browser verification and actual Windows automatic guest reply/reload acceptance. The coordinator latestPrivateDemo records a cosmic input-only entry, rotating avatars/names, explicit send into guest workspace, persisted replies, logged-out Register/Sign in, and a real company bot DM reply. Those are existing recorded acceptance claims, not a fresh visual test in this inventory.

V10, V11 and V12 exist after V9; each has a successful actual frontend build (exitCode 0), but their build receipts explicitly say BUILT_NOT_BROWSER_ACCEPTED, browserVerified=false and productionReady=false. V11 adds coordinator-recipient selection (explicit mentions take precedence). V12 adds owner-resume gates after native auth; its HANDOFF says nine checks passed but browser sign-in and claim acceptance remain pending. Do not label V9 latest, or V12 joined/browser accepted.

Coordinator activeMissionNov22 updated at 2026-11-22T08:54:03Z describes actual model-built CRUD app, same conversation through native auth/claim, right preview, temporary-company left sidebar and Sign in/Register. It still lists combined browser history transfer, fresh owner preview/sign-in resume and tenant/revocation checks as unverified. The top-level updatedAt is older than the nested mission timestamp, so use component-specific timestamps.

## Feature evidence in V12 source

All paths below are under R/assembly-r1/next-v12/frontend/app/src:

- lib/components/marketing/GuestIntentWorkspace.svelte:134 has the Temporary company workspace section. This folder name does NOT make the component disposable marketing.
- lib/components/marketing/Homepage.svelte contains the entry/avatar experience and coordinator role.
- lib/components/marketing/model-room-recipient.ts selects the native model-room coordinator.
- lib/components/marketing/VerifiedClaimNavigation.svelte imports verified claim-room navigation; ClaimedBuildConfirmation.svelte supplies build confirmation.
- routes/app/+page.svelte:261 maintains modelCoordinatorId. Around line 723 it derives agent targets from mentions and enforces up to 16 bot mentions with dispatch receipts.
- lib/components/starli-shell/CompanyWorkspace.svelte posts messages with agent targets; GroupCreator.svelte creates memberAgentIds/coordinatorAgentId.
- enterprise BotsDirectory, agents/AddBot, agents/AgentSettings, company/CompanyChannels and messaging/MentionComposer supply bot/team settings and room mentions inherited into this candidate.

These prove UI and dispatch integration paths. Agent-to-agent autonomous execution requires joined runtime authority/model-worker evidence in assembly adapters and current runtime components; UI labels alone do not prove it. The V9 chat record explicitly says native app workers were deterministic local, modelCalls 0, although chat used actual inference. The later Nov22 mission records actual model app-worker calls. Keep those execution classes distinct.

## Preview and visual-match limits

Server-local read-only HTTP checks: http://127.0.0.1:17281/ is unavailable; http://127.0.0.1:18281/ returns HTTP 200. The latter is the current mission browser origin recorded in coordinator state. No service was restarted, tunnel installed or session mutated.

**A fresh visual match is not yet established by this task.** The known V9 visual acceptance and current mission metadata are evidence leads. The active owner/browser-acceptance agent must bind the 18281 runtime to exact frontend and joined component pins, inspect the visible Starli/Boss/team flow, and finish claim/sign-in/history/tenant checks. Avoid opening or changing their live browser session without coordination. HTTP 200 does not establish visible correctness.

## Public deployed frontend, distinct from private candidate

Nginx read-only inspection confirms starlidigital.ro/www and starliapp.com route frontend requests to:
/var/www/starlidigital/frontend-current

This symlink resolves to:
/var/www/starlidigital/releases/enterprise-company-mcp-always-v41-20261119

Active public index SHA256:
ba13a5dd1aa2b3aa26c50c54cb594d942ba52dd7c79a2ea8d3cdff39f155b7e3

Public APIs/streaming remain separate backend services. The editable public source is /srv/starlidigital/frontend-workspace according to its DEPLOYMENT.md. Its SERVER-UPDATE-HANDOFF.md documents canonical Bots heading, DM unread, notifications, avatar presets, mentions and dispatch cards. Its app route SHA256 is c1d7da950b7a4ffebc0b732f13ef0c78bfbbd4ad736d68eab3efcd919928ba56.

frontend-workspace is Svelte 4/Vite 5/Node <=22, despite inherited package name open-webui 0.6.5. It contains custom enterprise UI; inherited package names cannot identify the requested product. /srv/starlidigital/frontend-releases/enterprise-artifacts-20261116 is static/base asset provenance (including reusable Pyodide), not the newest private joined candidate. Do not confuse it with /var/www/starlidigital/releases.

## Desktop project and instructions

C:/Users/Administrator/Desktop/starlidigital-app exists with frontend/, backend/, cli/ and smtp-relay/. Root, frontend and backend are not Git repositories; no current branch or commit can be established. No AGENTS.md was found in its recursive tree or checked local ancestors.

Desktop frontend is React 19.2 / Vite 7.2 and backend Express 5.2 / Prisma 7.2 / PostgreSQL. App.tsx:23/159 and backend/src/index.ts:17/620 have removed Clawdbot imports/routes. No matching deployed-company/Boss provenance was found. Treat this as a separate/older base until exact hash and feature comparison proves otherwise. Do not read/copy its .env files, uploads, projects_data or installed dependencies.

No AGENTS.md was found in checked R ancestors, frontend-workspace source search, or the inspected direct source roots. Editable frontend-workspace has no .git. Read ownership/handoff contracts before any later mutation; this task performed only reads there.

## Extraction decision

Use a coordinated immutable snapshot of the new joined candidate and its actual runtime closure. V12 is the newest discovered frontend source; V9 is the discovered joined/browser-recorded baseline. The active owner must select and pin the final combined revision after completing remaining acceptance. Neither old Open WebUI, the public v41 static release, nor Desktop React should be substituted for it.

Preserve SOURCE-LOCK, build/joined receipts and necessary adapters/entry scripts; audit dependencies, licensing and guest integration from that chosen snapshot. Preserve guest-entry components even when located under marketing/. Remove actual sales pages only after route/import tracing.

Exclude *.private.json, tokens, launch/control credentials, runtime bindings with secrets, demo/preview state, profiles, customer databases, native temporary roots, runtime ownership state and customer content. Do not copy whole runtime directories. No candidate source/config/state was extracted or changed in this identification task.
