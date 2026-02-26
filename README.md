<h1 align="center">Toolkit</h1>

<p align="center">
  <a href="https://github.com/amitrintzler/skills-and-mcps/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/amitrintzler/skills-and-mcps?display_name=tag&label=release" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="https://nodejs.org/"><img alt="Node >=18.17" src="https://img.shields.io/badge/node-%3E%3D18.17-339933?logo=node.js&logoColor=white" /></a>
</p>

<p align="center">
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml"><img alt="Daily Security" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml"><img alt="Security / CodeQL" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-dependency-review.yml"><img alt="Dependency Review (PR)" src="https://img.shields.io/badge/dependency%20review-PR%20only-2563eb" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-secrets.yml"><img alt="Secrets Scan" src="https://img.shields.io/badge/secrets-gitleaks-ef4444" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-sbom-trivy.yml"><img alt="SBOM + Trivy" src="https://img.shields.io/badge/SBOM%20%2B%20Trivy-enabled-0ea5e9" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/catalog-sync.yml"><img alt="Catalog Sync (Scheduled)" src="https://img.shields.io/badge/catalog%20sync-scheduled-0ea5e9" /></a>
</p>

Toolkit helps teams discover, score, and safely install Skills, MCP servers, and plugins with policy-aware risk controls.

Quick links:
- [Install](#install-toolkit-v020)
- [Quick Start](#quick-start-2-minute-path)
- [Core Commands](#core-commands)
- [Safety Model](#safety-model)
- [Docs](#where-to-go-next)

## What is Toolkit?

Toolkit is a Node.js CLI that unifies multiple AI tooling ecosystems into one searchable catalog and applies trust/risk policy before installation.

You can:
- Discover Skills, MCP servers, Claude plugins, and Copilot extensions from one place.
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
- `skill.sh` (required for setup/doctor flows)

## Install Toolkit (v0.2.0)

```bash
git clone https://github.com/amitrintzler/skills-and-mcps.git toolkit
cd toolkit
git checkout v0.2.0
npm install
npm run init
npm run doctor
```

Install newest release tag instead of pinning `v0.2.0`:

```bash
git checkout $(git describe --tags --abbrev=0)
```

## Quick Start (2-minute path)

```bash
npm install
npm run init
npm run doctor
npm run scan -- --project . --format table
npm run recommend -- --project . --only-safe --sort trust --limit 10
```

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
| `npm run about` | Show version and framework scope |
| `npm run init` | Create project defaults and setup local config |
| `npm run doctor` | Validate runtime prerequisites and environment health |
| `npm run sync` | Refresh catalog data from configured registries |
| `npm run scan -- --project . --format table` | Analyze repository capabilities/archetype |
| `npm run top -- --project . --limit 5` | Show top-ranked items for the current context |
| `npm run recommend -- --project . --only-safe --sort trust --limit 10` | Generate policy-aware recommendations |
| `npm run assess -- --id <catalog-id>` | Evaluate risk for one candidate before install |
| `npm run install:item -- --id <catalog-id> --yes` | Install a candidate if policy allows |
| `npm run status -- --verbose` | Report catalog health, staleness, and policy status |

Full command reference: [`docs/cli-reference.md`](docs/cli-reference.md)

## Safety Model

Toolkit blocks high-risk and critical installs by default.

| Tier | Score | Default install policy |
| --- | --- | --- |
| low | 0-24 | allow |
| medium | 25-49 | allow with warning |
| high | 50-74 | block |
| critical | 75-100 | block |

Whitelist and quarantine state are enforced in recommendation and install flows, and can be continuously maintained with daily verification/quarantine automation.

Security deep-dive: [`docs/security/README.md`](docs/security/README.md)

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

This repository currently does not include a root `LICENSE` file.
