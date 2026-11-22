# Install the single-company StarliDigital workspace

The native installer serves product/ with product-backend/local_server.py. Each installation has one company. The first browser visit creates its administrator and company; later visits show the workspace or sign-in. Public registration and guest/provisional company creation are not part of this self-host flow.

Install Node 24+ with npm and uv, then run from the repository root:

```text
node installer/starli.mjs install
node installer/starli.mjs start
```

Open the printed loopback URL (default http://127.0.0.1:5186). If the backend reports setupRequired=true, enter your administrator email, display name, password and company name in the first-run form. No default account/password is created. Initial setup is accepted once; competing/replayed setup attempts must fail409. Sign in with the account you created. After initialization there is no registration or company-create/switch flow.

start accepts a fresh private uninitialized instance. It creates only paths/ports metadata and lets the backend initialize its private state and browser setup policy. It never creates an implicit administrator. Existing instance configuration, state, session keys and credentials are preserved. Restart the same checkout/instance to reuse them; no reset is performed.

The optional privileged CLI alternative is node installer/starli.mjs setup while the services are stopped. It invokes installer/first-run-cli.py, which calls the same canonical backend atomic setup transaction and refuses an existing administrator before prompting. The retired local_server.py init command is not used. CLI setup is not required before start.

The root starlidigital command and PowerShell/POSIX wrappers use the same entrypoint. --native is optional. Ctrl+C stops only the owned foreground process trees. On Windows, use a short checkout path or per-command git -c core.longpaths=true clone to avoid deep vendored filenames exceeding Git's default path limit.

install downloads official Node 22 when needed and verifies SHA256. Windows extraction uses absolute System32 tar.exe, independent of PowerShell modules. A cached archive is reused only after checksum and regular-file verification; corrupt/linked archives are preserved and rejected. Set STARLI_NODE22 to a preinstalled official Node 22 executable to skip bootstrap. Python 3.11 dependencies use reviewed host hash locks. Frontend installation skips CUDA/Cypress downloads and defaults to a 6 GB Node heap. No legacy frontend is installed or served.

Configuration is ignored installer/.runtime/product.json and private state is under work/product-local. Metadata contains paths/ports only, never passwords. STARLI_PRODUCT_INSTANCE selects a separate named configuration/state; use that same name for start/setup/health. Set STARLI_PRODUCT_FRONTEND_PORT, STARLI_PRODUCT_BACKEND_PORT and optional STARLI_PRODUCT_STATE before the first start. Stored settings win on subsequent starts. State must stay inside this checkout's work/ directory. Concurrent starts cannot overwrite the first metadata file.

Readiness checks backend identity, native auth/messaging, frontend proxy, root/app HTML and authoritative GET/api/v1/setup/status on both sides of the proxy. Required status is {setupRequired:boolean,singleCompany:true,registrationAllowed:false}; missing status,401 or missing browser token is never treated as permission to create an administrator. Health reports setup_required until the server confirms initialization. Provider/model/worker status is reported separately and is not inferred from successful account setup.

```text
node installer/starli.mjs doctor
node installer/starli.mjs health
node installer/starli.mjs build
```

doctor checks source/dependencies/build and instance metadata. health checks a running installation. --dry-run prints a plan without initializing state. First-run HTTP/race integration acceptance is tracked separately from earlier b934 install/restart evidence in docs/agentx5-status.md; that older proof does not establish the new browser-first policy.

Python locks cover Windows x64, Linux x64 and macOS x64/ARM64. Docker remains explicit --docker and blocked for the unadapted historical stack. Advanced native.mjs dashboard/all commands are retired; Node bootstrap and explicit platform/video infrastructure helpers remain. No installer command publishes a release, resets user data, configures a provider key or creates a computer VM.
