# New product packaging contract

The current product is product/ plus product-backend/. Manifest identity alone does not establish UI identity: the pinned v12 Svelte frontend retains the upstream package name open-webui0.6.5. Selection must match reviewed source pins and the actual bots/teams/Boss preview.

## Build and runtime

- Frontend: Node22, product/package-lock.json, npm ci and original plain npm run build. The build helper enables the actual Boss-intake and guest-wire flags from product/.env.example. It does not invoke the superseded dashboard frontend or Pyodide preparation.
- Native runtime: product-backend/local_server.py, runtime-contract.json, LOCAL-NATIVE-PINS.json and recovered candidate source. Current core composition uses dashboard/backend as its native Python foundation. Python3.11 and the reviewed per-host hash locks are required. Provider bridge tooling uses Node24 and locked platform/runtime SDK dependencies.
- Runtime resource closure: dashboard/package.json and CHANGELOG.md are read by native imports. Preserve these plus dashboard/LICENSE. This is native metadata, not an old UI build. dashboard/src, dashboard/static and its npm lock/dependency tree are excluded from distribution.
- product/LICENSE.upstream is required. Preserve all upstream and third-party notices. Private configs, profiles, state/databases and credentials never enter source packages.

```text
python packaging/build_component.py product
python packaging/product_backend_smoke.py --install --output work/product-backend-result.json
```

The backend command installs the exact host's hash lock in a separate ignored environment, runs the actual source-owned core API tests with disposable state, and writes only sanitized current-attempt evidence. Dependency failures, missing/failed child reports and API failures exit nonzero. Logs/state are never workflow upload paths.

## CI and actual evidence

validate.yml builds platform infrastructure and the ACTUAL product frontend separately on Windows/macOS/Linux with Node24/22 respectively. product-backend.yml uses fresh checkout, Python3.11, pinned uv0.11.19, reviewed host hash lock, locked Node bridge/SDK prerequisites and actual new-product core ASGI checks on all3hosts. Only sanitized result JSON is uploaded. These revised jobs still require hosted execution at their final commit; historical old-UI/infra green checks do not certify them.

Local isolated snapshot core test passed12checks: actual native signin, company/directory, two installed/admitted bots, bounded team session/readback, unauthenticated denial, guest intent/workspace/readback, and truthful unconfigured inference/worker failures. No model calls or external actions. The snapshot omitted the superseded frontend and exposed/fixed the required native metadata packaging dependency. Parent coordinates the independent fresh-Git installation proof. Frontend owner retains final production-build responsibility.

## Release remains blocked

release-gate.json is deliberately disabled: preview_confirmed, runtime_contract_confirmed and release_enabled are false; joined release pins are not asserted. Source archives read the REVIEWED INDEX gate and require explicit frontend paths, runtime inputs and joined pin hash. A successful frontend build or core test cannot flip these flags.

Full joined model/worker/preview execution is not configured in the current runtime contract. The core check reports this honestly; a503 is not treated as completed inference. Confirmed product preview, fresh-Git installation, complete selected runtime/source closure and other release checks must be resolved by integration owners before a release is enabled.
