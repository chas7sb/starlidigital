# Dashboard extraction

Source: `/srv/starlidigital/webui-current` resolved to `/srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119`, inspected and transferred on 2026-11-22 over private SSH after the active package manifest matched the approved StarliDigital source tools.

The existing Svelte routes, Starli panels, Python API, workspace composition entry point, delegated task worker, company provider modules and search gateway are retained. No marketing route was identified in this application, so no route was removed.

## Source verification

- `EXTRACTION-MANIFEST.json`: 4,373 frontend, configuration and static asset files.
- `BACKEND-EXTRACTION-MANIFEST.json`: 585 backend and search gateway files.
- `BACKEND-SUPPLEMENT-EXTRACTION-MANIFEST.json`: 17 provider/runtime `.mts` modules, static metadata, empty CSV import template, migration README and ignore files.

Every transferred source file passed SHA-256 and byte-count verification against its archive manifest before extraction. Manifests describe original upstream bytes; subsequent portability changes legitimately differ. The frontend manifest's backend exclusion refers only to that first archive; backend source was included in the separate archives above.

Excluded: live data, databases, customer uploads, logs, credentials, dependency installations, Python caches, generated application builds and generated `static/pyodide` cache. The existing `scripts/prepare-pyodide.js` regenerates that dependency cache during build.

The original `LICENSE` remains unchanged. It contains Timothy Jaeryang Baek's 2023–2025 copyright, three redistribution conditions and disclaimer. Preserve it and review third-party static asset notices before redistribution.

## Local portability changes

- Intelligence uses same-origin `/graphql` by default. `VITE_STARLI_INTELLIGENCE_ENDPOINT` can explicitly select an HTTPS endpoint or HTTP endpoint between local loopback hosts. URL credentials, query strings, fragments and non-GraphQL paths are rejected.
- Social authorization requires the app's origin by default. `VITE_STARLI_SOCIAL_AUTH_ORIGIN` explicitly selects a separate authorization-service origin.

All other feature source remains available. Backend configuration portability is handled separately by the configuration owner.

## Validation and limits

513 Python files parsed without syntax errors. Nine focused endpoint-resolution assertions passed. Basic credential-pattern inspection found only an intentionally fake key in a test fixture; this is not a comprehensive privacy/security audit.

Frontend package requires Node 18.13 through 22; the Node platform separately requires a newer version. Dependency installation and Node22 frontend build are coordinated by the packaging owner. Existing generic backend start scripts target `open_webui.main:app`; full product composition uses `workspace_entry:app`, and the task worker is `python -m open_webui.starli_task_worker` with `STARLI_EXTERNAL_WORKER=1`. Portable launcher owners must use the full composition and preserve worker boundaries.

Fresh installation, authenticated feature parity, external integrations, cross-platform runtime and computer-use VM validation are still required. Source extraction alone does not certify those outcomes.
