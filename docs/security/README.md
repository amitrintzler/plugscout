# Security Notes

<p>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml"><img alt="Daily Security" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/daily-security.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml"><img alt="Security / CodeQL" src="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-codeql.yml/badge.svg?branch=main" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-dependency-review.yml"><img alt="Dependency Review" src="https://img.shields.io/badge/dependency%20review-PR%20only-2563eb" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-secrets.yml"><img alt="Secrets Scan" src="https://img.shields.io/badge/secrets-gitleaks-ef4444" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/security-sbom-trivy.yml"><img alt="SBOM + Trivy" src="https://img.shields.io/badge/SBOM%20%2B%20Trivy-enabled-0ea5e9" /></a>
  <a href="https://github.com/amitrintzler/skills-and-mcps/actions/workflows/catalog-sync.yml"><img alt="Catalog Sync" src="https://img.shields.io/badge/catalog%20sync-scheduled-0ea5e9" /></a>
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

## Related Docs

- Scoring details: [`scoring.md`](scoring.md)
- Threat model: [`threat-model.md`](threat-model.md)
- Daily quarantine automation: [`../ci/daily-quarantine.md`](../ci/daily-quarantine.md)
