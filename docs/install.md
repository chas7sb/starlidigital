# Install the new StarliDigital product

The default installer targets product/: the recovered bots/teams/Boss frontend, joined to product-backend/local_server.py. dashboard/backend is a Python foundation dependency; its legacy frontend is not installed or served by this flow.

Install Node 24+ with npm and uv. Internet access is needed for dependency downloads. From the repository root:

On Windows, use a short checkout path or clone with Git's per-command long-path setting (`git -c core.longpaths=true clone REPOSITORY_URL C:\src\starlidigital`). The retained vendored source includes filenames that can exceed Windows Git's default path limit under a deeply nested checkout. No global Git or system setting is changed by the installer.

```text
node installer/starli.mjs install
node installer/starli.mjs setup
node installer/starli.mjs start
```

The root starlidigital command uses the same entrypoint. --native is optional. PowerShell: ./installer/starli.ps1 install (then setup/start). POSIX: sh installer/starli.sh install. Native services stay in the foreground; Ctrl+C stops only their owned process trees.

install obtains an official Node 22 distribution when needed and verifies its SHA256 over HTTPS, creates an isolated Python 3.11 environment, validates and installs the reviewed host-specific Python hash lock, runs npm ci in product/, and builds that actual frontend. Set STARLI_NODE22 to an existing official Node 22 executable to skip the download. Frontend installs skip CUDA/Cypress downloads and builds default to a 6 GB Node heap. Installation does not create a user or configure a model provider.

setup prompts privately for a local owner email, name and password through the actual new backend init command. Passwords are not command-line arguments or saved in installer config. It creates fresh private state under work/product-local and writes paths/ports only to ignored installer/.runtime/product.json. Existing owner/configuration is preserved; setup does not reset an installation. Failed init can leave partial fresh state: inspect it rather than silently deleting it.

start launches only the new backend and product Vite preview on loopback. Defaults: frontend http://127.0.0.1:5186 and backend http://127.0.0.1:8080. The frontend proxies local API/WebSocket paths to that backend. Both ports must be free. For a distinct installation, set STARLI_PRODUCT_FRONTEND_PORT, STARLI_PRODUCT_BACKEND_PORT and optionally STARLI_PRODUCT_STATE before initial setup. STARLI_PRODUCT_INSTANCE selects a named configuration and private work state without changing the default installation; use the same instance name for setup/start/health. State must remain inside this checkout's work/ directory; stored settings are reused on restart.

Readiness requires the backend's exact NEW_COMPANY_NATIVE_CANDIDATE identity with native authentication, messaging and guest-claim capabilities, a matching health response through the frontend proxy, and HTML responses for / and /app. A process launch or static page alone is not readiness. Provider/model/worker configuration is reported separately from these core checks; unconfigured execution must fail closed. The current foundation does not establish full autonomous-model, generated-preview or production parity.

```text
node installer/starli.mjs doctor
node installer/starli.mjs health
node installer/starli.mjs build
```

doctor checks source contract, runtime imports, built product assets and whether owner setup exists. health checks the running configured installation. Commands accept --dry-run to inspect the plan; setup and start require the actual backend contract when executed.

Python locks cover Windows x64, Linux x64 and macOS x64/ARM64. Resolution on another platform is not installation validation. See current docs/agentx5-status.md and backend runtime-contract.json for actual local results and unsupported capabilities. The retained advanced installer/native.mjs manages historical component/video/VM integration prerequisites; it is not the default product frontend.

Docker must be requested explicitly with --docker. Existing Compose definitions describe prior infrastructure and are not yet adapted/accepted for the corrected product; Docker install/setup/start are blocked rather than substituting the old UI. No installer command publishes a release or creates a computer-use VM. The separate runtime/ lifecycle remains available under its own contract.
