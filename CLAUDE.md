# PlugScout — Claude Code Project Instructions

## Model usage
- Planning (EnterPlanMode, architecture decisions, writing implementation plans) → use **Opus**
- All implementation (editing files, writing code, running tasks) → use **Sonnet**

## Repo identity
```
pwd → /Users/amitri/Projects/skills-and-mcps
package → @shnitzel/plugscout
main branch → main
```
Verify with `git remote -v` before making cross-repo assumptions.

## Mandatory workflow
After **any** change to `config/registries.json`:
```bash
npm run build && node dist/cli.js sync && node dist/cli.js status
```
The sync rebuilds `~/.plugscout/data/catalog/items.json`. Without it, tests run against stale data and stat card counts will be wrong.

After **any** code change:
```bash
npm run build   # must pass with zero TS errors
npm run lint    # eslint, zero errors
npm run test    # vitest run, all 119 tests green
```
The pre-push hook does the same but failing locally wastes a push attempt.

## CatalogKind exhaustiveness — the #1 source of build failures
`Record<CatalogKind, T>` is exhaustive in TypeScript. Adding a new kind requires updating **all** of these files — missing any one breaks the build:

1. `src/lib/validation/contracts.ts` — `CatalogKindSchema` enum + `RegistrySchema.adapter` enum
2. `src/catalog/adapters/<new-kind>.ts` — new adapter file
3. `src/catalog/adapter.ts` — dispatch branch
4. `src/catalog/sync.ts` — `normalizeId()` prefixMap + `countByKind()` zero-init
5. `src/catalog/remote-registry.ts` — `defaultCatalogKeyByKind()`
6. `src/interfaces/cli/options.ts` — `KIND_ALIASES`
7. `src/interfaces/cli/index.ts` — `defaultKinds` arrays (3 places)
8. `src/interfaces/cli/ui/web-report.ts` — `countByKind()` zero-init + stat card + filter `<option>`
9. `config/registries.json` — at least one registry entry
10. `config/providers.json` — provider entry if new

## Key invariants — never break these
- **Stat card counts** in the web report must come from `allFiltered` (full catalog, pre-slice), not from `rows` (the limit-truncated page). See `writeWebReport()` in `web-report.ts`.
- **Card headers** in the web report are `<button>` with `aria-expanded`. Do not revert to `<div>`.
- **Install hints** on web report cards must have a copy-to-clipboard button.
- **`Record<CatalogKind, T>`** zero-initializers must list all 7 current kinds.

## Commit rules
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
- **No `Co-Authored-By` trailers** in any commit message
- Do **not** bump `version` in `package.json` — CI does this automatically on merge
- One logical change per commit

## Scope discipline
- Rename/label change request → default to UI text only, confirm before code refactor
- Bug fix → fix only the bug, no surrounding cleanup unless asked
- When updating `AGENTS.md` or `docs/` → never drop existing sections without explicit confirmation

## PR and merge rules
- Always confirm base branch is `main` before merging: `gh pr view <num> --json baseRefName`
- Non-fast-forward push → `git pull --rebase origin main && git push`

## Files to read first on a new task
| Task area | Start with |
|---|---|
| Adding a catalog kind | `src/lib/validation/contracts.ts`, `src/catalog/adapter.ts` |
| CLI command changes | `src/interfaces/cli/index.ts` (handlers), `src/interfaces/cli/options.ts` |
| Scoring / ranking | `src/recommendation/engine.ts`, `config/ranking-policy.json` |
| Risk / security | `src/security/assessment.ts`, `config/security-policy.json` |
| Web report | `src/interfaces/cli/ui/web-report.ts` |
| Doctor checks | `src/interfaces/cli/doctor.ts` |
| MCP client setup | `src/interfaces/cli/client-setup.ts` |
