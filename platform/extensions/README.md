# Extracted live extensions

This directory contains actual source extracted from additional live StarliDigital service roots. It is not a claim of complete runnable feature parity. `extraction-manifest.json` records original file digests and source paths before the portability changes described below. `service-contracts.json` records service commands, ports, and missing setup prerequisites.

## Included source

- Computer broker: four current JavaScript/Python source files, excluding backups and production enrollment. The broker uses signed native authority, fresh private files and Node24 SQLite. It is not a general VM desktop agent.
- OpenPencil: runtime gateway/MCP adapters and pinned npm lockfile, upstream MIT notice, existing customization patch. Production site compiled artifacts and user documents are deliberately excluded. Runtime private state must be generated fresh with `OPENPENCIL_PASSWORD` (16+ characters) and `node runtime/init-state.mjs`. This does not build the frontend or enroll users in StarliDigital.
  The exact upstream v0.16.0 source at commit `ffe2fc5798468988a5943c5f5737905c3c7a28b5` is in `openpencil/source`, with the Starli customization patch applied. Its manifest records 5,846 files (31,716,834 bytes); test fixtures and CI/editor metadata are excluded, with no unresolved LFS pointers in the copied source. Build using the upstream pinned Bun toolchain, setting `VITE_OPENPENCIL_DOCUMENT_ROOT` to the absolute runtime documents directory with a trailing slash, then place the resulting frontend in `openpencil/site`. The browser no longer assumes a production server path.
- Mission Control: complete selected server/control-plane source from the effective preview release. No production SQLite/auth data. Current root manifest references absent workspaces; integration must install the selected service dependencies explicitly or normalize the workspace before use.
- Search: selected SearXNG source, its AGPL license/notices, and the existing bounded WSGI wrapper. No Python virtualenv, production settings, logs, or history. The upstream sample `secret_key` is not a production credential; set a new `SEARXNG_SECRET` and private settings before launch.
  The shared signing placeholder and nonempty Pexels key default were removed. `python search/init-settings.py /absolute/private/settings.local.yml` generates a fresh signing key and refuses to overwrite an existing file. Set `SEARXNG_SETTINGS_PATH` to that file; the WSGI entrypoint rejects missing settings or a short/default signing key before importing the search app. Pexels is disabled until explicitly enabled with an operator-provided key; automatic key extraction was removed.

## Local portability changes

The broker resolves dependencies beside its own manifest and requires `STARLI_COMPANY_ID` / `STARLI_COMPUTER_STATE` instead of a production company UUID/path. Existing signed enrollment checks and native port allowlist are preserved. It retains Linux UID/mode checks and belongs inside the isolated Linux runtime.

Mission Control origin and path prefix are configurable with `MC_PREVIEW_OPERATOR_ORIGIN` and `MC_PREVIEW_PATH_PREFIX`. OpenPencil's CORS default is local rather than the production StarliDigital domain. No credentials or production documents are supplied.

The duplicated Mission Control platform has no recovery-email fallback. Its mailbox requires explicit `MAILBOX_EMAIL`, `IMAP_HOST`, `IMAP_USER` and `IMAP_PASS`; synchronization fails before connecting when absent. Account ID/display name can be set with `MAILBOX_ACCOUNT_ID` and `MAILBOX_DISPLAY_NAME`. The upstream production mailbox identity is removed.

## Validation performed

Private archive transport, SHA256 verification, regular-file/path validation and per-file digests passed for 1,135 extracted files. JavaScript parser checks passed for the modified broker and OpenPencil runtime. These checks do not validate external integrations, enrollment, service launch, or cross-platform UI parity.

Security-default checks passed: independently generated signing keys differ, initialization refuses overwrite, search startup rejects absent settings, and Pexels setup remains disabled without a supplied key. OpenPencil source patch application passed; its frontend build has not run because the pinned Bun toolchain is not installed on this host.

Actual gateway launch was verified on Windows with fresh synthetic scratch state: health, authentication, cross-origin rejection, scoped document save/read and traversal rejection all passed. Its file-containment check was corrected to use `node:path.relative`, which supports Windows separators. Mission Control was independently launched from the modified extracted source in private Linux scratch using fresh private state and a fresh read-only auth database; health passed and unauthenticated operator access was denied. No production services or data were used for those state fixtures. Broker job validation and signed-channel roundtrip/tamper rejection also passed. Full broker enrollment, editor build/MCP session, search provider requests and VM wiring remain integration work.

Re-run the reusable checks with `node platform/extensions/tests/broker-smoke.mjs` (Node24+) and `python platform/extensions/tests/security-defaults.py` (PyYAML installed).

Upstream licenses remain scoped to their original files/projects. No license is invented for custom broker or Mission Control code; a project-wide distribution decision is required.
