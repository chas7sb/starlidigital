# Enterprise Apps and Projects handoff — 15 November 2026

Files: CompanyApps.svelte, CompanyProjects.svelte, company-services.ts. No route edits, backend changes or old Open WebUI panel mounts in this lane. Root owns assembly.

Both components require companyId:string, actorId:string, accessSignal:AbortSignal. Key by active company/actor. Company authority uses actual parseNativeAuthority and native token; parent abort, storage-session changes, company/actor replacement, and unmount cancel pending work and clear records/secret fields. Never pass a privileged operator token. Confirmed company denial emits denied {status}; resource/service absence stays an honest local error rather than being treated as lost company membership.

CompanyApps events:
- tool {toolName,title,approvalAvailable}: seed/request normal tool use in the current chat with fresh runtime grants. Does not invoke tools directly or claim a grant.
- resource {type,kinds}: browse actual registered company resources in the new shell/pane; do not open a fake resource without an ID/authorization.
- denied {status}: parent runs its normal session/company revalidation.

Apps has three consolidated sections: company resource types from authenticated /api/v1/panels/manifests; account-grant tool catalog from /api/v1/starli/tools/catalog; explicitly account-scoped Custom MCP. All 69 actual catalog tools can be searched. MCP supports real create/update/test/discover/enable/disable/remove through existing reviewed native port with expectedRevision, secret clearing, explicit removal confirmation and no automatic retries. Account MCP is not presented as company-owned or automatically attached to shared company bots. Server capabilities currently report both remote transports false, so tests/discovery/enabling are visibly unavailable; saved settings are not represented as working tool execution. Parent tool selection must retain normal chat authorization and approvals.

CompanyProjects events:
- open/created {scope:'company',ownerId,kind:'project',id}: open the canonical company project snapshot in the new contextual pane. Creation does not imply a generated website/deployment.
- denied {status}.

Projects uses only GET /api/v1/companies/{company}/drive?kind=project&recent=1, validating starli.company-drive.v2 and every row's company/kind/version. Up to 200 accessible rows. It never falls back to personal customer/projects or /starli/resources. Creation uses POST /drive/items {title,kind:'project',body} only after actual files.manage. Backend has no create idempotency contract; UI does not retry, blocks uncertain outcomes until a successful list check, and warns to review existing records. No build/deploy controls are fabricated.

Evidence:
- Both new components compile with zero warnings.
- verify-services.cjs: 12 executed tests with controlled native-contract responses pass (company isolation, permission gate, one POST/uncertainty, token/parent cancellation including late JSON, exact account MCP CAS and credential preservation, no conflict retry, catalog dedupe).
- apps-projects-live-receipt.json: native signin200/company200; authority200 exact actor/company/files.manage; Drive200 exact contract, currently0company projects; manifests200 six company resource types; catalog200 69tools with execution flags; MCP capabilities/list200, zero connections, transports unavailable. Dedicated test session signout200; test bearer subsequently rejected401.
- No project/server mutation, model call, arbitrary remote probe or unrelated-session revocation in live acceptance. Initial15second signin timeout was reported before the later successful bounded attempt. No secrets in receipt.

Design references inspected: Desktop/SVG/03-15-projects-overview.svg, 03-17-apps-and-company-resources.svg, 04-23-integrations-directory.svg. New cards use #3466F6/#17243F/#F6F8FC/#E6EBF4, restrained outline icons, responsive compact grids. Example artboard records/statuses were not copied into live data.
