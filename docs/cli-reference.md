# CLI Reference

All commands are exposed as npm scripts and run through `src/cli.ts`.

Toolkit scope order is: Claude plugins, Claude connectors, Copilot extensions, Skills, MCP servers.

Packaged CLI behavior:

- `toolkit` with no arguments opens the home screen.
- `toolkit upgrade check` performs a release check against GitHub Releases.
- `toolkit web --open` writes a readable browser report and opens it.
- `--no-update-check` disables the daily automatic update check for the current command run.

## Core Operations

- `npm run about`
- `npm run status [-- --verbose]`
- `npm run sync [-- --kind skill,mcp,claude-plugin,claude-connector,copilot-extension] [-- --dry-run]`

## Guided Setup and Diagnostics

- `npm run init [-- --project .]`
- `npm run doctor [-- --project .]`
- `npm run doctor -- --project . --install-deps`
- `init` default kinds include `skill,mcp,claude-plugin,claude-connector,copilot-extension`
- `riskPosture=strict` makes `list` and `recommend` default to safe-only views
- `doctor --install-deps` bootstraps the supported `skills` CLI when it is missing
- supported legacy MCP installs now prefer direct `npm install -g` or `docker pull` when the target is unambiguous

## Catalog Discovery and Inspection

- `npm run list -- --kind mcp --limit 10`
- `npm run list -- --kind claude-plugin --limit 20` (includes source, catalog type, confidence columns)
- `npm run list -- --kind claude-connector --limit 20` (separate Claude Connectors catalog)
- `npm run list -- --kind claude-plugin --limit 20 --readable` (wrapped wide table mode)
- `npm run list -- --kind claude-plugin --limit 10 --details` (per-item decision evidence: trust/risk/provenance/install)
- `npm run search -- security`
- `npm run explain -- --limit 20`
- `npm run explain -- --kind mcp --format json`
- `npm run scan -- --project . --format table`
- `npm run scan -- --project . --format json --out scan-report.json`
- `npm run show -- --id mcp:filesystem`
- `npm run show -- --id claude-connector:asana` (prints provenance source/sourcePage when present)
- `npm run top -- --project . --limit 5`
- `npm run top -- --project . --limit 5 --details` (score equation + block reason + install hint per item)

## Recommendation and Export

- `npm run recommend -- --project . --format table`
- `npm run recommend -- --project . --only-safe --sort trust --limit 10 --explain-scan`
- `npm run recommend -- --project . --only-safe --sort trust --limit 10 --details`
- `npm run recommend -- --project . --llm --explain-scan`
- `npm run recommend -- --project . --export csv --out recommendations.csv`
- `npm run recommend -- --project . --export md --out recommendations.md`

## Risk and Installation Controls

- `npm run assess -- --id mcp:remote-browser`
- `npm run install:item -- --id mcp:filesystem --yes --install-deps`
- `npm run install:item -- --id mcp:remote-browser --yes --override-risk`
- `npm run install:item -- --id skill:playwright --yes --install-deps`

## Security Operations

- `npm run whitelist:verify`
- `npm run quarantine:apply -- --report data/security-reports/YYYY-MM-DD/report.json`

## Version and Upgrade Checks

- `toolkit upgrade check`
- `toolkit recommend --project . --no-update-check`
- `toolkit status --no-update-check`

## Web Report

- `toolkit web --out .toolkit/report.html`
- `toolkit web --kind claude-connector --limit 200 --open` (includes score legend + decision cards per item)

## Legacy Ingestion and Validation

- `npm run validate:data`
- `npm run ingest:skills`
- `npm run ingest:mcps`
- `npm run ingest:claude-plugins`
- `npm run ingest:copilot-extensions`
- `npm run ingest:all`
