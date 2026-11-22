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

The helper creates ignored `onboarding/.local/setup.json`, a random stable dashboard session secret, fresh SQLite state, and a private administrator binding. POSIX modes restrict new private files; Windows restricts the private directory ACL to the current user via `icacls`. Keep the directory private and back up its secret, bindings and databases together. Existing setup/data is refused, not overwritten. A failed setup can leave partial fresh state; inspect it before deliberately resetting the private directory. It does not modify existing installer or production databases.

Always launch this installation through `first_run.py start`: that command supplies the same explicit data/config paths to the existing native launcher. Starting the native launcher directly selects its different default state. This helper targets native startup; it does not configure Docker volumes. It intentionally leaves public signup disabled.

The private owner launch explicitly sets `STARLI_LOCAL_VM_ENABLED=1` for the installation-owner VM console. This is not a public-service default or company-computer permission. The authenticated `/api/v1/starli/local-vm/status` check reads runtime status only; it never starts, stops, or controls the guest. The VM must be provisioned separately. Do not infer desktop persistence/readiness from status alone. Provider runtime code resolves to `platform/extensions/starli-runtime` and uses Node 24; an absent extension or dependencies must report unavailable rather than a completed connection.

## Actual identity contract

- Python `/api/v1/auths/signup` returns 503 when no users exist; it cannot bootstrap the owner. There is no owner HTTP bootstrap endpoint in inspected source.
- Trusted offline setup uses actual `Auths.insert_new_auth`, `get_password_hash`, and application migrations to create the first dashboard administrator. Node creation uses actual `Store` and `hashPassword` in a bounded child, passing the password through stdin. Independent Node and dashboard accounts are created with their native hashes; sharing a password is a first-run convenience, not synchronized password reset.
- Dashboard `starli_platform.principal` requires a private `memberships[webui_id].v2UserId` binding, plus dashboard `admin` and Node `ADMIN` roles. Setup creates that explicit file and sets `STARLI_BINDINGS_PATH` for both processes. Email matching is not used for authority.
- Ordinary native customers have an existing bridge in `starli_customer_identity.ensure_native_customer`: a nonce-checked, password-disabled Node service identity. Do not create password login or admin mappings for those users manually.
- Node owner identity uses the source's `administratorEmail` policy with the explicitly supplied operator email as `ADMIN_EMAIL`; recovery email uses that same operator email. General local account identifiers use `ACCOUNT_EMAIL_DOMAIN=local.invalid`. No mailbox is provisioned. Authority still depends on the private ID binding, never matching email addresses.
- Company authority is separate from the platform admin binding. Setup prompts for the company/workspace name and uses the same trusted `company_rbac.Authority.create` model as mounted `POST /api/v1/companies`, creating the dashboard owner membership. Both the mounted route's `DATA_DIR/company-authority.sqlite3` and `STARLI_COMPANY_DATABASE` point at that same fresh database. No bots, provider credentials, or VM are created. `check` verifies authenticated company listing and owner capabilities.

`check` verifies both HTTP health responses, then performs real dashboard sign-in and authenticated `/api/v1/starli/platform/admin` access. Tokens remain in memory and responses are not printed. It exits nonzero for failed health/login/bridge checks. Successful checks establish those boundaries only, not full feature parity or provider/VM readiness. Owner creation is offline and runtime checks must still pass after launch.

Maintainers can run `qa_e2e.py` with the same installed Python for a disposable actual-service test on loopback ports 18280/18281. It uses only synthetic invalid-domain credentials saved in private ignored `work/onboarding-e2e-*`, launches its own two services, tests real owner sign-in/admin binding/customer identity/company owner authority/unauthenticated denial, then reads authenticated VM status and a PNG frame without guest input. It terminates its processes afterward and preserves private logs/state for diagnosis. Optional `--serve` keeps the checked instance running for visual QA; credentials remain only in its ignored `qa-credentials.json`, and process IDs are recorded privately. Ctrl+C stops its children. This does not use an already-running application installation or claim provider execution/guest control.
