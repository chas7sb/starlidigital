# AgentX 8 — QA status

Owns qa/ and docs/feature-parity.md. Collected read-only active dashboard evidence: all observed route files, 29 Starli panel actions/API literals/text, and 708 literal backend Python route decorators. Refreshed platform lexical inventory including extracted extensions: 53 GraphQL declarations and 65 direct HTTP pathname/router checks. No production data, secrets, services or ledger accessed/modified.

Added offline source_contract.py and optional localhost-only GET smoke for root/auth/config. Latest independent execution PASSES (exit 0, 195 passed, 0 failed) against extracted dashboard, matching Prime's result. Report saved in qa/results/source-contract.json. It always reports parity NOT_VERIFIED. Platform 4100 is listening; dashboard 8080 is not yet listening. Dashboard smoke pending AgentX5 backend startup. No authenticated action or VM tests executed.

Follow-up local smoke actually attempted against 127.0.0.1:8080 after a 56-second readiness window: 195 source checks passed, 3 HTTP checks failed (root, auth, config: connection refused). Saved qa/results/local-smoke.json. This is startup pending, not evidence of dashboard action failure. AgentX5 status says Python resolution passed 321 packages and downloads/builds are still in progress. Rerun the same smoke command when backend starts; full runtime parity stays NOT_VERIFIED.

feature-parity.md defines destination/action parity, additional workspace/admin/intelligence/location surfaces, clean-install checks on all 3 OSes, role/tenant checks, approval semantics, actual VM acceptance and rendered marketing absence checks. Source evidence is not runtime parity.

Prime integration extension roots acknowledged and extracted: MCP historical control-plane, workspace_entry/task worker, computer broker, OpenPencil, Mission Control and search. Refreshed lexical platform inventory. All extension service contracts still portableReady=false; enrollment/setup/runtime gates remain open. Platform GET /health independently passed HTTP 200 with ok=true/database=true; saved qa/results/platform-health.json. Resolve missing mounts and exercise manual acceptance before claiming full parity.
