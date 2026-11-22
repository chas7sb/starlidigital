-- grokbot1 W1 migration PROPOSAL (NOT EXECUTED against any production database).
-- Additive only. Apply per database inside BEGIN IMMEDIATE after a verified backup.

-- [A] native company-authority DB (STARLI_COMPANY_DATABASE or DATA_DIR/company-authority.sqlite3)
-- BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS grokbot1_saga_decisions(
  txn TEXT PRIMARY KEY, decision TEXT NOT NULL CHECK(decision IN ('COMMIT','ABORT')),
  company_id TEXT, owner_user_id TEXT, owner_audit_id INTEGER, reason TEXT,
  decided REAL NOT NULL, decided_by TEXT NOT NULL);
-- bot registry (native starli_memory/registry.py schema) must already exist in the registry DB.
-- COMMIT;

-- [I] NEW candidate intake DB (separate file, e.g. STATE_DIR/public/grokbot1-intake.sqlite3).
-- mini2 W4 issuer tables + mini3 W4 provisional tables are created by their own code;
-- before enabling, run the mini3 duplicate audit (fails closed on >1 active per guest).
CREATE TABLE IF NOT EXISTS grokbot1_claim_journal(
  txn TEXT PRIMARY KEY, intent_id TEXT NOT NULL, guest_binding TEXT NOT NULL,
  owner_user_id TEXT NOT NULL, idem_key TEXT NOT NULL, request_digest TEXT NOT NULL,
  company_id TEXT NOT NULL, boss_bot_id TEXT NOT NULL, provisional_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','COMMITTED','ABORTED')),
  lease_owner TEXT, lease_until REAL NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
  receipts TEXT, abort_reason TEXT,
  CHECK((state='COMMITTED') = (receipts IS NOT NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS grokbot1_one_live_claim_per_intent
  ON grokbot1_claim_journal(intent_id) WHERE state IN ('PREPARED','COMMITTED');
CREATE UNIQUE INDEX IF NOT EXISTS grokbot1_claim_idempotency
  ON grokbot1_claim_journal(owner_user_id, idem_key);
-- RECENT_AUTH_V1 evidence (no password stored; bound to sha256 of the native JWT).
CREATE TABLE IF NOT EXISTS grokbot1_recent_auth(
  reauth_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_sha256 TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method='native_password'), verified_at REAL NOT NULL, expires_at REAL NOT NULL,
  CHECK(expires_at > verified_at));
CREATE INDEX IF NOT EXISTS grokbot1_recent_auth_lookup ON grokbot1_recent_auth(user_id, token_sha256, expires_at);
CREATE TABLE IF NOT EXISTS grokbot1_recent_auth_failures(
  user_id TEXT NOT NULL, bucket INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(user_id, bucket));

-- [M] native webui.db and [P] Drive DB: NO schema change (native Store / Resources tables used as-is).
