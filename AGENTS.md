# PlugScout — Contributor & Agent Guidelines

## Quick orientation

PlugScout is a Node.js CLI (`@shnitzel/plugscout`) that discovers, scores, and safely installs Claude plugins, Claude connectors, Copilot extensions, Cursor extensions, Gemini extensions, Skills, and MCP servers. Written in TypeScript, targeting Node ≥ 18, using ES modules throughout.

```
npm install          # install deps
npm run build        # tsc → dist/
npm run test         # vitest run (all suites)
npm run lint         # eslint --ext .ts
node dist/cli.js     # run the built CLI
```

A pre-push hook runs lint + tests + build. Fix all three before pushing.

---

## Repository layout

```
src/
  catalog/
    adapters/        # one file per registry adapter (e.g. mcp-v1.ts)
    adapter.ts       # dispatches registry → adapter by registry.adapter field
    repository.ts    # loadCatalogItems(), loadQuarantine(), loadWhitelist()
    sync.ts          # syncCatalogs() — fetch remote registries + write cache
    sync-state.ts    # per-registry lastSuccessfulSyncAt
    remote-registry.ts
  config/
    runtime.ts       # loadSecurityPolicy(), loadRegistries(), loadItemInsights()
  install/           # install workflow (dependencies, review-state, skillsh)
  interfaces/
    cli/
      index.ts       # CLI entry point — all command handlers live here
      doctor.ts      # plugscout doctor checks
      client-setup.ts # plugscout client setup (cursor/gemini/claude-desktop/…)
      mcp.ts         # MCP server implementation
      update-check.ts # auto-update via GitHub Releases API
      options.ts     # flag parsing, kind aliases
      output.ts      # printHint(), printJson()
      formatters/    # colors.ts, table.ts, csv.ts, json.ts, markdown.ts
      ui/
        home.ts      # renderHomeScreen(), renderInteractiveHome()
        web-report.ts # plugscout web — generates static HTML report
  lib/
    validation/
      contracts.ts   # ALL Zod schemas and TypeScript types (source of truth)
    paths.ts         # getPackagePath(), getStatePath()
    json.ts          # readJsonFile(), writeJsonFile()
    logger.ts
  recommendation/
    engine.ts        # recommend() — scoring + ranking
    project-analysis.ts # detectProjectSignals()
    requirements.ts
  security/
    assessment.ts    # buildAssessment(), assessRisk()
    whitelist.ts     # verifyWhitelist(), applyQuarantineFromReport()

config/
  registries.json    # all registry definitions (inline entries + remote URLs)
  providers.json     # provider trust levels
  security-policy.json
  item-insights.json # enriched "what it does / best for / tradeoffs" per item

assets/cli/
  logo.txt           # wide terminal ASCII art
  logo-compact.txt   # narrow terminal fallback (<82 cols)

tests/
  unit/              # *.spec.ts — pure logic, no filesystem
  integration/       # *.spec.ts — real catalog + CLI flows with temp dirs
```

---

## Catalog kinds

The exhaustive union is defined once in `src/lib/validation/contracts.ts`:

```typescript
export const CatalogKindSchema = z.enum([
  'skill', 'mcp', 'claude-plugin', 'claude-connector',
  'copilot-extension', 'cursor-extension', 'gemini-extension'
]);
```

**Any time you add a new kind you must update ALL of these or the build will fail:**

1. `contracts.ts` — add to `CatalogKindSchema`
2. `contracts.ts` — add to `RegistrySchema.adapter` z.enum
3. A new adapter file in `src/catalog/adapters/`
4. `src/catalog/adapter.ts` — dispatch branch
5. `src/catalog/sync.ts` — `normalizeId()` prefixMap + `countByKind()` zero-initializer
6. `src/catalog/remote-registry.ts` — `defaultCatalogKeyByKind()`
7. `src/interfaces/cli/options.ts` — KIND_ALIASES
8. `src/interfaces/cli/index.ts` — defaultKinds arrays
9. `src/interfaces/cli/ui/web-report.ts` — `countByKind()` zero-initializer + stat card + filter option
10. `config/registries.json` — at least one registry entry for the new kind
11. `config/providers.json` — provider entry if new provider

`Record<CatalogKind, T>` is used in several places and TypeScript enforces exhaustiveness. If you see a "Property X is missing in type" error, grep for `Record<CatalogKind` and add the new kind to each.

---

## Adding catalog entries

