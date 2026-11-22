# Isolated Linux computer runtime

The runtime uses QEMU system virtualization, not a privileged container. The Python 3.10+ launcher has no third-party Python dependencies. It selects WHPX on Windows, KVM on Linux, and HVF on Intel macOS. Hardware acceleration never silently falls back. `--accel tcg` explicitly selects QEMU software emulation and is slower; this is also the current x86 guest route on Apple Silicon. An accelerated native ARM guest is not implemented.

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

On Windows use a full Windows ISO path. If WHPX is unavailable, fix the host prerequisite or deliberately initialize with `--accel tcg`. On Linux, `/dev/kvm` must be accessible to the current user. On Intel macOS use HVF; on Apple Silicon use `--accel tcg` for this x86-only implementation. Linux and macOS execution have not been tested in this Windows session.

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

The default network is `none`. `init --network nat` deliberately enables QEMU user networking with outbound connectivity and no host port forwards. NAT is not an egress firewall: the guest may reach host/LAN services and Internet destinations. A future untrusted browsing production deployment needs an explicit network allowlist/proxy and policy enforcement. The application must not treat this development VM as a hardened multi-tenant sandbox.

## Validation on 2026-11-22

The Windows host reported an existing hypervisor and HypervisorPlatform enabled, about 40 GiB available RAM, and 39 GiB available disk. CIM reported nested firmware virtualization/SLAT as false; nevertheless an actual QEMU WHPX launch succeeded, so those flags alone are not treated as a launch blocker.

Installed QEMU 11.1.0 from the Windows distributor linked by qemu.org into the ignored `runtime/vendor/qemu` directory, verifying the download against the distributor's SHA-512 checksum. Alpine Linux 3.24.4 virt x86_64 ISO was downloaded from the official Alpine CDN and verified against its SHA-256 file. Verified digest values and local launch evidence are in `runtime/validation.json`.

Created a real guest with WHPX, 2 vCPUs, 2048 MiB RAM, and a 12 GiB qcow2 disk. Verified Linux 6.18.60-0-virt boot to login, QMP status/identity, VNC screenshots and keyboard input. Forced stop/start was exercised before installing any guest data. All observed listening sockets were loopback. Networking was initially disabled and explicitly enabled as NAT for installing guest desktop packages. Desktop installation and persistent-disk boot are still being validated; do not advertise full browser-agent readiness from the process status.

Run the meaningful launcher protocol/boundary checks with:

```text
python -m unittest discover -s runtime/tests -v
```

Current tests cover the explicit accelerator/no-sharing boundary, loopback VNC/QMP arguments, invalid VNC ports, and QMP response matching in the presence of asynchronous events. No cross-platform boot certification is implied.

## Upstream references

Technology and arguments were checked against current official [QEMU accelerator documentation](https://www.qemu.org/docs/master/system/introduction.html), [QEMU invocation reference](https://www.qemu.org/docs/master/system/invocation.html), and [QEMU downloads](https://www.qemu.org/download/). Guest desktop provisioning follows Alpine's [setup-desktop source](https://github.com/alpinelinux/alpine-conf/blob/master/setup-desktop.in). Checksums fetched over HTTPS establish download integrity against the publisher's adjacent digest, not independent signature verification.
