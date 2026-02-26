# Functionality Validation Matrix

Last validated: 2026-02-26

This document validates the four public capability claims in `README.md` with executable evidence.

## Validation Commands and Result

- `npm run verify:claims` -> pass
- `npm run lint` -> pass
- `npm run test` -> pass
- `npm run build` -> pass

## Claim-by-Claim Evidence

| Claim | Code evidence | Test evidence | Workflow evidence | Result | Remediation notes |
| --- | --- | --- | --- | --- | --- |
| Discover Skills, MCP servers, Claude plugins, and Copilot extensions from one place | `src/lib/validation/contracts.ts` (`CatalogKindSchema`), `src/config/runtime.ts` (`loadRegistries`), `src/catalog/sync.ts` (kind normalization/count logging) | `tests/integration/functionality-claims.spec.ts` (`discovers all four ecosystems and supports filtering by kind`), `tests/integration/cli-flow.spec.ts` (`filters recommendations by requested kinds`) | `catalog-sync.yml` publishes per-kind item counts in summary | pass | Added `tests/integration/functionality-claims.spec.ts` to enforce all 4 kinds remain discoverable/filterable. |
| Score candidates using trust-first ranking | `src/recommendation/engine.ts` (`fit + trust + freshness - securityPenalty - blockedPenalty`), `src/interfaces/cli/index.ts` (`--sort score|trust|risk|fit|name`) | `tests/integration/functionality-claims.spec.ts` (`returns trust-first ranking output with score breakdown`), `tests/unit/recommendation.spec.ts` | `ci.yml` runs tests/build on push + PR to keep ranking behavior gated | pass | Added rank reconstruction assertion in claim contract test and `verify:claims` runner. |
| Enforce install gates using whitelist + quarantine policy | `src/install/skillsh.ts` (block/override), `src/security/whitelist.ts` (verify/apply quarantine), `src/recommendation/engine.ts` (blocked by policy/quarantine) | `tests/integration/functionality-claims.spec.ts` (`blocks high-risk install unless override is provided`, `marks quarantined entries as blocked in recommendations`), `tests/integration/cli-flow.spec.ts` | `daily-security.yml` runs whitelist verify + quarantine apply on schedule | pass | Added deterministic in-memory quarantine contract assertion to avoid flaky file races. |
| Run continuous checks in CI and scheduled workflows | `.github/workflows/ci.yml`, `.github/workflows/daily-security.yml`, `.github/workflows/catalog-sync.yml`, `.github/workflows/security-*.yml` | `tests/unit/workflow-contracts.spec.ts` validates required triggers and expected schedule cron lines | Schedules present: catalog sync (`0 2 * * *`), daily security (`12 3 * * *`), codeql (`30 2 * * 1`), sbom+trivy (`45 2 * * 1`) | pass | Added workflow contract tests and `verify:claims` script to continuously enforce trigger/schedule contracts. |

## Additional Status Visibility Remediation

Issue observed: README top lost embedded operational status badges.

Implemented:
- Restored embedded status badges in `README.md` for:
  - Daily Security
  - Security / CodeQL
  - Dependency Review
  - Secrets
  - SBOM + Trivy
  - Catalog Sync

This restores status visibility while keeping the concise product README layout.
