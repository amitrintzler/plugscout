# Dependency Ledger

| Package | Purpose | Notes |
| --- | --- | --- |
| `zod` | Runtime schema validation for catalogs, risk reports, and CLI inputs | Enforces strict data contracts for untrusted registry payloads. |
| `fs-extra` | Filesystem utilities for deterministic data writes | Used by sync/report/quarantine workflows. |
| `ts-node` | TypeScript runtime for CLI and workflows | Keeps command entrypoints simple for CI. |
| `vitest` | Unit + integration test framework | Covers recommendation, risk policy, install gating, and quarantine behavior. |
| `eslint` / `@typescript-eslint/*` | Static linting | Enforces coding standards and catches unsafe patterns. |
| `prettier` | Formatting standards | Optional local formatting before PR. |
| `remotion` / `@remotion/cli` / `react` | Optional video walkthrough tooling | Dev-only; not required for packaged CLI installs. |
