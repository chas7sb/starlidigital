# AgentX 3 — platform implementation

Status: extraction, metadata recovery, source fixes and local validation implemented. Validation completed after security remediation. AgentX3 owns platform base; extensions remain owned by Prime's integration assistant. Reuse the installed platform/node_modules; avoid concurrent npm ci.

## Source and recovery

- Exported 319 original source files from /srv/starlidigital/current (native-customer-oauth-dev-v34-20261118) and actual active MCP /srv/starlidigital/releases/20261109-luna-openwebui-writes/control-plane. The effective MCP path was verified with read-only systemctl show. Private SSH stdout transfer; no public export endpoint or production changes.
- Base compressed hash 7593e76cb87a74eea5125153ad58aad2e3ca37bdeb9df8788b3818b4010e90d3 matched MCP and SSH exactly. Active control-plane compressed hash bcd59a71d4adfd68f3e36635126e9a4e90ec98cb135e3609f1d0821b7a8253d5. Original extraction manifests retain original source hashes; local adaptations intentionally differ.
- Recovered server/package.json, server/tsconfig.json and 78 tests from /srv/starlidigital/development/platform. Package name/version/dependencies/devDependencies exactly match deployed root package-lock metadata. RECOVERY-MANIFEST.json records provenance and original hashes.
- Recovered business-events.ts and HostedAgentService from that development checkout. Reviewed service diff: only additive business-event lifecycle integration, transaction/notification wrappers, and deterministic input-message IDs differ from active source. Business-event tests now pass; no unrelated development source replaced current source.
- Original server store uses Node 24 node:sqlite and initializes a fresh SQLite database. No production database copied.

## Local implementation

- Removed HomePage import. Legacy / redirects to /login for signed-out users or /app for signed-in users, waiting for authentication refresh. All application routes retained.
- Restored shared public demo CSS under shared-public.css; hosted-agent demo depends on those styles. No marketing homepage component restored. Removed reference to excluded marketing hero raster.
- Fixed TypeScript narrowing by making OAuth error helper an explicitly declared never-returning function; password policy keeps runtime checks unchanged while accepting record-shaped user objects.
- Root build/test scripts now include active control-plane workspace.
- Removed upstream administrator recovery-email fallback; missing ADMIN_RECOVERY_EMAIL stores an empty string and password-reset requests do not queue recovery for accounts without a recovery address.
- Mailbox has no upstream address/user defaults. Configure MAILBOX_EMAIL, MAILBOX_ACCOUNT_ID (optional), MAILBOX_DISPLAY_NAME (optional), IMAP_HOST, IMAP_USER, IMAP_PASS and normal SMTP settings. IMAP sync and approved sends fail before transport when mailbox identity/configuration is absent. Test fixtures explicitly provide synthetic configuration. New regression test proves unconfigured mailbox does not connect or send.

## Validation

Windows Node 24.19.0. npm ci installed 360 packages using original locked dependencies. npm rebuild regenerated missing Windows command shims after ci. Combined root build passed before final security changes. Earlier suites: server 367 passing / 2 skipped, control-plane 55, CLI 19, device 9, web 33 passing; HTTP/WebSocket end-to-end test passed. Ten focused mailbox tests pass after security remediation. Final validation: all five workspace builds pass; server 370, control-plane 55, CLI 19, device 9 and web 33 tests pass (486 total), with 2 Docker-dependent server tests skipped. Final HTTP/WebSocket end-to-end run passed. The last combined run stopped on two control-plane fixtures relying on the removed mailbox default; those fixtures were given explicit synthetic mailbox identities, then control-plane and all remaining suites plus e2e passed. No runtime source changed after the successful final server/build run.

Two server tests require isolated Docker builds and remain skipped: Next source compile/type failure, and PNG embedding in compiled snapshot. This does not validate the separately owned computer VM or extensions. Vite emits an existing >500 kB bundle-size warning.

## Export review

Excluded symlinks, dependencies, build outputs, caches, environment files, data/uploads/logs, databases and large marketing raster/video media. No services, production configuration or ledger modified. Targeted credential/private-key scans found only explicit synthetic test values. No LICENSE/NOTICE existed in the two extracted platform roots; do not infer redistribution licensing from another component. Integration/security owners retain complete release review responsibility.

## Portable identity and sender contract

Implemented account-identity.ts: ACCOUNT_EMAIL_DOMAIN defaults to local.invalid; ADMIN_EMAIL optionally overrides bootstrap owner identifier. Normal username syntax/reserved-name and role checks remain. Existing stored accounts are not rewritten. Legacy login/recovery no longer displays a forced production email suffix. SMTP_FROM and EMAIL_FROM have no implicit sender fallback, and message IDs derive from explicit sender domains. Transactional sender validation accepts any valid explicitly configured sender instead of requiring the original organization.

Onboarding integration handoff: onboarding/platform-owner.mjs and onboarding/README.md were observed still hardcoding/describing the old production domain. Those files belong to AgentX10; use administratorEmail from platform/server/src/account-identity.ts and update the documentation. AgentX3 did not edit them. SOURCE-ADAPTATIONS.md explains local changes and environment configuration.

Completion: owned platform implementation is ready for integration. npm dependency artifacts, build outputs and test runtime data remain local/ignored; original source manifests are provenance, not hashes of adapted files. No git staging, commits or external publication performed.
