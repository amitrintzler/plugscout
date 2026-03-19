<h1 align="center">Toolkit</h1>

<p align="center">
  <a href="https://github.com/amitrintzler/skills-and-mcps/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/amitrintzler/skills-and-mcps?display_name=tag&label=release" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="https://nodejs.org/"><img alt="Node >=18.17" src="https://img.shields.io/badge/node-%3E%3D18.17-339933?logo=node.js&logoColor=white" /></a>
  <a href="https://www.linkedin.com/in/amit-rintzler-94444535/"><img alt="LinkedIn Amit Rintzler" src="https://img.shields.io/badge/LinkedIn-Amit%20Rintzler-0A66C2?logo=linkedin&logoColor=white" /></a>
</p>

<p align="center">
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml"><img alt="Daily Security" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml"><img alt="Security / CodeQL" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-dependency-review.yml"><img alt="Dependency Review (PR)" src="https://img.shields.io/badge/dependency%20review-PR%20only-2563eb" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-secrets.yml"><img alt="Secrets Scan" src="https://img.shields.io/badge/secrets-gitleaks-ef4444" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-sbom-trivy.yml"><img alt="SBOM + Trivy" src="https://img.shields.io/badge/SBOM%20%2B%20Trivy-enabled-0ea5e9" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/catalog-sync.yml"><img alt="Catalog Sync (Scheduled)" src="https://img.shields.io/badge/catalog%20sync-scheduled-0ea5e9" /></a>
</p>

Toolkit helps teams discover, score, and safely install Claude plugins, Claude connectors, Copilot extensions, Skills, and MCP servers with policy-aware risk controls.

Written by Amit Rintzler.

License: MIT. Copyright (c) 2026 Amit Rintzler. Reuse is allowed, but redistributed copies must keep the copyright and license notice.

