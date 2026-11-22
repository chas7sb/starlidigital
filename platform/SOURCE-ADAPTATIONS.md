# Local platform adaptations

`SOURCE-MANIFEST.json` and `control-plane/SOURCE-MANIFEST.json` record the original deployed source bytes. `RECOVERY-MANIFEST.json` records build metadata, tests and business-event source recovered from the development checkout. These are provenance records, not checksums of the adapted working tree.

The local adaptation restores missing server metadata, adds the recovered business-event lifecycle patch, fixes strict TypeScript narrowing without weakening checks, includes the effective control-plane in root validation, and routes the legacy homepage to the existing login/workspace. Shared public demo styles are preserved without restoring a marketing homepage.

Account addresses are identifiers, not provisioned email inboxes. `ACCOUNT_EMAIL_DOMAIN` defaults to the reserved `local.invalid` domain. `ADMIN_EMAIL` may override the bootstrap owner's address. `ADMIN_RECOVERY_EMAIL` is separate; recovery remains disabled for that account when it is absent. Existing stored users are not rewritten. Username length, syntax, reserved-name checks and role authorization remain in effect.

Mail requires operator configuration:

- `EMAIL_FROM` for transactional Resend mail, plus the existing provider and encrypted-outbox configuration.
- `SMTP_FROM` for SMTP mail, plus `SMTP_ENABLED` and the existing host/TLS/auth configuration.
- `MAILBOX_EMAIL`, `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASS` for mailbox synchronization. Optional `MAILBOX_ACCOUNT_ID` and `MAILBOX_DISPLAY_NAME` identify that local account.

No upstream sender, recovery recipient or IMAP username is selected implicitly. A disabled mailbox cannot connect or send an approved draft. All human approval, idempotency and uncertain-delivery handling remains intact.

The root `npm run check` validates the platform API, active control-plane, CLI, device connector and legacy React frontend, followed by local HTTP/WebSocket integration checks. It does not validate the separate Svelte dashboard, extension services, or computer VM. Two server tests requiring isolated Docker builds are conditional and may be skipped when that integration is unavailable.
