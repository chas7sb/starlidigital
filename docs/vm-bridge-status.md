# Local VM dashboard console

Implemented a separate installation-owner console at /setup using the existing dashboard styles. This does not grant company-computer membership or bypass agent enrollment. The existing company computer and browser surfaces remain unchanged.

## Authorization and boundary

Every API request goes through the existing verified session dependency and starli_platform.principal, checking dashboard admin role, explicit private membership binding and current Node ADMIN role. A Bearer token is required; foreign Origin requests are denied. The console is off unless STARLI_LOCAL_VM_ENABLED=1 is explicitly set for the Python dashboard process. This flag does not create or configure a VM.

Routes mounted in open_webui/main.py under /api/v1/starli/local-vm:
- GET /status and GET /frame
- POST /start and POST /stop (graceful shutdown only)
- POST /input with bounded pointer, named-key or printable-ASCII text payload

The fixed runtime/dashboard_adapter.py imports the checked-in VM implementation beside itself. It accepts no executable, address, port, filesystem path, shell command or arbitrary QMP command from requests. Operations serialize and are rate limited. QMP validates the tracked guest UUID before capture/input; VNC stays loopback. Lifecycle uses the same exclusive lock as vm.py; start only accepts the fixed local guest disk and a local-state ISO. No forced stop, reset, file transfer, host shares or clipboard endpoint exists. Images are no-store PNG responses and browser blob URLs are revoked on account change/unmount. Text is not stored by this bridge.

## Validation

- Seven adapter tests passed: fixed frame target/rate limit, tracking identity rejection and canonical UUID acceptance, disk containment, lock preservation, bounded input and graceful stop.
- Six real FastAPI tests passed: missing Bearer, foreign Origin, unbound/revoked admin denial, disabled console, strict body/arbitrary-action rejection, no-store frame and sanitized errors. Session verification is injected at its dependency boundary; private binding and SQLite role checks use the real principal.
- Actual local tracked VM status returned running with WHPX, and its QMP capture returned a PNG (4,287 bytes at observation). This only establishes a real VM frame, not desktop/browser readiness.
- Backend files compile under Python. Live guest input/start/stop were not issued by this bridge while AgentX4 provisions the guest. AgentX4 owns desktop readiness and persistence evidence.
- Frontend build and live authenticated HTTP checks require integration owners. AgentX9 must include LocalComputer.svelte plus updated SetupPanel.svelte. AgentX5/10 should explicitly supply STARLI_LOCAL_VM_ENABLED=1 only for a native installation with the local runtime; a Docker backend does not automatically get host QEMU access.

Tests:
python -m unittest discover -s runtime/tests -p test_dashboard_adapter.py -v
uv run --python 3.11 --with fastapi==0.115.7 --with httpx==0.28.1 python -m unittest discover -s runtime/tests -p test_dashboard_routes.py -v
