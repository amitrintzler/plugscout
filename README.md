<h1 align="center">Toolkit</h1>

<p align="center">
  <a href="https://github.com/amitrintzler/skills-and-mcps/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/amitrintzler/skills-and-mcps?display_name=tag&label=release" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/ci.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml"><img alt="Daily Security" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml"><img alt="Security / CodeQL" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/catalog-sync.yml"><img alt="Catalog Sync (Scheduled)" src="https://img.shields.io/badge/catalog%20sync-scheduled-0ea5e9" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-dependency-review.yml"><img alt="Dependency Review (PR)" src="https://img.shields.io/badge/dependency%20review-PR%20only-2563eb" /></a>
  <a href="https://nodejs.org/"><img alt="Node >=18.17" src="https://img.shields.io/badge/node-%3E%3D18.17-339933?logo=node.js&logoColor=white" /></a>
</p>

<p align="center">
  <sub>
    Production gates tracked as pass/fail: <strong>CI</strong>, <strong>Daily Security</strong>, and <strong>Security / CodeQL</strong>.
    Scheduled sync and PR dependency review are enabled and linked above.
  </sub>
</p>

<p align="center">
  <strong>Toolkit</strong> is a production-grade CLI framework to discover, rank, validate, and safely install <strong>Skills</strong>,
  <strong>MCP servers</strong>, <strong>Claude plugins</strong>, and <strong>Copilot extensions</strong>.
</p>

<p align="center">
  Live workflow runs and health details are available in the
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions">GitHub Actions dashboard</a>.
</p>

<p align="center">
  <a href="#install-toolkit-v020">Install</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#prerequisites">Prerequisites</a> •
  <a href="#how-to-use-this-cli">How To Use</a> •
  <a href="#video-walkthrough">Video Walkthrough</a> •
  <a href="#full-cli-capability-map">CLI Map</a> •
  <a href="#end-to-end-use-cases-with-screenshots">Use Cases</a> •
  <a href="#ci-and-security-gates">Security</a>
</p>

---

## Prerequisites

- Node.js `>=18.17`
- npm
- `skill.sh` (required)
- `gh` CLI (recommended for GitHub-based install flows)

Verify locally:

```bash
node -v
npm -v
skill.sh --version
gh --version
```

## Why this framework

| Capability | Outcome |
| --- | --- |
| Unified Catalog | One normalized inventory across all supported ecosystems |
| Trust-First Ranking | Better defaults using fit + trust - risk penalties |
| Policy-Gated Installs | High-risk items blocked by default |
| Continuous Verification | Daily whitelist validation and quarantine automation |
| Rich CLI UX | Guided onboarding, diagnostics, discovery, and export |
| CI Security Controls | CodeQL, dependency review, secrets scan, SBOM + Trivy |

## Visual architecture

```mermaid
flowchart LR
  %% SOURCE LAYER
  subgraph S["Source Layer"]
    R1["Official Provider Feeds"]
    R2["Community Sources (Opt-in)"]
    R3["Local Fallback Entries"]
  end

  %% INGESTION + INTELLIGENCE LAYER
  subgraph I["Ingestion + Intelligence Layer"]
    I1["Remote Fetch + Incremental Cursor"]
    I2["Adapter Mapping (provider-specific)"]
    I3["Schema Validation (Zod)"]
    I4["Normalization + Merge (deterministic)"]
    I5["Unified Catalog Store\n(data/catalog/items.json)"]
    I6["Trust-First Ranking Engine"]
    I7["Risk Assessment Engine"]
  end

  %% POLICY + GOVERNANCE LAYER
  subgraph G["Policy + Governance Layer"]
    G1["Security Policy Gates\n(low/medium/high/critical)"]
    G2["Whitelist Verification"]
    G3["Quarantine State"]
    G4["Install Audit Logs"]
  end

  %% USER EXPERIENCE LAYER
  subgraph U["CLI Experience Layer"]
    U1["Init + Doctor"]
    U2["List / Search / Show / Top"]
    U3["Recommend + Export (table/json/csv/md)"]
    U4["Assess + Install"]
    U5["Status + Sync"]
  end

  %% CI / CONTINUOUS TRUST LAYER
  subgraph C["Continuous Trust (GitHub Actions)"]
    C1["CI (lint/test/build/reproducibility)"]
    C2["CodeQL / Dependency Review / Secrets / Trivy+SBOM"]
    C3["Daily Security + Quarantine PR"]
    C4["Daily Catalog Sync"]
  end

  R1 --> I1
  R2 --> I1
  R3 --> I4

  I1 --> I2 --> I3 --> I4 --> I5
  I5 --> I6
  I5 --> I7

  I6 --> U3
  I7 --> U4
  I5 --> U2
  I5 --> U5
  U1 --> U5

  I7 --> G1
  G1 --> U4
  G1 --> G2
  G2 --> G3
  U4 --> G4
  G3 --> I5

  C1 --> I5
  C2 --> G1
  C3 --> G3
  C4 --> I5

  classDef source fill:#0f172a,stroke:#38bdf8,color:#e2e8f0,stroke-width:1px;
  classDef engine fill:#0b1a14,stroke:#22c55e,color:#dcfce7,stroke-width:1px;
  classDef policy fill:#1f1313,stroke:#ef4444,color:#fee2e2,stroke-width:1px;
  classDef ux fill:#1a1633,stroke:#a78bfa,color:#ede9fe,stroke-width:1px;
  classDef ci fill:#1a2230,stroke:#f59e0b,color:#fef3c7,stroke-width:1px;

  class R1,R2,R3 source;
  class I1,I2,I3,I4,I5,I6,I7 engine;
  class G1,G2,G3,G4 policy;
  class U1,U2,U3,U4,U5 ux;
  class C1,C2,C3,C4 ci;
```

