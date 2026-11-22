# StarliDigital

Self-hosted extraction of the existing StarliDigital dashboard and agent platform, excluding marketing pages. This is an integration workspace, not a completed or certified release.

The existing dashboard source is preserved rather than replaced with a mockup. Source includes chat, company tools, CRM, mail, projects, proposals, hosted agents, videos, social tools, approvals and computer controls. Availability in a fresh installation is tracked in [feature parity](docs/feature-parity.md).

## Getting started

Read [installation](docs/install.md) and run `npm run doctor` to check prerequisites. For a native installation, run `npm run install:app`, `npm run setup`, then `npm start`. Setup prompts privately for the first owner and creates fresh local state. The dashboard requires its Python backend as well as its frontend. Docker Compose is an additional deployment option described in the guide.

Windows, macOS and Linux are installation targets. Platform validation and outstanding requirements are recorded in the installation and [VM runtime](docs/runtime.md) guides. A running application container does not establish that a computer-use VM is ready.

## Source layout

| Directory | Contents |
| --- | --- |
| `dashboard/` | Existing Svelte dashboard and Python application |
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
