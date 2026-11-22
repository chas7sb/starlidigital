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

### Staged-tree archive validation

Prime removed generated dist files. Current staged tree passes checked_paths (Prime independently reports 12,518 entries). AgentX9 is generating two source archives from the same index to compare actual SHA256 determinism; no index modifications. Nine packaging regressions pass, including indexed-only contents with unstaged changes, Unicode/space paths, repeated blob IDs, source-manifest-qualified data assets and rejection after staged tampering, plus onboarding/.local rejection.

Dashboard build is actively fetching original Pyodide scientific packages (scikit-learn/scipy/openblas) from CDN; npm dependency installation already succeeded. Latest VM component and setup/auth source were refreshed into the isolated scratch before starting npm run build. On successful completion AgentX9 will copy verified generated build output ONLY to ignored dashboard/build for AgentX5 local serving, as authorized by Prime. No source overwrites.

Prime: restage packaging/ and .github/ after this task's follow-up edits before treating any archive as final. Current artifact generation is a reviewed-index proof and may contain earlier staged packaging code.

Archive comparison note: the first two full archives correctly differed because Prime restaged source between calls (12,518 versus12,553 payload files; staged VM/setup/source changes). Their embedded manifests explain all changes. AgentX9 is now comparing two archives from one validated immutable list of index blob IDs, without locking or changing the index, to isolate the determinism property.

At10:01 local the actual dashboard Vite transform is active (CPU increasing, about660MB working memory). Pyodide downloads/copy completed. LocalComputer.svelte and its SetupPanel import are in this build snapshot. No build success claimed yet.

Actual full-archive determinism PASSED: two archives from one12553-entry immutable index snapshot are identical,155481732 bytes each, SHA2560c876229344c4da42c345c87fb14a189181bb765892c054f4230ff4fe287ce67. Review archives are in ignored work/agentx9-archive-c/ and -d/. They are private staged-source review artifacts, not published releases. Batch implementation avoids per-file Git processes and holds at most one payload blob in memory (plus small provenance exception evidence).

Backend source syntax rechecked in the refreshed dashboard snapshot:515 Python files parse successfully. Actual source archive payload verification rehashed all12553 entries against its embedded manifest and passed. Native installer owner reports Windows hash-lock installation PASSED after adopting the322-package lock; Linux/macOS installs remain unverified. Updated packaging documentation reflects native adoption and canonical-LF lock hashes.

### ABI compatibility remediation (Prime-authorized scope extension)

Root cause confirmed from actual installed metadata: datasets5.0.1 requires pyarrow>=21; pyarrow26.0.1 declares no NumPy dependency even though runtime rejects installed NumPy1.26.4. Transitive existing packages constrain NumPy1.x. AgentX9 is testing pyarrow21.0.0 + numpy1.26.4 in an isolated own venv (no changes to AgentX5 live environment). Arrow21 official docs support optional NumPy>=1.16.6 and Python3.11, and21 meets current datasets lower bound. If import+NumPy-array roundtrip succeeds, AgentX9 will pin this pair in backend requirements and pyproject and regenerate all four locks. AgentX5 should wait for compatibility handoff before next dependency sync. No misleading runtime-compatibility claim from resolution alone.

### FRONTEND BUILD HANDOFF — PASSED

Actual refreshed dashboard npm run build completed exit0 on Windows Node22.23.5/npm10.9.9. Includes LocalComputer.svelte, its SetupPanel import, latest setup/auth/provider UI. Vite transformed4413 modules and completed production output using static adapter fallback index.html (not200.html). Generated build copied, byte-for-byte SHA256 verified, to ignored shared dashboard/build for AgentX5 serving. Existing Svelte warnings include undefined createModelTag in upstream ManageOllama; successful bundling does not resolve that runtime feature bug. No source tree/dependency overwrite.

ABI remediation READY: isolated Python3.11.9+NumPy1.26.4+PyArrow21.0.0 import and NumPy-array-to-Arrow roundtrip PASSED. Both dashboard/backend/requirements.txt and dashboard/pyproject.toml now pin this pair. All four backend hash locks regenerated successfully. AgentX5 can hash-sync the updated Windows lock and retest model imports; do NOT retain oldPyArrow26. Explicitly separate platform video Python runtime: its pinnedNumPy2.4.4/OpenCV4.13/Pillow12.3/edge-tts7.3.1 cannot share dashboard NumPy1.26 environment. Prime authorized AgentX9 ownership of these dependency pins.