---

## Install Toolkit (v0.2.0)

Latest release: [`v0.2.0`](https://github.com/amitrintzler/skills-and-mcps/releases/tag/v0.2.0)

```bash
git clone https://github.com/amitrintzler/skills-and-mcps.git toolkit
cd toolkit
git checkout v0.2.0
npm install
npm run init
npm run doctor
```

To install the newest available release instead of pinning `v0.2.0`:

```bash
git checkout $(git describe --tags --abbrev=0)
```

---

## Quick Start

```bash
npm install
npm run init
npm run doctor
npm run scan -- --project . --format table
npm run sync
npm run top -- --limit 5
```

For current project recommendations:

```bash
npm run recommend -- --project . --only-safe --sort trust --limit 10 --explain-scan
```

Optional LLM enrichment (requires `OPENAI_API_KEY`):

```bash
npm run scan -- --project . --llm
npm run recommend -- --project . --llm --explain-scan
```

## How To Use This CLI

If you want the simplest flow for any project:

```bash
# 1) Install and run guided setup
skill.sh --version
npm install
npm run init

# 2) Validate your environment
npm run doctor

# 3) Sync latest catalog data
npm run sync

# 4) Scan your repository deeply (archetype + capability inference)
npm run scan -- --project . --format table

# 5) Discover best options for your current repo
npm run top -- --project . --limit 5

# 6) Inspect and install safely
npm run show -- --id mcp:filesystem
npm run assess -- --id mcp:filesystem
npm run install:item -- --id mcp:filesystem --yes
```

Recommended daily usage:

```bash
npm run sync
npm run scan -- --project . --format table
npm run recommend -- --project . --only-safe --sort trust --limit 10 --explain-scan
```

## Video Walkthrough

[![Framework Walkthrough Preview](out/framework-walkthrough-preview.gif)](https://raw.githubusercontent.com/amitrintzler/skills-and-mcps/main/out/framework-walkthrough.mp4)

Video file: [framework-walkthrough.mp4](https://raw.githubusercontent.com/amitrintzler/skills-and-mcps/main/out/framework-walkthrough.mp4)

---

## Full CLI Capability Map

### Core operations
- `npm run about`
- `npm run status [-- --verbose]`
- `npm run sync [-- --kind skill,mcp,claude-plugin,copilot-extension] [-- --dry-run]`

### Guided setup and diagnostics
- `npm run init [-- --project .]`
- `npm run doctor [-- --project .]`

### Catalog discovery and inspection
- `npm run list -- --kind mcp --limit 10`
- `npm run search -- security`
- `npm run explain -- --limit 20` 
- `npm run explain -- --kind mcp --format json`
- `npm run scan -- --project . --format table`
- `npm run scan -- --project . --format json --out scan-report.json`
- `npm run show -- --id mcp:filesystem`
- `npm run top -- --project . --limit 5`

### Recommendation and export
- `npm run recommend -- --project . --format table`
- `npm run recommend -- --project . --only-safe --sort trust --limit 10 --explain-scan`
- `npm run recommend -- --project . --llm --explain-scan`
- `npm run recommend -- --project . --export csv --out recommendations.csv`
- `npm run recommend -- --project . --export md --out recommendations.md`

### Risk and installation controls
- `npm run assess -- --id mcp:remote-browser`
- `npm run install:item -- --id mcp:filesystem --yes`
- `npm run install:item -- --id mcp:remote-browser --yes --override-risk`

### Security operations
- `npm run whitelist:verify`
- `npm run quarantine:apply -- --report data/security-reports/YYYY-MM-DD/report.json`

---

## End-to-End Use Cases (With Screenshots)

### 1) First-time onboarding for any project
Command:
```bash
npm run init
```

![Init Wizard](assets/screenshots/01-init.svg)

### 2) Validate environment readiness
Command:
```bash
npm run doctor
```

![Doctor Checks](assets/screenshots/02-doctor.svg)

### 3) Browse and search catalog quickly
Commands:
```bash
npm run list -- --kind mcp --limit 3
npm run search -- security
npm run show -- --id copilot-extension:repo-security
```

![List and Search](assets/screenshots/03-list-search.svg)

### 4) Generate safe recommendations and export
Commands:
```bash
npm run recommend -- --project . --only-safe --sort trust --limit 5
npm run recommend -- --project . --export csv --out recommendations.csv
```

![Recommendations and Export](assets/screenshots/04-recommend.svg)

### 5) Enforce risk policy before install
Commands:
```bash
npm run assess -- --id mcp:remote-browser
npm run install:item -- --id mcp:remote-browser --yes
npm run install:item -- --id mcp:remote-browser --yes --override-risk
```

![Install and Risk Gates](assets/screenshots/05-install.svg)

### 6) Continuous trust operations (verify + quarantine)
Commands:
```bash
npm run whitelist:verify
npm run quarantine:apply -- --report data/security-reports/YYYY-MM-DD/report.json
```

![Security Operations](assets/screenshots/06-security.svg)

---

## CI and Security Gates

### Workflows
- `.github/workflows/ci.yml`
- `.github/workflows/security-codeql.yml`
- `.github/workflows/security-dependency-review.yml`
- `.github/workflows/security-secrets.yml`
- `.github/workflows/security-sbom-trivy.yml`
- `.github/workflows/daily-security.yml`
- `.github/workflows/catalog-sync.yml`

### Security gate policy

| Check | Scope | Enforcement |
| --- | --- | --- |
| CodeQL | JS/TS code scanning | Blocking |
| Dependency Review | PR dependency changes | Blocking on High/Critical |
| Secrets (gitleaks) | Repository secret leakage | Blocking |
| Trivy SCA | Filesystem vulnerability scan | Blocking on High/Critical |
| Whitelist Verify | Catalog/policy alignment | Blocking in CI |

### Risk tiers

| Tier | Score | Default install policy |
| --- | --- | --- |
| low | 0-24 | allow |
| medium | 25-49 | allow with warning |
| high | 50-74 | block |
| critical | 75-100 | block |

Use `--override-risk` only for explicit risk acceptance.

---

## Configuration Reference

| File | Purpose |
| --- | --- |
| `config/registries.json` | Source registries and adapter mapping |
| `config/providers.json` | Provider policy (enabled, official-only, auth env, polling) |
| `config/security-policy.json` | Scoring weights and install gates |
| `config/ranking-policy.json` | Ranking weights/penalties/tiebreaks |
| `.skills-mcps.json` | Optional local project defaults from `init` |

Remote registry fields:
- `remote.url`
- `remote.format`
- `remote.entryPath`
- `remote.supportsUpdatedSince`
- `remote.updatedSinceParam`
- `remote.pagination`
- `remote.authEnv`
- `remote.fallbackToLocal`

---

## Data Contracts

Primary runtime contracts validated with Zod:
- `CatalogItem`
- `RiskAssessment`
- `Recommendation`
- `InstallAudit`

---

## Backward Compatibility

Legacy ingestion scripts are still available:
- `npm run ingest:skills`
- `npm run ingest:mcps`
- `npm run ingest:claude-plugins`
- `npm run ingest:copilot-extensions`
- `npm run ingest:all`

Validation script compatibility:
- `npm run validate:data` (schema/data contract validation)

---

## Publish Checklist

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run doctor` (must pass required checks, including `skill.sh`)
- Confirm Actions badges are green on `main`

---

## Security and Operations Docs
- `docs/security/threat-model.md`
- `docs/security/scoring.md`
- `docs/ci/daily-quarantine.md`