The simplest contribution: add entries to an existing registry in `config/registries.json`. Each entry must satisfy `CatalogEntrySchema` (see `contracts.ts`). Key fields:

```json
{
  "id": "mcp:my-tool",
  "name": "My Tool",
  "description": "One line, factual.",
  "capabilities": ["search", "read-files"],
  "compatibility": ["node", "python"],
  "install": { "kind": "skill.sh", "target": "mcp:my-tool", "args": [] },
  "lastSeenAt": "2025-06-01",
  "securitySignals": {}
}
```

`lastSeenAt` must match `^(19|20|21)\d{2}-[01]\d-[0-3]\d$`. `securitySignals: {}` is valid — Zod fills zeros via `.default(0)`.

After editing `registries.json`, run `node dist/cli.js sync` to rebuild the local cache, then verify with `node dist/cli.js status`.

---

## Adding a new adapter

Copy the closest existing adapter (e.g. `src/catalog/adapters/copilot-extensions-v0.1.ts`). Import shared helpers from `./shared.js`:

```typescript
import { readString, extractStringArray, dedupe, toScore, toCount } from './shared.js';
```

Export a single `adaptXxxEntries(sourceId: string, entries: unknown[]): CatalogItem[]` function. The adapter must validate each entry defensively — bad entries should be skipped, not thrown.

Register it in `adapter.ts`:
```typescript
if (registry.adapter === 'my-adapter-v1') {
  return adaptMyAdapterEntries(registry.id, registry.entries);
}
```

---

## CLI architecture

All command handlers live in `src/interfaces/cli/index.ts`. The dispatch loop is a `switch` on a normalized command string. To add a command:

1. Add alias(es) to `COMMAND_ALIASES`
2. Add `case 'mycommand': await handleMyCommand(rest); break;`
3. Write `async function handleMyCommand(args: string[]): Promise<void>`
4. Add to `printHelp()`

Flag parsing utilities (`readFlag`, `hasFlag`, `readKinds`, `readLimit`) are in `options.ts`. Use them; don't parse `args` manually.

---

## Web report

`src/interfaces/cli/ui/web-report.ts` generates a self-contained static HTML file. Key constraints:

- Stat card counts come from `allFiltered` (full catalog before slice), not `rows` (the sliced page). The `limit` option only controls what cards are rendered, not what counts are shown.
- Install commands are rendered with a copy-to-clipboard button. Every card also shows a `plugscout install --id X --yes` CTA.
- Card headers are `<button>` elements with `aria-expanded` — keep them accessible.
- Kind stat cards are clickable to filter. `setKindFilter()` in the inline script handles this.

---

## Security rules

- All external inputs (remote registry entries, user flags) validated through Zod schemas in `contracts.ts` before touching business logic.
- Never commit `.env` files, tokens, or credentials.
- The safe-host allowlist in `remote-registry.ts` (`requiresSafeHostAllowlist`) must be updated when adding registries that fetch from new domains.
- `config/security-policy.json` controls install gates. High and critical risk items are blocked by default.

---

## Commit conventions

- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`
- Do **not** include `Co-Authored-By` trailers
- Keep commits focused — one logical change per commit
- CI bumps the patch version automatically on merge to main; do not bump manually

---

## Testing guidelines

- Unit tests in `tests/unit/` — mock the filesystem via `vi.mock` or use in-memory fixtures, no real network calls
- Integration tests in `tests/integration/` — use real catalog data from temp dirs; the test helpers in `tests/helpers/` provide `createTempDir()` and fixture loaders
- Name tests descriptively: `it('returns ranked results with risk metadata')`, not `it('works')`
- Run `npm run test` before every push; the pre-push hook does the same

---

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `Property 'X' is missing in type 'Record<CatalogKind, …>'` | New kind not added to all exhaustive maps | See "Catalog kinds" section above |
| `ZodError: Expected enum value` | `registries.json` adapter name doesn't match `RegistrySchema.adapter` enum | Add to both `contracts.ts` and `registries.json` consistently |
| Stat card shows 0 for a kind | Catalog not synced after editing `registries.json` | Run `node dist/cli.js sync` |
| Web report stat cards show wrong counts | Using `rows` instead of `allItems` in `countByKind` | Pass `allItems` (pre-slice) to `renderHtml` |
| Pre-push hook fails on lint | `while(true)` or unused vars | Use `let running = true; while(running)` pattern; prefix unused params with `_` |
