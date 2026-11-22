# First local owner

Install dependencies using `installer/native.mjs` first, then stop both services. Run this helper with the dashboard virtual environment's Python 3.11; system Python 3.14 is unsupported.

Windows:

```powershell
installer/.runtime/python/Scripts/python.exe onboarding/first_run.py setup
installer/.runtime/python/Scripts/python.exe onboarding/first_run.py start
```

macOS/Linux:

```sh
installer/.runtime/python/bin/python onboarding/first_run.py setup
installer/.runtime/python/bin/python onboarding/first_run.py start
```

In another terminal, run the same Python command with `check`. Setup requires an interactive terminal and prompts for owner name, email, platform username, and a hidden password. No password is accepted in arguments or saved in configuration. Use 14+ characters and at most 72 UTF-8 bytes. Set `STARLI_NODE24` if Node 24 is not on PATH. Setup accepts optional `--dashboard http://127.0.0.1:8080 --platform http://127.0.0.1:4100`; only literal loopback HTTP origins with explicit ports are permitted. Redirects and environment HTTP proxies are refused by checks.

After CLI owner setup and service start, open `http://127.0.0.1:8080/setup` to sign in and connect your account's model provider using the dashboard's existing Providers component. That page selects provider/model settings; it does not replace trusted first-owner CLI setup. Public signup cannot create the first administrator in the inspected backend, even if an older UI branch offers that link. Provider selection is not proof of a successful inference; send a chat message to verify your configured provider separately.

The helper creates ignored `onboarding/.local/setup.json`, a random stable dashboard session secret, fresh SQLite state, and a private administrator binding. It uses the shared `starli_private_fs` policy to create private directories/files atomically and validate existing storage. Windows uses a protected owner-only DACL at creation; existing broad explicit grants, inherited ACLs, links and unsupported ownership are rejected without repair. POSIX uses private modes and file checks. Startup validates configuration/binding/owner files before reading them. Keep the directory private and back up its secret, bindings and databases together. Existing setup/data is refused, not overwritten. A failed setup can leave partial fresh state; inspect it before deliberately resetting the private directory. It does not modify existing installer or production databases.

Always launch this installation through `first_run.py start`: that command supplies the same explicit data/config paths to the existing native launcher. Starting the native launcher directly selects its different default state. This helper targets native startup; it does not configure Docker volumes. It intentionally leaves public signup disabled.

Both `DATABASE_URL` and the native launcher's higher-priority `STARLI_DASHBOARD_DATABASE_URL` are forced to the same generated private dashboard SQLite path. An unrelated ambient override cannot redirect this first-owner installation into another database.

The private owner launch explicitly sets `STARLI_LOCAL_VM_ENABLED=1` for the installation-owner VM console. This is not a public-service default or company-computer permission. The authenticated `/api/v1/starli/local-vm/status` check reads runtime status only; it never starts, stops, or controls the guest. The VM must be provisioned separately. Do not infer desktop persistence/readiness from status alone. Provider runtime code resolves to `platform/extensions/starli-runtime` and uses Node 24; an absent extension or dependencies must report unavailable rather than a completed connection.

The helper explicitly supplies the dashboard Python as `STARLI_PYTHON_BIN`, the resolved Node24 path as both `STARLI_NODE_BIN` and `STARLI_NODE_BINARY`, and the isolated video Python as `PYTHON_BIN`. Install both dashboard and video runtimes first. `STARLI_VIDEO_PYTHON` can deliberately override the video interpreter. Provider/tool subprocess adapters must preserve this binary contract; a successful owner/VM check does not establish provider inference or video rendering.

## Actual identity contract

