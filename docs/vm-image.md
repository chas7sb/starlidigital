# Portable VM base image

`runtime/image.py` packages a reviewed, stopped, standalone x86_64 guest disk. It does not download an image, create a desktop, sanitize a guest, or establish that the guest is safe. QEMU and Python 3.10+ must already be installed. Images and host state stay outside Git; the default export location is ignored `runtime/state/exports/`.

## Export a reviewed clean base

Shut the guest down cleanly through `python runtime/vm.py stop` and verify `python runtime/vm.py status` reports stopped. Export refuses running, shutdown-pending, unreachable, stale-tracked or locked guests. It takes the same exclusive lifecycle lock as the VM launcher.

Before attesting, inspect the guest for personal files, provider/API credentials, shell histories, browser sessions/cookies/profiles, cloud-init state, machine identifiers and SSH host keys. Remove those through the guest provisioning/clean-base process and verify first-boot identity regeneration. Review operating-system and bundled-package redistribution notices. The tool cannot prove these steps happened; do not distribute a working personal instance as a base image.

```text
python runtime/image.py export --clean-base-reviewed
```

Optionally pass `--output-dir` pointing to a **new** directory outside the repository or inside ignored `runtime/state`. The tool refuses existing output directories and never overwrites a package. The package contains exactly:

- `starlidigital-base.qcow2`: flattened, compressed standalone disk
- `starlidigital-base.qcow2.sha256`: SHA256 of that disk
- `manifest.json`: format, x86_64 architecture, size, digest and explicit operator attestation

The manifest follows `runtime/image-manifest.schema.json`. It deliberately records `guest_sanitization: NOT_AUTOMATICALLY_VERIFIED`. Installer ISO, host configuration, process tracking and host tokens are not copied. Data already inside the guest disk is still inside the exported image, including potentially recoverable deleted guest data. Export verifies the source disk hash is unchanged. No running guest is stopped automatically and no source disk repair is attempted.

An interrupted export can leave a partial output directory without a completed manifest. Do not distribute that directory. Inspect it and choose a different new output directory for a retry.

## Verify a trusted image

Obtain the expected SHA256 from an independently trusted release record. A checksum supplied beside an untrusted image does not establish authenticity. No release download URL is assumed or embedded by this tool.

```text
python runtime/image.py verify /path/to/starlidigital-base.qcow2 --sha256 EXPECTED_64_HEX_DIGEST
```

Verification hashes the regular file before QEMU inspects it, rejects backing-file dependencies, external data files, encryption, internal snapshots and dirty/corrupt flags, then runs read-only QEMU format and consistency checks. It never invokes repair. Consistency and digest checks do not inspect guest behavior or remove secrets.

## Import into a fresh installation

The destination `runtime/state` must be absent or completely empty. Existing VM state, logs, ISO downloads, exports, disks or configuration are preserved and cause import to refuse. Keep the downloaded package outside that directory.

```text
python runtime/image.py import /path/to/starlidigital-base.qcow2 --sha256 EXPECTED_64_HEX_DIGEST --accel whpx
python runtime/vm.py start
python runtime/vm.py status
```

Choose `whpx` on a compatible Windows x86_64 host, `kvm` on Linux x86_64, or `hvf` on Intel macOS. `tcg` explicitly selects slower software emulation and is required for this x86_64 image on ARM64 hosts, including Apple Silicon. When `--accel` is omitted, the tool selects the host's corresponding accelerator; ARM64 selects TCG. No failed hardware start silently falls back to software.

Import copies and verifies the image without modifying the source. It creates fresh private config with a unique `instance_id`, no installer ISO, no process tracking and no imported host credentials. The VM launcher independently generates a new QMP process UUID on every start. A durable firmware UUID requires launcher support for `instance_id`; guest machine IDs/SSH keys still need verified first-boot regeneration. No existing guest identity is assumed fresh merely because the host config is new.

Optional resource flags: `--memory-mb 4096`, `--cpus 2`, `--vnc-port 5901`, and `--network none|nat`. VNC binds only to loopback through the launcher. Networking defaults to `none`; choose NAT explicitly only after reviewing the guest network policy. No clipboard, shared directory or host token is imported.

A failed import can leave partial private state for inspection. The tool refuses to overwrite or automatically delete it. VM boot, graphical desktop, browser, network boundaries, account binding and dashboard controls remain separate runtime validation steps. Windows/macOS/Linux support must be verified on each target host.

## Executed validation

Nine unit tests cover clean-base attestation, stopped-state enforcement, checksum mismatch, unsafe image dependencies/features, output boundaries, source preservation, fresh identity, no-overwrite behavior, lock preservation and ARM64 accelerator selection. A real local `qemu-img` smoke test created a 16 MiB blank test disk, compressed/exported it, verified it and imported a byte-identical copy into separate fresh scratch state. Its compressed image was 197,120 bytes. The actual desktop guest was not exported or modified by that smoke test.

Implementation references: [QEMU image utility](https://www.qemu.org/docs/master/tools/qemu-img.html) for offline conversion/checking and [qcow2 format](https://www.qemu.org/docs/master/interop/qcow2.html) for header/dependency flags.
