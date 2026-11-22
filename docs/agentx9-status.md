# AgentX 9 — packaging and CI

Ownership: `packaging/`, `.github/`, and this coordination file.

Implemented:
- Deterministic source ZIP from reviewed Git index blobs, embedded SHA256 manifest and adjacent archive checksum. Does not stage files, copy untracked files, publish anything, or include dependency directories/VM disks/runtime state.
- Fail-closed checks for source/lockfile/license presence, sensitive filenames, generated/runtime directories, symlinks/submodules and unsupported directories.
- Manifest-derived component build runner: platform Node 24, dashboard Node 22, npm ci then npm run build. Fails on missing workspace manifests or locks.
- GitHub CI matrix for Windows 2025, macOS 15 and Ubuntu 24.04: packaging tests; separate builds of both components; dashboard Python 3.11 syntax compilation. Pinned action commits, read-only contents, no deployment credentials.
- Manual source-artifact workflow; no release, registry, container, or repository publishing.

Executed locally: six packaging tests pass on Windows, including identical archive SHA256 for repeated input, index-only inclusion, secret/runtime rejection, license gate, symlink rejection, and version path safety.

Integration / remaining gates:
- No shared source files staged by AgentX 9. Prime owns index/release review. Source archive intentionally blocks until required tracked sources and root/upstream license files exist.
- Platform source arrived during this task and matches the inspected Node/workspace build contract. Dashboard extraction and source owners' compile validation still pending at last inspection.
- Full hosted three-OS matrix has NOT run. No native backend startup, installer, VM lifecycle or end-to-end parity claims.
- Dashboard Python requirements include unpinned dependencies; runtime byte-for-byte reproducibility is NOT established.
- `packaging/README.md` documents commands, limitations and independent release gates. Source archive is portable source, not a single-file executable or bundled VM.

Final verification: workflow YAML parsed successfully locally. Attempting source archive against the current shared index correctly failed with missing tracked dashboard/platform source and provenance files (source owners' working files are not staged). No archive or public release was produced. This is the intended release gate.

## Follow-up validation in progress

AgentX 9 is validating actual extracted source in isolated own scratch copies, so other owners can continue editing safely. Will attempt dashboard Node 22 clean npm build and backend Python 3.11 dependency resolution. Will rerun platform as soon as missing server metadata lands. No shared index changes or public publishing.

### Actual source build finding (2026-11-22)

Isolated clean platform npm ci PASSED (360 packages). Root npm run build FAILED at server TypeScript: recovered server/test/business-events.test.ts and hosted-agent-business-events.test.ts import missing ../src/business-events.js. Related callback implicit-any diagnostics follow. Source owner AgentX3: please resolve test/source release mismatch before release. No source files changed by AgentX9. Isolated snapshot was taken after server package.json arrived; may predate your latest changes.

Security follow-up: source archive rejects the entire tracked platform/server/data and control-plane/data trees through the existing data-directory rule, regardless of extension. Regression test now explicitly stages platform/server/data/database.sqlite-wal and preview.mp4 and verifies failure. Also rejects installer/local.env-style credential files and SQLite WAL/SHM filenames outside runtime directories. CI's only upload path is work/release/* source ZIP/checksum, never build/test working directories.

Platform follow-up: refreshed recovered source and full root npm run build PASSED on Windows Node24.19.0/npm11.17.0 (server, control-plane, cli, device, web). Original missing business-events finding is resolved in this snapshot. Full npm test currently running in own scratch, not shared tree.

Platform npm test completed successfully in isolated scratch: 485 tests total, 483 passed, 2 skipped, 0 failures. Skips are the source's Docker real-build and compiled-PNG-reference tests; no Docker parity claim. CI now also runs the platform test script after build on all three OSes. Dashboard Python compile step now explicitly fails if backend directory is missing instead of allowing compileall's missing-path behavior.

Python hash-lock attempt: default uv cache was locked by the parallel installer dependency download; three target resolutions timed out waiting for rapidocr/opencv cache locks. AgentX9 did not stop or change the installer process. Retrying in isolated own cache. Plain Windows/Python3.11 full dependency resolution already succeeded; installation and hashed target locks not yet verified. New packaging/lock_backend.py provides bounded per-target hash-lock generation, dedicated cache, input hash and resolver metadata, and atomic lock promotion only on success.

### Python locks complete

Resolved dashboard/backend/requirements.txt for Python3.11 separately on Windows x64, Linux x64, macOS x64 and macOS ARM64 using uv0.11.19. All four locks include exact package versions and SHA256 hashes; adjacent JSON records target, resolver, canonical-LF source/lock hashes, and honest resolution-only status. packaging/check_backend_locks.py passes and CI/archive workflow now enforce freshness. Installer owner AgentX5: these are available under packaging/locks/ for optional reviewed adoption; current installer Docker/native dependency input is still backend/requirements.txt. Actual installation is NOT claimed for any target. requirements SHA256 (LF): 930e16bf62b78e22bb647a969aed0c6dc03d22b748af1b42fad24940ff6d8bc5.

Dashboard final snapshot must include AgentX2 setup/auth changes and Prime vm_dashboard_bridge LocalComputer component. AgentX9 awaits bridge handoff while its isolated Node22 dependency install completes. No duplicate shared install started.

### Immediate staging/build handoff

Current checked_paths gate FAILS at tracked platform/cli/dist/index.d.ts (generated build output). Prime must remove generated dist trees from index; AgentX9 did not modify index. onboarding/ is now accepted and onboarding/.local is rejected. Source-name collisions can pass only under explicit vendored prefixes with matching SHA256 in INDEXED source manifests. Archive streams all immutable indexed blobs through one cat-file batch process (plus a bounded provenance batch when needed), no per-file process loop.

Dashboard clean npm ci Node22.23.5/npm10.9.9 completed successfully: 934 packages, exit0, 10 minutes. Precise delay was onnxruntime-node tarball download/extraction (17 native files, 188,767,685 bytes); no lingering lifecycle subprocess. CYPRESS_INSTALL_BINARY=0 was set. Latest setup+VM source refresh now proceeding, then build.
