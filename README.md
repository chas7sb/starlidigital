# StarliDigital

Open-source extraction of the new StarliDigital product: companies, bots, teams, Boss coordination, conversations between agents, and generated app previews. Sales pages are excluded. This is an integration workspace, not a completed release.

The frontend lives in `product/`, with its native runtime in `product-backend/`. Its exact source and verification limits are recorded in [new product source](docs/new-product-source.md). The superseded frontend has been removed from the current tree. `dashboard/backend` retains the native foundation libraries and their upstream notices; the new installer serves only `product/`.

## Getting started

The native installer now builds `product/` and runs its native company backend. With Node 24, Python 3.11 and `uv` installed, use these commands from the checkout:

```sh
npm run install:app
npm run setup
npm start
```

Setup asks for a fresh local owner. Open the printed loopback URL, create your company and bots, and connect your own OpenRouter key through `/api/local/provider` or the team model-connection panel. The selected model is Nemotron Ultra free; the application disables paid model fallback. A configured key is not evidence of a successful model reply.

The new frontend and native company/bot/team APIs have run locally. A clean GitHub checkout install and actual OpenRouter Boss/team conversation are separate acceptance gates still being checked. Generated-app workers, their trusted previews and autonomous tool execution remain unconfigured. Earlier legacy application CI does not validate these features. See [installation](docs/install.md) and [backend contract](product-backend/runtime-contract.json).

The native server runs in the foreground; stop it with Ctrl+C. Keep the extracted project in a writable, persistent directory. Node 24+, `uv`, and FFmpeg are prerequisites; the installer prepares the separate application runtimes. QEMU is an additional prerequisite for the isolated computer.

Windows, macOS and Linux are installation targets. Platform validation and outstanding requirements are recorded in the installation and [VM runtime](docs/runtime.md) guides. A running application container does not establish that a computer-use VM is ready.

## Source layout

| Directory | Contents |
| --- | --- |
| `product/` | New StarliDigital bots, teams and Boss frontend |
| `product-backend/` | Native company, orchestration and app runtime source |
| `dashboard/` | Retained native backend foundation, metadata and upstream notices |
| `platform/` | Node platform, active MCP control-plane, CLI and device source |
| `platform/extensions/` | Additional production feature runtimes, extracted without live state |
| `runtime/` | Isolated computer-use VM lifecycle |
| `installer/` | Local deployment and setup entry points |
| `config/` | Fresh-instance configuration examples |
| `security/` | Provenance and privacy review tooling |
| `qa/` | Source contracts and runtime acceptance checks |
| `packaging/` | Reproducible source archive and CI tooling |

Use your own provider accounts and credentials. Production databases, customer files, credentials, sessions and backups are excluded. Preserve component copyright and license notices; see [provenance](docs/provenance.md) for the remaining release review.

StarliDigital-owned code uses [Apache 2.0](LICENSE). Third-party components retain their own licenses and notices; see [NOTICE](NOTICE).

See [architecture](docs/architecture.md), [configuration](docs/configuration.md) and the [Prime execution ledger](docs/prime-ledger.md) for current integration status.
