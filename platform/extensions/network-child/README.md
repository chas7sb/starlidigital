# Network child boundary for a Linux guest

Extracted read-only from /opt/starlidigital/network-child/releases/v1 on 2026-11-22.
PROVENANCE.json records SHA256 of all 15 transferred source/config/test files. Each
matched the server-side SHA256 before local changes. No profiles.json, activation
state, credentials, cache, or production working state was copied. No LICENSE was
found at this release; redistribution permission must be resolved separately.

## Local portability changes

- Removed the production public IP from network.nft. The installer now denies every
  guest global IPv4 interface address, with no production-specific exception.
- Updated the protocol fixture to derive its fixed command from client.PROFILES;
  the deployed fixture still used an older gateway path.
- Added empty activation and illustrative profiles templates, read-only guest
  preflight, and exact-byte review bundle generation. Profiles templates are
  documentation: do not activate them or use empty pins as a valid boundary.

The fixed /opt paths, UID997/GID988, socket peer check, clean environment, cgroup,
Landlock and seccomp rules remain enforced. Portability is achieved by a matching
Linux guest filesystem and identity layout, not by relaxing these checks.
The x86_64-specific seccomp policy cannot run unchanged on an ARM guest.

## Dependency closure

Python files use the standard library only. Guest prerequisites: Python >=3.11,
Linux x86_64 with Landlock ABI >=4, cgroup v2 cpu/memory/pids controllers enabled,
systemd, nftables with socket cgroupv2 matching, iproute2, glibc loader at the fixed
path, systemd-resolved stub at 127.0.0.53 and its fixed resolver file.

build_manifest.py also requires immutable source/runtime packages:

| Profile | Required path |
|---|---|
| Search | /usr/bin/node; /opt/starlidigital/search-gateway/releases/research-v2-r1/gateway/research-cli-v2.mjs |
| Account MCP | /opt/starlidigital/account-mcp-node/releases/node-v24.19.0/bin/node; /opt/starlidigital/account-mcp/releases/profile-v1/remote/service.mjs |
| MCP SDK tree | /opt/starlidigital/account-mcp-sdk/releases/sdk-1.32.2 |

These packages are outside this assigned extraction directory and are not bundled
here. Guest startup must fail closed until they are supplied and source-pinned.
Search additionally needs SearXNG on guest localhost:8888; outbound profiles permit
DNS to the local stub and public IPv4 HTTPS:443. MCP does not permit localhost:8888.
All relevant files/ancestors must be root-owned and not group/world writable.

The separate company computer production-broker.mjs imports company-note-jobs.mjs
and native-authority.mjs, and resolves graphql-yoga/graphql through the platform
root package. It defaults native API to localhost:8190. This company broker is
not the network-child broker and is being extracted by the other extension owner.
Its document/job authority and guest command transport require their own wiring.

## Guest integration

1. Provision an isolated x86_64 Linux VM with systemd, a compatible kernel, no
   host home/credential mounts, and a dedicated application UID997/GID988. Refuse
   existing conflicting identities. Run the trusted native client under UID997.
2. Install the pinned gateway/account-MCP/SDK packages at the paths above. Use a
   trusted operator provisioning step, never model-selected executable paths.
3. Run python3 guest-preflight.py inside the guest. This only reports prerequisites;
   a pass is not proof of isolation or protocol correctness.
4. On the host, run python prepare-review.py NEW_DIRECTORY. Preserve its printed
   FILES.json SHA256 outside the bundle. Transfer only the flat bundle into a new
   root-owned private /var/lib/starli-network-child-review/PIN directory in the VM.
5. Review source and guest policy, then invoke install_reviewed.py EXPECTED_SHA
   ABSOLUTE_PRIVATE_STAGE as guest root. The installer changes guest cgroups,
   nftables, and systemd only; it refuses an existing release/table. Installation
   leaves activation.json profiles empty. Do not run it on the production server.
6. Run the transferred pin/protocol tests as UID997 in the guest, then actual
   kernel positive/negative, forbidden filesystem/network/process, limits,
   disconnect and physical Stop tests. Only after those pass should an operator
   enable validated profiles in root-owned activation.json.
7. Keep the Unix socket inside the guest. Run the trusted native adapter in the
   same VM or use a narrow authenticated host-to-guest RPC that preserves exact
   fixed profile IDs and private stop handles. Do not expose the root socket as a
   general command or TCP launcher. Preserve scope authorization and stop receipts.

The imported client currently validates a different MCP Node path from the
worker's pinned MCP Node binary. It is a caller-side command label only (the
broker launches the fixed worker), but integration must reconcile the native
caller's exact argv with client.PROFILES before claiming MCP parity.

Windows/macOS launchers should manage this Linux VM and its lifecycle. A container
or Windows process is not evidence that the kernel boundary passed. Native ARM
guest support requires a separately reviewed seccomp/loader policy.

## Verification limits

Original transfer hashes were checked. Local syntax/template/bundle checks do not
prove Linux isolation. The original test suite depends on Unix sockets,
SO_PEERCRED/UID997 and Linux O_NOFOLLOW; it must run inside the matching guest.
No production services or source were modified.
