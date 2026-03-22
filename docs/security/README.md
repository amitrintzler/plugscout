# Security Notes

<p>
  <a href="https://github.com/amitrintzler/plugscout/actions/workflows/daily-security.yml"><img alt="Daily Security" src="https://github.com/amitrintzler/plugscout/actions/workflows/daily-security.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/plugscout/actions/workflows/security-codeql.yml"><img alt="Security / CodeQL" src="https://github.com/amitrintzler/plugscout/actions/workflows/security-codeql.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/plugscout/actions/workflows/security-dependency-review.yml"><img alt="Dependency Review" src="https://img.shields.io/badge/dependency%20review-PR%20only-2563eb" /></a>
  <a href="https://github.com/amitrintzler/plugscout/actions/workflows/security-secrets.yml"><img alt="Secrets Scan" src="https://img.shields.io/badge/secrets-gitleaks-ef4444" /></a>
  <a href="https://github.com/amitrintzler/plugscout/actions/workflows/security-sbom-trivy.yml"><img alt="SBOM + Trivy" src="https://img.shields.io/badge/SBOM%20%2B%20Trivy-enabled-0ea5e9" /></a>
  <a href="https://github.com/amitrintzler/plugscout/actions/workflows/catalog-sync.yml"><img alt="Catalog Sync" src="https://img.shields.io/badge/catalog%20sync-scheduled-0ea5e9" /></a>
</p>

Toolkit enforces a trust-first model with policy gates, whitelist verification, and quarantine controls.

## Core Principles

- Never commit secrets; keep credentials in `.env.local` or GitHub Actions secrets.
- Use `config/security-policy.json` for risk thresholds and gate behavior.
- Keep daily whitelist verification reports in `data/security-reports/`.
- Treat quarantine state as authoritative for blocking recommendations/installs.
- Review and rotate signing/integrity controls quarterly.

## Policy Gates

| Tier | Score | Default install policy |
| --- | --- | --- |
| low | 0-24 | allow |
| medium | 25-49 | allow with warning |
| high | 50-74 | block |
| critical | 75-100 | block |

Use `--override-risk` only for explicit risk acceptance.

## Source Trust Tiers

Toolkit attaches source-confidence metadata and penalties during ranking:

- `official`: vendor/public-index feeds (no extra source penalty).
- `vetted-curated`: curated community manifests (small trust penalty).
- `scraped`: connector scrape-derived entries (extra trust penalty + stricter review expectations).

Additional safeguards for scrape-enabled plugin ingestion:

- Host allowlist for plugin/MCP remotes.
- HTTPS URL enforcement.
- Input sanitization and duplicate ID rejection.
- Fallback to local/last-good data when remote fetch/parsing fails.

Copilot app-type extension deprecation context:

- GitHub announced app-type Copilot extensions deprecation on September 4, 2025.
- Toolkit currently ingests marketplace manifests and marks provenance so teams can govern migration risk explicitly.

## Related Docs

- Scoring details: [`scoring.md`](scoring.md)
- Threat model: [`threat-model.md`](threat-model.md)
- Daily quarantine automation: [`../ci/daily-quarantine.md`](../ci/daily-quarantine.md)
