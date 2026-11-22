# StarliDigital

Open-source extraction of the new StarliDigital product: companies, bots, teams, Boss coordination, conversations between agents, and generated app previews. Sales pages are excluded. This is an integration workspace, not a completed release.

The requested frontend is being assembled in `product/`, with its native runtime in `product-backend/`. Its exact source and verification limits are recorded in [new product source](docs/new-product-source.md). The earlier `dashboard/` extraction and its previews belong to the legacy OpenWebUI-based application; they do not demonstrate acceptance of this product.

## Getting started

The new product installer and joined runtime are being integrated. Release packaging is disabled until the correct frontend preview and bot/team/Boss flows pass local verification. Earlier installation commands and CI results must not be treated as validation of the new product. Read [installation](docs/install.md) for current integration status.

The native server runs in the foreground; stop it with Ctrl+C. Keep the extracted project in a writable, persistent directory. Node 24+, `uv`, and FFmpeg are prerequisites; the installer prepares the separate application runtimes. QEMU is an additional prerequisite for the isolated computer.

Windows, macOS and Linux are installation targets. Platform validation and outstanding requirements are recorded in the installation and [VM runtime](docs/runtime.md) guides. A running application container does not establish that a computer-use VM is ready.

## Source layout

| Directory | Contents |
| --- | --- |
| `product/` | New StarliDigital bots, teams and Boss frontend |
| `product-backend/` | Native company, orchestration and app runtime source |
| `dashboard/` | Legacy application source; compatibility dependencies under review |
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
