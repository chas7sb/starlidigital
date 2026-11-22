# Native fresh-owner API validation

The manual **Native fresh-owner API boot** workflow runs on Windows 2025,
Ubuntu 24.04, and macOS 15. It installs Node 24 platform/provider dependencies
from their lockfiles and the actual Python 3.11 backend from the reviewed,
platform-specific hash lock. No production credentials or data are supplied.

The harness uses the real trusted first-owner setup, real database migrations,
Node API, Python dashboard API, sign-in, explicit private administrator binding,
company membership checks, installed provider catalog, and scoped tool catalog.
The synthetic password is generated privately and passed only through the
private test fixture and actual login request. It never enters CLI arguments,
result artifacts, or printed logs. The public setup helper remains interactive.

VM boot/control, frontend rendering, provider authentication/inference, external
email/social operations, payments, and full feature parity are explicitly
outside this test. A passing workflow means the listed native API boundaries
were exercised on its exact host; it does not certify every integration.

Run locally after installing platform and provider npm dependencies:

```text
python packaging/native_boot_smoke.py --install
```

Or reuse an already installed dashboard Python 3.11 without modifying it:

```text
installer/.runtime/python/Scripts/python.exe packaging/native_boot_smoke.py --run
```

On macOS/Linux use `installer/.runtime/python/bin/python`. Default ports
18480/18481 are distinct from the retained development QA instance. Occupied
ports are refused; no existing service is stopped. Override them using explicit
`--dashboard-port` and `--platform-port` values when needed.

Only `work/native-boot-result.json` is uploaded by CI. Private disposable state,
credentials, database files and raw service/bootstrap logs remain in ignored
`work/native-boot-*` directories and are never uploaded. The harness stops its
own process trees and deliberately leaves private diagnostics for inspection.

Parent integration must commit these files and dispatch:

```text
gh workflow run native-boot.yml --repo chas7sb/starlidigital --ref main
```

This document does not assert a hosted run has passed. Consult the workflow's
actual result and artifact for each host.

Local validation on 2026-11-22: the actual Windows x64 run passed all eight
checks with Python 3.11.9, 42 installed providers and 69 scoped tools. Both API
process trees were stopped after validation. This reused the already installed
dashboard environment; the workflow's fresh hash-lock installation still needs
its own hosted execution.
