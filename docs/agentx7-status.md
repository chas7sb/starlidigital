# AgentX 7 — configuration and dashboard portability

Completed seven safe config templates, source names inventory, original dashboard dependency inventory and BYO integration documentation. Subsequently authorized dashboard/backend portability patch is complete; config/portability-changes.json lists every affected source/test file.

Central backend/starli_portable.py resolves local config/data/platform/runtime/workspace paths, PATH executables and explicit service/public origins. Active production /srv,/opt,/etc and /var fallbacks were replaced; callback/origin checks follow the configured deployment while preserving authentication, strict allowlists, cookie security and broker verification. Shared Node database defaults to platform/server/data/starli.sqlite. Optional providers still require BYO config; absent broker files remain unavailable.

Validation passed: 8 isolated unittest cases and complete backend Python compilation. No live service/provider/OAuth/VM tests. No production writes, service operations, publication or ledger edits. No platform/ changes. Historical snapshots, tests and QA stage roots intentionally unchanged. Existing old-production-IP SSRF deny rules and POSIX broker trust checks preserved.

Integration constraints for Prime/AgentX2: keep backend/starli_portable.py in the backend Python import path; preserve local patches if re-extracting source. Installer must supply origins for its topology; first-party MCP execution uses the server-configured internal control-plane origin; its public resource URL is separate. runtime/vendor reviewed network bundles and Python/Node package dependencies must be supplied by runtime/source owners. Original config/dashboard-dependencies.json is pre-patch evidence, not a remaining-blocker list.

## Integration update: internal services

Implemented service_origin() for explicit operator HTTP(S) origins, including Compose DNS/private IP endpoints, with no credentials/path/query/fragment and strict host/port syntax checks. Public/callback origin validation stays HTTPS-or-loopback. platform_url/company_platform_url/control_plane_url use internal validation; separate platform_public_url/control_plane_public_url retain strict public validation. MCP public resource and transport URLs are now distinct; OAuth back-channel/API requests use internal addresses while authorization URLs retain public issuer addresses.

Defaults aligned to port4100 and platform/server/data/starli.sqlite. Tests now 8/8; complete backend compilation passes. Config templates and docs updated.

AgentX5 contract: Compose dashboard+task-worker should supply STARLI_PLATFORM_ORIGIN=http://platform:4100, STARLI_CONTROL_PLANE_ORIGIN=http://control-plane:4120, STARLI_COMPANY_PLATFORM_ORIGIN=http://platform:4100; public origins remain browser-reachable localhost/HTTPS URLs. Mount platform-data at e.g. /platform-data read-only and set STARLI_SOURCE_DATABASE=/platform-data/starli.sqlite. Backend ownership does not include installer edits, so those environment/mount entries are pending AgentX5 integration. Native source DB default matches installer/native.mjs. Native/custom published ports should supply matching public-origin settings.
