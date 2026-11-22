# New product validation

Historical tested application code: `8283115df7c116e2d620048d508df5795da511b0`. This is the native bots/teams/Boss product; the obsolete frontend has been removed from the current tree. The following matrix predates the single-company browser-first setup change. That change requires a new commit and fresh-install run before this matrix can be applied to it.

| Check | Windows x64 | Linux x64 | macOS ARM64 |
| --- | --- | --- | --- |
| Fresh checkout, public root install and start | PASS | PASS | PASS |
| Actual owner initialization and authenticated API login | PASS | PASS | PASS |
| Company, two admitted bots, bounded team and human message | PASS | PASS | PASS |
| Unauthenticated company access denied | PASS | PASS | PASS |
| Real process restart preserves bots, team and message | PASS | PASS | PASS |
| Product frontend build and infrastructure checks | PASS | PASS | PASS |
| New native backend core APIs | PASS | PASS | PASS |
| Actual provider inference in separate local app test | PASS | NOT TESTED | NOT TESTED |

The [fresh-install run](https://github.com/chas7sb/starlidigital/actions/runs/45015272789) executes seven checks per host after installation. The [build/infrastructure run](https://github.com/chas7sb/starlidigital/actions/runs/45015272382) and [native core run](https://github.com/chas7sb/starlidigital/actions/runs/45015272411) also passed. The locked backend CI separately runs nineteen collaboration regressions and native callback fixtures on all three hosts. Sanitized original install reports are collected in [new-product-install.json](../qa/results/new-product-install.json). They record the tested commit, source hashes, clean tracked checkout, zero requested model calls and no fixture bot turns.

The local Windows browser displayed the actual new frontend, signed into a fresh test company with Boss, Pico, Pixel and a shared team channel. The user entered an OpenRouter key directly in the local setup page. It remains in the encrypted local company vault; no credential is included in source or public evidence.

The final live handoff passed with five actual Nemotron Ultra free model calls, zero reported cost and no paid fallback. Pico generated `JAVA202: $7,850`; Pixel used those exact values in its response, and Boss preserved them while synthesizing both teammates' contributions. Neither value appeared in the initiating human request or the thirteen earlier room messages. All selected teammates have persisted native reply receipts. The completed state and transcript survived browser reload.

An independent read-only audit verified provider receipts, native agent attribution, scope and causal value transfer. The [public aggregate proof](../qa/results/new-product-live-proof.json) excludes raw provider response IDs, local evidence paths and account identifiers. Detailed receipts remain private locally. A separate existing Boss DM was also verified against an actual provider receipt.

The stricter test exposed an earlier incomplete run that reported completion without Pixel answering. Its evidence was preserved. The fixed scheduler requires every selected teammate's actual reply, quotes shared history as data, preserves prior generated values for dependent replies, and flags historical incomplete results. Nineteen isolated core tests and fifteen combined frontend tests pass. Fixtures remain explicitly separate from real provider verification.

Generated-app workers, trusted generated previews, autonomous tools and full imported-panel parity remain outside the verified local composition. See [API coverage](new-product-api-coverage.md). QEMU protocol and Windows guest evidence are separate from these application install checks; Linux/macOS VM execution is not established by this matrix.

Source metadata identifies the tested Git blobs separately from subsequent work, so Windows working-tree line endings cannot masquerade as a code difference. No tag, release or package-registry publication is asserted.
