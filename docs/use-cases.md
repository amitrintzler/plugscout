# End-to-End Use Cases

## 1) First-Time Onboarding

Command:

```bash
npm run init
```

![Init Wizard](../assets/screenshots/01-init.svg)

## 2) Validate Environment Readiness

Command:

```bash
npm run doctor
```

![Doctor Checks](../assets/screenshots/02-doctor.svg)

## 3) Browse and Search Catalog

Commands:

```bash
npm run list -- --kind mcp --limit 3
npm run search -- security
npm run show -- --id copilot-extension:repo-security
```

![List and Search](../assets/screenshots/03-list-search.svg)

## 4) Generate Safe Recommendations and Export

Commands:

```bash
npm run recommend -- --project . --only-safe --sort trust --limit 5
npm run recommend -- --project . --export csv --out recommendations.csv
```

![Recommendations and Export](../assets/screenshots/04-recommend.svg)

## 5) Enforce Risk Policy Before Install

Commands:

```bash
npm run assess -- --id mcp:remote-browser
npm run install:item -- --id mcp:remote-browser --yes
npm run install:item -- --id mcp:remote-browser --yes --override-risk
```

![Install and Risk Gates](../assets/screenshots/05-install.svg)

## 6) Run Continuous Trust Operations

Commands:

```bash
npm run whitelist:verify
npm run quarantine:apply -- --report data/security-reports/YYYY-MM-DD/report.json
```

![Security Operations](../assets/screenshots/06-security.svg)
