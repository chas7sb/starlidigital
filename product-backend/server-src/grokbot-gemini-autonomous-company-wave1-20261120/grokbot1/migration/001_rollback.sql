-- grokbot1 W1 rollback PROPOSAL (NOT EXECUTED). Order matters; operator-reviewed only.
-- 0. Disable the feature (do not mount grokbot1_routes) and drain: wait until
--    SELECT count(*) FROM grokbot1_claim_journal WHERE state='PREPARED' = 0
--    (run Grokbot1Service.recover() until empty). Never drop while PREPARED rows exist.
-- 1. Claims already COMMITTED are real native companies owned by verified PERSONs: rollback of the
--    feature does NOT delete them. Their rows in companies/members/audit/bots/cm_*/resource are
--    ordinary native data from that point on (retention decision = ULTRA + owner).
-- 2. Remove additive candidate tables only:
-- [I] intake DB
DROP INDEX IF EXISTS grokbot1_claim_idempotency;
DROP INDEX IF EXISTS grokbot1_one_live_claim_per_intent;
DROP TABLE IF EXISTS grokbot1_claim_journal;
DROP INDEX IF EXISTS grokbot1_recent_auth_lookup;
DROP TABLE IF EXISTS grokbot1_recent_auth;
DROP TABLE IF EXISTS grokbot1_recent_auth_failures;
-- [A] authority DB (keep a copy for audit first: .backup grokbot1-decisions-<ts>.sqlite3)
DROP TABLE IF EXISTS grokbot1_saga_decisions;
-- 3. ABORTED sagas created no native rows (decision is the first native write) -> nothing to undo.
