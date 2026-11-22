# AgentX 4 — isolated VM runtime

Status: runtime work complete; original VM is running and READY for AgentX10 authenticated dashboard status/frame QA. PID 185432, WHPX, 2 vCPUs, 2048 MiB RAM, 12 GiB disk, VNC 127.0.0.1:5901. Networking is deliberately NONE. Do not restart/stop during concurrent QA without coordinating. No further guest control planned by AgentX4.

Implemented in owned files: standard-library Python doctor/init/start/status/stop; exclusive lifecycle lock; identity-checked QMP; loopback VNC/serial; no host shares/clipboard/passthrough/raw host disks; default no guest NIC; explicit WHPX/KVM/HVF and explicit TCG; clear ARM hardware rejection; optional firmware UUID; built-in entropy via virtio-rng. console.py supports PNG/PPM, mouse move/click, and tested mixed-case/punctuation typing. Guest desktop and clean-base scripts included.

Actual Windows verification: installed checksum-verified QEMU 11.1.0 into ignored runtime/vendor/qemu; verified Alpine 3.24.4 ISO. WHPX launch succeeded despite negative CIM nested CPU flags. Installed Alpine onto /dev/vda2 and detached ISO; persistent kernel 6.18.64-0-virt. Openbox, LightDM and Firefox 160 run as locked non-root operator. Rendered HTML, pointer focus and keyboard text passed. Graceful ACPI stop exited QEMU; desktop/browser returned after restart. All host TCP listeners are loopback.

Clean base EXPORT COMPLETE at:
C:/Users/Administrator/Documents/Codex/2026-11-22/ii/outputs/starlidigital-vm-review

Contains exactly image, manifest and checksum. starlidigital-base.qcow2 is 374,865,920 bytes (357.5 MiB), virtual size 12 GiB. SHA256:
63775aad7830b5a4e9a866d8964d64d439dffd6f6029671af7eb920eb6303a86

Clean review: fresh guest never received provider credentials, customer files, host tokens or account bindings. Removed browser profiles (including XDG path), caches, root/operator histories and provisioning logs. Root and operator locked; no SSH service or guest listeners. IDs/seed reset with OpenRC first-boot generation enabled. Zeroed guest free blocks. A live shell recreated a 531-byte history file; final rescue-ISO OFFLINE audit overwrote/removed it and rechecked homes, IDs, seeds, credential/token-named files, and locked accounts before unmount/poweroff/export. Only intended operator autostart and .xsession files remained in homes. Export checked standalone consistency and unchanged source; checksum independently matched afterward. This is manual operator review, not a tool guarantee of arbitrary guest sanitization. Nothing published externally.

Original guest restarted after export: actual boot log confirmed fresh seed and machine identity before D-Bus; operator terminal verified machine-id exists. Locked-account graphical autologin and Firefox returned. Export remains immutable and clean; original working guest now has new local first-boot state. Evidence in ignored runtime/state/: browser-input-verified.png, desktop-after-restart.png, firstboot-id-verified.png, qa-ready.png, clean-base-offline-audit.log.

Bridge coordination: its owner applied both actual-guest fixes from console.py (keep uppercase keysym case with Shift; send SetEncodings after ServerInit for absolute pointer mode). Corrected dashboard_adapter text, Enter and pointer delivered to real guest. Authenticated dashboard end-to-end tests remain AgentX10's scope. Adapter/route/image files were not edited by AgentX4.

Tests: all 31 combined runtime/image/bridge tests passed on Windows. WHPX fixture explicitly mocks x86_64 so correct ARM production rejection does not break hosted ARM tests. No macOS/Linux boot certification: x86 guest on ARM requires explicit TCG; native ARM guest is not implemented.

Remaining release limitations: protected Internet egress is not implemented. Unrestricted QEMU NAT can reach host/LAN control surfaces, so NAT was temporary trusted provisioning only; current VM and import default are offline. Public redistribution/source notices for upstream packages still need release review. See docs/runtime.md, docs/vm-image.md and runtime/validation.json. Packaging must exclude runtime/state and runtime/vendor; distribute the reviewed base separately through image.py import with its trusted digest.