Quick links:
- [Install](#install-toolkit-v020)
- [Quick Start](#quick-start-2-minute-path)
- [Core Commands](#core-commands)
- [Safety Model](#safety-model)
- [Docs](#where-to-go-next)

## What is Toolkit?

Toolkit is a Node.js CLI that unifies multiple AI tooling ecosystems into one searchable catalog and applies trust/risk policy before installation.

You can:
- Discover Claude plugins, Claude connectors, Copilot extensions, Skills, and MCP servers from one place.
- Score candidates using trust-first ranking.
- Enforce install gates using whitelist + quarantine policy.
- Run continuous checks in CI and scheduled workflows.

## Who this is for

- Teams managing AI tooling catalogs across providers.
- Developers who want safe recommendations for a specific repository.
- Maintainers responsible for whitelist/quarantine governance.

## Prerequisites

- Node.js `>=18.17`
- npm
- `skills` CLI or `npx` for modern skill installs
- `skill.sh` is optional and only needed for some legacy `skill.sh`-style installs

## Install Toolkit (v0.3.0)

**Global install (recommended):**

```bash
npm install -g toolkit
toolkit setup
```

`toolkit setup` is a single command that installs prerequisites, writes default config, and syncs all catalogs. No extra steps needed.

**From source:**

```bash
git clone https://github.com/amitrintzler/skills-and-mcps.git toolkit
cd toolkit
git checkout v0.3.0
npm install
npm run setup
```

Install newest release tag instead of pinning `v0.3.0`:

```bash
git checkout $(git describe --tags --abbrev=0)
```

## Quick Start (2-minute path)

```bash
npm install -g toolkit
toolkit setup
toolkit scan --project . --format table
toolkit recommend --project . --only-safe --sort trust --limit 10
```

Or from source:

```bash
npm install && npm run setup
npm run scan -- --project . --format table
npm run recommend -- --project . --only-safe --sort trust --limit 10 --details
```

Run `toolkit` with no args to open the home screen.

Important: `top` and `recommend` are repo-aware rankings, not global popularity charts. A higher score means a better match for the current repository under the active policy, using `fit + trust + freshness - security - blocked`. Review each suggestion before installing, and do not install blindly from rank alone.

Installs are now review-gated: run `show --id <catalog-id>` or `assess --id <catalog-id>` before `install`. Use `--override-review` only when you intentionally want to bypass that safeguard.

For supported legacy MCP entries, Toolkit now prefers direct installers when the target is unambiguous:
- npm package targets install through `npm install -g`
- container targets install through `docker pull`
- ambiguous or binary-asset installs remain explicit/manual

Toolkit also performs a daily interactive update check against GitHub Releases and prints a download hint when a newer release is available.

Video preview/render commands are optional maintainer tooling. They are kept in `devDependencies` and are not required to install or run the CLI package.

## Typical Workflow

Use this lifecycle for day-to-day operation:

```bash
npm run sync
npm run scan -- --project . --format table
npm run top -- --project . --limit 5
npm run recommend -- --project . --only-safe --sort trust --limit 10 --explain-scan
npm run assess -- --id mcp:filesystem
npm run install:item -- --id mcp:filesystem --yes
```

Expected output shape (trimmed):

```text
ID                                TYPE                PROVIDER    RISK      BLOCKED
copilot-extension:actions-...     copilot-extension   github      low(0)    false
claude-plugin:repo-threat-...     claude-plugin       anthropic   low(0)    false
skill:ci-hardening                skill               openai      low(0)    false
```

## Core Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | **One-step setup**: install prerequisites + init config + sync catalogs |
| `npm run about` | Show version and framework scope |
| `npm run init` | Create project defaults and setup local config (interactive) |
| `npm run doctor -- --install-deps` | Validate runtime prerequisites and bootstrap the `skills` CLI when missing |
| `npm run sync` | Refresh catalog data from configured registries |
| `npm run scan -- --project . --format table` | Analyze repository capabilities/archetype |
| `npm run top -- --project . --limit 5` | Show top-ranked items for the current context |
| `npm run top -- --project . --limit 5 --details` | Explain rank math, trust/risk interpretation, and install hint per item |
| `npm run recommend -- --project . --only-safe --sort trust --limit 10` | Generate policy-aware recommendations |
| `npm run recommend -- --project . --only-safe --sort trust --limit 10 --details` | Include per-item acceptance evidence (provenance, reasons, tradeoffs) |
| `npm run assess -- --id <catalog-id>` | Evaluate risk for one candidate before install |
| `npm run install:item -- --id <catalog-id> --yes --install-deps` | Install a candidate if policy allows and bootstrap supported install deps when requested |
| `npm run status -- --verbose` | Report catalog health, staleness, and policy status |
| `node dist/cli.js web --open` | Generate readable HTML report with score legend and decision cards |

Packaged CLI-only commands:

- `toolkit setup` (**first-time setup**: prerequisites + config + sync in one step)
- `toolkit` (home screen)
- `toolkit upgrade check`
- `toolkit web --open` (readable browser report)
- `toolkit <command> --no-update-check` (skip daily auto-check for the current run)

Full command reference: [`docs/cli-reference.md`](docs/cli-reference.md)

## Safety Model

Toolkit blocks high-risk and critical installs by default.

| Tier | Score | Default install policy |
| --- | --- | --- |
| low | 0-24 | allow |
| medium | 25-49 | allow with warning |
| high | 50-74 | block |
| critical | 75-100 | block |

Risk score meaning:
- `0` is lowest observed risk signal.
- `100` is highest risk signal.
- Higher score means higher risk and stronger install gating.

Whitelist and quarantine state are enforced in recommendation and install flows, and can be continuously maintained with daily verification/quarantine automation.

Security deep-dive: [`docs/security/README.md`](docs/security/README.md)

## Plugin and Connector Catalog Sources

- Claude plugins: `https://claude.com/plugins` (scraped with sanitization + host allowlist guards)
- Claude connectors: `https://claude.com/connectors` (scraped with sanitization + host allowlist guards)
- Anthropic GitHub plugin manifests: `anthropics/claude-plugins-official`, `anthropics/knowledge-work-plugins`, `anthropics/financial-services-plugins`
- GitHub skills marketplaces: `numman-ali/n-skills`, `mhattingpete/claude-skills-marketplace`, `neondatabase-labs/ai-rules`
- GitHub Claude Code plugin marketplaces: `docker/claude-plugins`, `pleaseai/claude-code-plugins`
- Copilot plugins (official): `https://raw.githubusercontent.com/github/copilot-plugins/main/.github/plugin/marketplace.json`
- Copilot plugins (curated): `https://raw.githubusercontent.com/github/awesome-copilot/main/.github/plugin/marketplace.json`

Legacy endpoints returning `404` are not used for sync anymore:

- `https://api.anthropic.com/v1/plugins/catalog`
- `https://api.github.com/copilot/extensions/catalog`

## Where To Go Next

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- CLI Reference: [`docs/cli-reference.md`](docs/cli-reference.md)
- Security: [`docs/security/README.md`](docs/security/README.md)
- CI Quarantine Automation: [`docs/ci/daily-quarantine.md`](docs/ci/daily-quarantine.md)
- End-to-End Use Cases: [`docs/use-cases.md`](docs/use-cases.md)
- Configuration and Data Reference: [`docs/reference.md`](docs/reference.md)
- Functionality Validation Matrix: [`docs/validation-functionality.md`](docs/validation-functionality.md)

## Contributing

- Follow repository standards in [`AGENTS.md`](AGENTS.md).
- Run checks before opening a PR:

```bash
npm run lint
npm run test
npm run build
```

## Support

- Open an issue in the repository for bugs or feature requests.
- Include command, input, and output snippets when reporting failures.

## License

This repository does not yet include a root `LICENSE` file. Choose and add one before publishing for third-party reuse.