- Python `/api/v1/auths/signup` returns 503 when no users exist; it cannot bootstrap the owner. There is no owner HTTP bootstrap endpoint in inspected source.
- Trusted offline setup uses actual `Auths.insert_new_auth`, `get_password_hash`, and application migrations to create the first dashboard administrator. Node creation uses actual `Store` and `hashPassword` in a bounded child, passing the password through stdin. Independent Node and dashboard accounts are created with their native hashes; sharing a password is a first-run convenience, not synchronized password reset.
- Dashboard `starli_platform.principal` requires a private `memberships[webui_id].v2UserId` binding, plus dashboard `admin` and Node `ADMIN` roles. Setup creates that explicit file and sets `STARLI_BINDINGS_PATH` for both processes. Email matching is not used for authority.
- Ordinary native customers have an existing bridge in `starli_customer_identity.ensure_native_customer`: a nonce-checked, password-disabled Node service identity. Do not create password login or admin mappings for those users manually.
- Node owner identity uses the source's `administratorEmail` policy with the explicitly supplied operator email as `ADMIN_EMAIL`; recovery email uses that same operator email. General local account identifiers use `ACCOUNT_EMAIL_DOMAIN=local.invalid`. No mailbox is provisioned. Authority still depends on the private ID binding, never matching email addresses.
- Company authority is separate from the platform admin binding. Setup prompts for the company/workspace name and uses the same trusted `company_rbac.Authority.create` model as mounted `POST /api/v1/companies`, creating the dashboard owner membership. Both the mounted route's `DATA_DIR/company-authority.sqlite3` and `STARLI_COMPANY_DATABASE` point at that same fresh database. No bots, provider credentials, or VM are created. `check` verifies authenticated company listing and owner capabilities.

The trusted setup also initializes the actual `starli_memory.registry.BotRegistry` schema against the company authority callback, without inventing any bots or grants. The full workspace requires the existing dashboard database, company database and registry database before startup. `STARLI_COMPANY_MESSAGING_ENABLED=1` enables the required local room/message store; it does not configure external email/social transports.

`check` verifies both HTTP health responses, then performs real dashboard sign-in and authenticated `/api/v1/starli/platform/admin` access. Tokens remain in memory and responses are not printed. It exits nonzero for failed health/login/bridge checks. Successful checks establish those boundaries only, not full feature parity or provider/VM readiness. Owner creation is offline and runtime checks must still pass after launch.

Maintainers can run `qa_e2e.py` with the same installed Python for a disposable actual-service test on loopback ports 18280/18281. It uses only synthetic invalid-domain credentials saved in private ignored `work/onboarding-e2e-*`, launches its own two services, tests real owner sign-in/admin binding/customer identity/company owner authority/unauthenticated denial, then reads authenticated VM status and a PNG frame without guest input. It terminates its processes afterward and preserves private logs/state for diagnosis. Optional `--serve` keeps the checked instance running for visual QA; credentials remain only in its ignored `qa-credentials.json`, and process IDs are recorded privately. Ctrl+C stops its children. This does not use an already-running application installation or claim provider execution/guest control.

To reload source while retaining a QA browser session, first stop only that QA supervisor/process tree after matching it to the private `qa-processes.json`, then run `qa_e2e.py --resume work/onboarding-e2e-EXISTING --serve`. Resume is test-only: it requires an existing private subdirectory inside this checkout's `work/`, rejects symlink/reparse paths, validates config/credentials/owner/binding and database locations, and refuses occupied service ports. It skips bootstrap and preserves the session secret, credentials, owner IDs, company state and databases. Secret/config/binding/owner file contents are compared before and after checks. Only QA result/process metadata is rotated into private history files and replaced. Existing logs are retained under per-run names.

The resumed checks include the real authenticated provider catalog (current locked runtime: 42 providers), authorized tool catalog (69 tools), owner/identity/company APIs, and read-only VM status/frame. Catalog availability does not establish configured credentials, successful inference, or successful tool execution. The fresh backend CI smoke can call the unchanged `first_run` helpers (`setup`, `environment`, `private_read`, `private_write`) with its own trusted synthetic state and ports; it need not enable or exercise any VM. Keep CI credentials in private ignored state, never command arguments or logs.
