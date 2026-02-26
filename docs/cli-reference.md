# CLI Reference

All commands are exposed as npm scripts and run through `src/cli.ts`.

## Core Operations

- `npm run about`
- `npm run status [-- --verbose]`
- `npm run sync [-- --kind skill,mcp,claude-plugin,copilot-extension] [-- --dry-run]`

## Guided Setup and Diagnostics

- `npm run init [-- --project .]`
- `npm run doctor [-- --project .]`

## Catalog Discovery and Inspection

- `npm run list -- --kind mcp --limit 10`
- `npm run search -- security`
- `npm run explain -- --limit 20`
- `npm run explain -- --kind mcp --format json`
- `npm run scan -- --project . --format table`
- `npm run scan -- --project . --format json --out scan-report.json`
- `npm run show -- --id mcp:filesystem`
- `npm run top -- --project . --limit 5`

## Recommendation and Export

- `npm run recommend -- --project . --format table`
- `npm run recommend -- --project . --only-safe --sort trust --limit 10 --explain-scan`
- `npm run recommend -- --project . --llm --explain-scan`
- `npm run recommend -- --project . --export csv --out recommendations.csv`
- `npm run recommend -- --project . --export md --out recommendations.md`

## Risk and Installation Controls

- `npm run assess -- --id mcp:remote-browser`
- `npm run install:item -- --id mcp:filesystem --yes`
- `npm run install:item -- --id mcp:remote-browser --yes --override-risk`

## Security Operations

- `npm run whitelist:verify`
- `npm run quarantine:apply -- --report data/security-reports/YYYY-MM-DD/report.json`

## Legacy Ingestion and Validation

- `npm run validate:data`
- `npm run ingest:skills`
- `npm run ingest:mcps`
- `npm run ingest:claude-plugins`
- `npm run ingest:copilot-extensions`
- `npm run ingest:all`
