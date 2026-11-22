# OpenPencil build and gateway contract

The restored editor is OpenPencil0.16.0 plus the checked-in Starli patch, not a replacement UI. Source remains owned by the integration/source owner. Build in a scratch copy of the ENTIRE source tree, preserving authored directories named state/data; exclude only generated dependencies/build artifacts and actual runtime state at its known root.

## Exact inputs

- source/package.json: open-pencil-app0.16.0, packageManager bun@1.4.2.
- source/bun.lock is required and passed to bun install --frozen-lockfile; no npm conversion or dependency upgrades.
- Root production script: bun run build:packages && bun run lint && vite build. Workspace dist packages must exist before Vite resolves public package exports.
- Starli Vite base is /openpencil/; build output must contain dist/index.html and real JS/WASM/assets.
- Gateway runtime has its own npm lock and @open-pencil/mcp0.16.0. Use Node24 for the validated runtime contract; frontend Bun and gateway npm dependency trees stay separate.
- The direct official Bun ZIP has bun only; scripts also require a bunx alias. The helper creates a hardlink/copy of the exact Bun binary in its own cache/bin, without global install or PATH edits.

## Reproduce

Use an isolated copy and a local tool cache:

```text
python packaging/openpencil_build.py install --source <scratch>/source --cache <scratch>/tools
python packaging/openpencil_build.py build --source <scratch>/source --cache <scratch>/tools
```

The bootstrap pins official release-asset SHA256 values for Windows, macOS and glibc Linux x64/ARM64 in bun-1.4.2-assets.json. It verifies the archive before executing Bun. Linux musl is explicitly unsupported by this bootstrap contract. --bun can select an already reviewed local binary but still enforces the exact version. Windows was actually tested; other build hosts require execution before claiming support.

For the existing gateway, prepare a separate fresh scratch root containing runtime/ plus installed npm-locked dependencies and the REAL built frontend copied to site/. Then:

```text
python packaging/openpencil_gateway_smoke.py <scratch-root>
```

The smoke starts only its own loopback child processes, uses generated test credentials, requires a fresh config and real site/index.html, and always stops its children. It checks anonymous rejection, Basic/session authentication, origin/traversal refusal, actual MCP initialization/tool discovery, eval disabled, and gateway server-side bearer injection. Credentials, state and documents are never release payload. This proves those HTTP boundaries; it does not prove drawing, browser/editor pairing, provider calls, desktop parity or customer authorization integration.

## Validation state

Exact-version Bun SHA256 verified; frozen frontend install passed with2009packages. Runtime npm ci passed with137packages. Six build-helper contract regressions passed. Actual full root production build and gateway smoke are in progress; see docs/agentx9-status.md for final executed outcomes. No source changes, public publishing or production service operations.
