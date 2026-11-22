# Packaging and CI

This directory prepares a reviewed **source distribution**, not a bundled executable,
VM disk, native installer, or claim of feature parity. The same source ZIP is usable
on Windows, macOS and Linux through the installer once its prerequisites and release
gates pass. Dependencies, model weights and VM images are not bundled.

## Build contract derived from the deployed manifests

- `platform/`: Node 24, root npm workspaces, `npm ci`, then `npm run build`.
- `dashboard/`: Node 22 (the upstream manifest caps support at 22), `npm ci`,
  then `npm run build`. Its build invokes the upstream Pyodide fetch script and
  may require network access beyond npm.
- Dashboard backend declares Python >=3.11,<3.13. CI uses Python 3.11 for backend syntax
  compilation, focused router/privacy tests and the locked NumPy/Arrow ABI pair. Native backend dependency installation, startup, migrations,
  integration tests and VM execution are separate release gates.
- Dashboard Python dependencies include unpinned entries; no fully reproducible
  Python runtime environment is claimed. Node major versions are deliberately
  separate. Build scripts fail on missing manifests, lockfiles and workspaces.

Run each component with its required Node version:

```text
python packaging/build_component.py platform
python packaging/build_component.py dashboard
python -m unittest discover -s packaging -p "test_*.py" -v
```

The build command executes dependency lifecycle scripts and the source's build
script. Use an isolated checkout without production credentials. CI has read-only
repository permission and no production secrets or deployment steps. Action code
is pinned to resolved commit IDs. `validate.yml` runs packaging checks and both
component builds on Windows, macOS and Linux. Passing compilation does not prove
backend startup or end-to-end parity.

## Reviewable archive

Prime owns repository staging and release readiness. After reviewing and staging
only intended distribution files, including licenses, run:

```text
python packaging/source_archive.py --version 0.1.0-review
```

Output defaults to `work/release/`. The script includes **Git index blobs**, never
untracked files or unstaged modifications, and never stages anything itself.
It requires both component manifests and npm lockfiles, dashboard pyproject and
LICENSE, plus a root distribution LICENSE. It rejects tracked runtime state,
secret file names, unsupported top-level directories, symlinks and submodules.
These filename checks supplement the security owner's content scan; they are not
a guarantee that tracked source is free of embedded secrets or customer data.
Preserve all upstream LICENSE/NOTICE/attribution files in the reviewed index.

The ZIP uses sorted paths, fixed timestamps, normalized modes and stored bytes
(no compression) so the same index contents and version produce identical bytes
across hosts. An embedded `SOURCE-MANIFEST.json` lists every payload hash and
mode; an adjacent `.zip.sha256` verifies the archive. Windows extraction tools
may not preserve Unix executable modes; invoke shell wrappers through `sh`.
The script refuses to overwrite existing output archives.

`source-archive.yml` is manual only. It uploads a seven-day workflow artifact;
it does not publish GitHub Releases, npm/PyPI packages, containers or a repository.
Run validation and all source/privacy/license/installer/VM acceptance gates before
using that artifact as a release candidate. It does not enforce those independent
gates automatically.

Implementation references: [setup-node](https://github.com/actions/setup-node),
[upload-artifact](https://github.com/actions/upload-artifact).

## Backend environment locks

The actual deployment installs `dashboard/backend/requirements.txt`; it differs
from the upstream `pyproject.toml`, so these locks use that requirements file.
`lock_backend.py` targets Python 3.11 separately for Windows x64, Linux x64,
macOS x64 and macOS ARM64. It uses uv, pins every resolved package and emits
package SHA256 hashes plus source/lock SHA256 metadata (canonical LF line endings). Requirements changes
invalidate the lock check. Resolution is not proof of native wheel availability,
successful installation, startup, or compatibility with system libraries.
The native installer now consumes these locks with hash enforcement and freshness
checks. Its Windows backend hash-lock install passed in AgentX5 validation;
Linux/macOS native installation and the Compose dependency path remain unverified.

```text
python packaging/lock_backend.py windows-x64
python packaging/lock_backend.py linux-x64
python packaging/lock_backend.py macos-x64
python packaging/lock_backend.py macos-arm64
python packaging/check_backend_locks.py
```

Use a current uv installation; generated metadata records the actual resolver
version. Run targets sequentially when sharing a cache, or pass a distinct
`--cache-dir` for concurrent work. Lock generation has a 30-minute timeout and
promotes its temporary output only on success. Full runtime reproducibility also
requires pinned OS libraries, Python builds, model assets and container bases.

## Verified local execution and CI findings

Windows validation completed: platform clean npm install, all workspace builds,
and 483 passing tests (two source-declared Docker-dependent skips); dashboard
Node 22 clean install and full production build including setup and local VM UI;
nine packaging tests; four backend hash locks and freshness checks; NumPy/Arrow
array and Parquet roundtrip. The generated dashboard build is for local review.

The first hosted matrix exposed missing video-engine Python/FFmpeg prerequisites,
Linux's optional ONNX CUDA download failure, and a macOS frontend heap limit.
The workflow now installs the pinned video requirements in its separate platform
job, installs FFmpeg, selects that Python explicitly, retains CPU ONNX inference,
and gives frontend compilation a 6144 MB heap. The next hosted execution must
validate these fixes. Upstream Svelte warnings remain, including an undefined
createModelTag in ManageOllama; successful bundling does not establish that feature.

Backend NumPy 1.26.4 and PyArrow 21.0.0 are pinned in both dependency entry points.
PyArrow 26's undeclared runtime NumPy >=2 requirement caused a real startup import
failure despite successful dependency resolution. The replacement pair passed
local ABI tests and the native installer owner's datasets import test. CI runs
`backend_abi_smoke.py --install` against only the hash-locked binary wheels in a
separate environment. Video-engine NumPy 2.4.4 belongs in its own runtime.

Reference for the selected ABI pair: [Arrow 21 installation dependencies](https://arrow.apache.org/docs/21.0/python/install.html#dependencies).
