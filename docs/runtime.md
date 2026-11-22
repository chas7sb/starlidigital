# Isolated Linux computer runtime

The runtime uses QEMU system virtualization, not a privileged container. The Python 3.10+ launcher has no third-party Python dependencies. It selects WHPX on Windows, KVM on Linux, and HVF on Intel macOS. Hardware acceleration never silently falls back. `--accel tcg` explicitly selects QEMU software emulation and is slower; this is also the current x86 guest route on ARM hosts, including Apple Silicon. An accelerated native ARM guest is not implemented.

## Host installation

Install QEMU separately using the routes linked by the [QEMU download page](https://www.qemu.org/download/): Windows binaries from its linked Windows distributor, Homebrew `brew install qemu` on macOS, or your Linux distribution's QEMU system package. QEMU must expose `qemu-system-x86_64` and `qemu-img` on PATH. On Windows the launcher also checks `Program Files/qemu` and `runtime/vendor/qemu`. It does not enable OS features, install drivers, reboot the host, or modify host networking. Portable here means portable launcher and per-project VM state; native hypervisor prerequisites remain host-specific.

Use a trusted Linux x86_64 installer ISO and verify its publisher checksum. No ISO, hypervisor binary, VM disk, user data, or downloaded dependencies are part of source distribution. The runtime state and vendor directories are ignored locally. Before creating a VM, check free RAM and disk and choose bounds appropriate to the host.

From the repository root:

```text
python runtime/vm.py doctor
python runtime/vm.py init --iso /absolute/path/linux.iso --memory-mb 4096 --cpus 2 --disk-gb 24
python runtime/vm.py start
python runtime/vm.py status
python runtime/vm.py stop
```

On Windows use a full Windows ISO path. If WHPX is unavailable, fix the host prerequisite or deliberately initialize with `--accel tcg`. On x86 Linux, `/dev/kvm` must be accessible to the current user. On Intel macOS use HVF. On ARM hosts use `--accel tcg` for this x86-only implementation. Linux and macOS execution have not been tested in this Windows session.

Connect a VNC client to `127.0.0.1:5901` to complete OS installation. `init` creates a blank qcow2 disk; it does not claim to install Linux. After installation, stop the VM and set `iso` to `null` in `runtime/state/config.json` to boot from disk. The `-no-reboot` launch policy exits QEMU when the guest reboots, rather than accidentally booting the installer again. Inspect process state before removing stale `process.json` after such an exit. No automatic disk deletion/reset exists.

For an Alpine guest, install the base OS in `sys` mode to its VM disk before installing a desktop. A live ISO root filesystem can be too small for desktop/browser packages. After booting the installed disk, run `runtime/guest/desktop-alpine.sh` **inside the guest** as root (transfer its text through the serial console or type its commands). This provisions Openbox, Firefox, Xorg/VESA, LightDM, ACPI shutdown handling, and a locked `operator` account with local graphical autologin. It does not install SSH or open host forwards. It requires outbound networking while fetching signed packages from the official Alpine repositories. Guest `setup-disk` erases its selected guest disk: select only the blank virtual disk created for this VM. Never run guest setup commands on the host.

## Local computer control

`runtime/console.py` provides screenshots (PPM or PNG, depending on QEMU build support) over QMP, keyboard input, and pointer movement/clicks through local VNC. Pipe text to its `type` action; a newline presses Enter. Input goes directly to the current guest focus and must be treated like typing at its keyboard. This is a basic transport, not a dashboard-connected agent execution service.

```text
python runtime/console.py screenshot runtime/state/screen.ppm
python runtime/console.py screenshot runtime/state/screen.png
python runtime/console.py pointer 300 200 --button left
```

Windows PowerShell example:

```powershell
'uname -a' | python runtime/console.py type
```

`status` verifies QMP identity and reports QEMU's state. `running` means a VM process is executing; it does not prove desktop, browser, or agent readiness. `stop` requests ACPI shutdown and waits up to 30 seconds. `stop --force` sends QEMU `quit`, which can lose guest disk writes. Stop never kills a host PID. A failed QMP connection is reported as unreachable, without assuming the process is stopped. Mutating commands use an exclusive state lock to avoid simultaneous lifecycle writes; after an interrupted CLI, inspect the PID recorded in `lifecycle.lock` before removing a stale lock.

## Isolation and network policy

There are no host directory mounts, shared clipboard, USB passthrough, raw host disks, privileged containers, or bridged adapters. The guest disk is a project-local qcow2 file. VNC, QMP, and the serial console listen only on loopback. These local control interfaces have no authentication: other processes/users with local socket access can control the guest. Protect the project state and use a dedicated host account when local users are untrusted; never port-forward these control interfaces publicly.

The default network is `none`. `init --network nat` deliberately enables QEMU user networking with outbound connectivity and no host port forwards. NAT is not an egress firewall: the guest may reach host/LAN services and Internet destinations, including host control surfaces that must be protected from untrusted guests. NAT was used only for trusted provisioning here; the current QA VM and image import default are offline. A future untrusted browsing deployment needs protected egress and explicit host-service isolation before enabling Internet access. The application must not treat this development VM as a hardened multi-tenant sandbox.

## Validation on 2026-11-22

The Windows host reported an existing hypervisor and HypervisorPlatform enabled, about 40 GiB available RAM, and 39 GiB available disk. CIM reported nested firmware virtualization/SLAT as false; nevertheless an actual QEMU WHPX launch succeeded, so those flags alone are not treated as a launch blocker.

Installed QEMU 11.1.0 from the Windows distributor linked by qemu.org into the ignored `runtime/vendor/qemu` directory, verifying the download against the distributor's SHA-512 checksum. Alpine Linux 3.24.4 virt x86_64 ISO was downloaded from the official Alpine CDN and verified against its SHA-256 file. Verified digest values and local launch evidence are in `runtime/validation.json`.

Created a real guest with WHPX, 2 vCPUs, 2048 MiB RAM, and a 12 GiB qcow2 disk. Installed Alpine to disk, detached the ISO, and verified kernel 6.18.64-0-virt with `/dev/vda2` as root. Provisioned Openbox, LightDM and Firefox160.0-r0; browser runs as locked non-root `operator`. Verified rendered HTML, mouse focus, mixed-case/punctuation keyboard input, native PNG frames, graceful ACPI stop (QEMU process exited), and automatic desktop/browser return after restart. Evidence screenshots are retained in ignored `runtime/state/browser-input-verified.png` and `desktop-after-restart.png`. All observed host TCP listeners were loopback. Networking was initially disabled and explicitly enabled as NAT for installing guest packages. The launcher still reports process readiness separately from guest readiness.

Two input bugs were caught against the actual guest: uppercase keysyms must retain their case with Shift, and QEMU requires the RFB SetEncodings step to initialize each new client's absolute pointer mode. Both are corrected in `console.py`. Printable US keyboard input is verified; Unicode/layout-specific input is untested. The launcher rejects implicit x86 hardware acceleration on ARM hosts, supports an optional valid persistent `instance_id` as QEMU firmware UUID, and supplies a built-in entropy backend through virtio-rng for new guest starts.

Run the meaningful launcher protocol/boundary checks with:

```text
python -m unittest discover -s runtime/tests -v
```

Launcher/console tests cover the explicit accelerator/no-sharing boundary, loopback VNC/QMP arguments, invalid VNC ports, ARM explicit-emulation requirement, persistent UUID, asynchronous QMP response matching, uppercase input regression, and pointer bounds. Additional image/dashboard tests are owned by their integration modules. No cross-platform boot certification is implied.

## Clean base review

The review base was built from the verified official Alpine ISO in this session. No customer files, provider credentials, API tokens, host credentials, or account bindings were supplied to the guest. The only browser tests used local HTML data URLs. `guest/clean-base-alpine.sh` stops graphical/user processes, removes both legacy and XDG Firefox profiles/cache, histories and provisioning logs, locks root, resets IDs/seeds, and zeros free filesystem blocks. Its missing-ID service test generated a new valid machine ID; OpenRC enables that service before D-Bus/LightDM, with seedrng on boot. New QEMU starts provide virtio entropy.

A live root shell recreated a 531-byte history file after cleanup. The final review therefore booted the verified rescue ISO with networking disabled, mounted the installed disk offline, overwrote and removed that history, and checked the filesystem again. Only the intended Openbox autostart and `.xsession` files remained under root/operator homes; machine IDs, random seed, SSH service, browser profiles, history and credential/token-named home files were absent. Root/operator password fields were locked. The installed filesystem was synced/unmounted and the rescue guest powered off before export. This is an operator review of a newly built guest, not an automated guarantee that arbitrary personal images are sanitized.

The base uses upstream Alpine packages. Observed primary package license metadata: Linux `GPL-2.0-only`, Openbox `GPL-2.0-or-later`, Firefox `GPL-3.0-only AND LGPL-2.1-only AND LGPL-3.0-only AND MPL-2.0`. Preserve applicable package/source/redistribution notices when preparing a public release. The review export is local; no public distribution was performed. See `vm-image.md` for the separate stopped-image export/import mechanism and its explicit operator attestation.

The completed review export is in the sibling `starlidigital-vm-review` directory: `starlidigital-base.qcow2`, its SHA256 file, and `manifest.json`. The image is 374,865,920 bytes (357.5 MiB), SHA256 `63775aad7830b5a4e9a866d8964d64d439dffd6f6029671af7eb920eb6303a86`. The exporter checked image consistency and verified the source disk remained unchanged. The original mutable guest was then restarted offline: boot logs confirmed fresh seed and machine-ID generation before D-Bus, and the operator terminal confirmed `/etc/machine-id` exists. Locked operator graphical autologin and Firefox returned successfully. Live corrected dashboard-adapter text and pointer delivery also passed. Authenticated dashboard end-to-end QA is handled separately. All 31 combined runtime/image/bridge tests passed on this Windows host.

## Upstream references

Technology and arguments were checked against current official [QEMU accelerator documentation](https://www.qemu.org/docs/master/system/introduction.html), [QEMU invocation reference](https://www.qemu.org/docs/master/system/invocation.html), and [QEMU downloads](https://www.qemu.org/download/). Guest desktop provisioning follows Alpine's [setup-desktop source](https://github.com/alpinelinux/alpine-conf/blob/master/setup-desktop.in). Checksums fetched over HTTPS establish download integrity against the publisher's adjacent digest, not independent signature verification.