Hosted CI remediation in progress: confirmed macOS frontend heap OOM and Linux platform missingPIL; macOS platform log inspected separately. Setting CPU-only ONNX install and frontend6GB heap, and adding isolated video prerequisites/ffmpeg to platform jobs. AgentX5: apply equivalent CPU-only install and separate video venv in native/Compose installers.

### CI FIXES READY FOR NEXT PRIVATE PUSH

.github/workflows/validate.yml now installs the actual pinned platform/video-engine/requirements.txt in the platform job's isolated Python3.11 environment, installs FFmpeg on each OS, and explicitly passes setup-python's interpreter as PYTHON_BIN. This avoids Windows hardcoded interpreter fallback and leaves valid video tests enabled. macOS platform independently confirmed same missingPIL root cause as Linux.

Dashboard CI/build runner now defaults ONNXRUNTIME_NODE_INSTALL_CUDA=skip (documented by installed Microsoft onnxruntime-node/script/install.js; CPU binaries remain enabled), CYPRESS_INSTALL_BINARY=0, and NODE_OPTIONS=--max-old-space-size=6144. macOS actual job log confirmed FATAL ERROR: Reached heap limit. CPU-only ONNX install prevents Linux's optional CUDA404 without disabling dependency lifecycle scripts or inference functionality. Workflow YAML parses successfully. These fixes require new hosted execution; no passing matrix claim yet.

AgentX5: use the same CPU-only ONNX and frontend heap settings in both native and Docker frontend install/build. Separate video environment must use platform/video-engine/requirements.txt (NumPy2.4.4) and PYTHON_BIN for platform service; dashboard's tested NumPy1.26/PyArrow21 environment must remain separate. Backend4target locks now all match the new pins and requirements hash; check_backend_locks passes.

### READY FOR INTEGRATION — current result

Verified generated dashboard build copy is COMPLETE:4399 files,268116007 bytes, every destination SHA256 matched scratch output. Shared ignored dashboard/build is ready for AgentX5. Latest setup/auth/LocalComputer components were included. Local frontend npmci exit0, npmrunbuild exit0.

Backend new pin check PASSED: NumPy1.26.4+PyArrow21.0.0 array AND Parquet memory roundtrip in isolated Python3.11.9. packaging/backend_abi_smoke.py now installs only these two target-lock hash-verified binary wheels in isolated CI packaging jobs, then performs that roundtrip on each OS. This catches the actual undeclared NumPy ABI failure that dependency resolution missed. AgentX5 independently confirmed datasets5.0.1 import with the same pair. CI YAML syntax passed after edits; new remote run required.

IMPORTANT: earlier ignored source review archives predate the ABI pin/CI fixes and are determinism proofs only, NOT final release candidates. Prime must restage current packaging/.github and dashboard requirements/pyproject dependency pins, run security/index gates, and regenerate source artifact from final reviewed index. AgentX9 never modified shared index or pushed/published. The staged source currently may be behind the final few edits.

Hosted portable-logic tests added to packaging job on everyOS: test_private_storage.py (actualPOSIX/Windows ACL boundaries), onboarding/test_first_run.py, and ALL runtime/tests/test_*.py (VM protocol, image lifecycle fixtures, console input, adapter identity and router auth). Only boundedFastAPI0.115.7+httpx0.28.1 dependencies added; no full backend install or guest payload/QEMU launch.

URGENT AgentX4/Prime fixture portability note: runtime/tests/test_vm.py::test_default_boundary_and_explicit_accelerator hardcodes accelwhpx but does not patch platform.machine to x86_64. On realmacOSARM runner, correct vm.command ARM policy rejects it. Please fix this x86-specific test fixture by explicitly mocking x86host for that case, while retaining separate realARM-rejection tests. AgentX9 has not edited runtime-owned tests. Current currentplatform tests now exposed on hostedARM rather than skipped.

Final local follow-up checks:29 runtime tests PASSED in Python3.11 (protocol/image/console/adapter/router),7 Windows private-storage tests PASSED (actualDACL/filesystem),5 onboarding tests PASSED. CI adds these exact portable suites on Windows/macOS/Linux, with only FastAPI0.115.7/httpx0.28.1/Pydantic2.10.6 beyond stdlib. Runtime test fixture x86assumption remains flagged above for AgentX4/Prime before ARMmacOS hosted run. No tests skipped or removed by AgentX9.

CURRENT HANDOFF: packaging+CI fixes and4freshABI-compatible hash locks ready to restage/private-push. Local verified dashboard output is complete in shared dashboard/build. First remote run45000883339 failed as diagnosed; NO later remote run exists at last check. New hostedOS results are required to close cross-platform validation. Prime owns staging/push; AgentX9 made no index or publication changes.
