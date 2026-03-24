# Onboarding, API, and MCP Server Design

## Goal

Add three capabilities to PlugScout: an interactive home screen with first-run detection, a programmatic API surface for developers, and an MCP server that exposes the catalog to AI assistants with human-in-the-loop install confirmation.

## Architecture

The three features share a common API layer (`src/api/index.ts`) that re-exports core functions already implemented in the CLI. The home screen consumes the API layer for state detection. The MCP server consumes the API layer for all tool implementations. No new business logic is added — only new surfaces over existing logic.

**Tech Stack:** TypeScript, Node.js `readline` (built-in, no new UI framework), raw ANSI escape codes for arrow-key menu navigation (same pattern as existing terminal output), `@modelcontextprotocol/sdk` (new dependency — see Section 3)

**New npm dependencies:**
- `@modelcontextprotocol/sdk` — MCP server runtime (production dependency)

No new UI framework (Ink, Inquirer.js) is added. The interactive menu uses Node's built-in `readline` with raw mode and ANSI sequences, consistent with the existing plain-text terminal approach in `src/interfaces/cli/`.

---

## Section 1: API Layer

### Purpose

Allow developers to import PlugScout functions directly in their own scripts or applications without shelling out to the CLI.

### Package exports

Add an `exports` field to `package.json` (the existing `"main"` field stays for CommonJS fallback):

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./api": {
      "import": "./dist/api/index.js",
      "types": "./dist/api/index.d.ts"
    }
  }
}
```

The `dist/` directory is already in `files` — no change needed to include the generated `.d.ts` files.

### `src/api/index.ts`

Re-exports the following functions with stable, documented signatures. All return plain data objects — no `process.exit`, no `console.log`.

| Export | Wraps | Source file |
|--------|-------|-------------|
| `detectProjectSignals(dir, opts?)` | `detectProjectSignals` | `src/recommendation/project-analysis.ts` |
| `recommend(options)` | `recommend` | `src/recommendation/engine.ts` |
| `assessRisk(item)` | `assessRisk` | `src/security/assessment.ts` |
| `buildAssessment(item, policy)` | `buildAssessment` | `src/security/assessment.ts` |
| `searchCatalog(query, opts?)` | extracted from `computeSearchScore` (see below) | `src/interfaces/cli/index.ts` → new `src/catalog/search.ts` |
| `loadCatalogItems()` | `loadCatalogItems` | `src/catalog/repository.ts` |
| `loadCatalogItemById(id)` | `loadCatalogItemById` | `src/catalog/repository.ts` |
| `syncCatalogs(options?)` | `syncCatalogs` | `src/catalog/sync.ts` |
| `loadSecurityPolicy()` | `loadSecurityPolicy` | `src/config/runtime.ts` |
| `isSetUp()` | new function (see below) | `src/api/index.ts` |

**`searchCatalog` extraction:** The `computeSearchScore` function in `src/interfaces/cli/index.ts` is private. As part of this work, extract it to `src/catalog/search.ts` as an exported function. The `searchCatalog(query, opts?)` API function wraps it, filters catalog items by score > 0, and returns sorted results.

**`isSetUp()` implementation:**

```typescript
import fsExtra from 'fs-extra';
import { getPackagePath } from '../lib/paths.js';

export async function isSetUp(): Promise<boolean> {
  const configPath = getPackagePath('config/sources.json');
  return fsExtra.pathExists(configPath);
}
```

**No `hasPriorScan()` function.** There is no persistent scan history on disk. The home screen state distinction is binary: set-up or not set-up. State 3 (operational) is determined solely by `isSetUp()` returning true AND catalog items being present (i.e., `loadCatalogItems()` returns a non-empty array). See Section 2 for updated state logic.

### TypeScript types re-exported

Re-export the following from `src/lib/validation/contracts.ts` through `src/api/index.ts` (type-only re-exports):

```typescript
export type {
  CatalogItem,
  CatalogKind,
  RiskAssessment,
  RiskTier,
  Recommendation,
  SecurityPolicy,
  RankingPolicy,
  ProjectSignals,   // from src/recommendation/project-analysis.ts
} from '../lib/validation/contracts.js';
```

`ProjectSignals` comes from `src/recommendation/project-analysis.ts` (not contracts.ts) — import it separately and re-export.

**No `PlugScoutTypes` namespace.** Just direct named type exports — simpler and idiomatic TypeScript.

**`PlugScoutError`:** Introduce in `src/api/errors.ts`:

```typescript
export class PlugScoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PlugScoutError';
  }
}
```

API functions throw `PlugScoutError` instead of generic `Error` so consumers can distinguish PlugScout errors from unexpected failures.

---

## Section 2: Interactive Home Screen

### Purpose

When the user runs `plugscout` with no arguments, display an interactive arrow-key menu so new users immediately know what to do next.

### State detection

State is determined by two sequential checks at startup:

1. `await isSetUp()` — checks if `config/sources.json` exists
2. If set up: `(await loadCatalogItems()).length > 0` — checks if any catalog items are loaded

**State 1 — Not set up** (config file missing):

```
PlugScout v0.3.4

  Welcome! Looks like this is your first time.

  ❯ Run setup now
        Installs prerequisites, writes config, syncs all catalogs
        → plugscout setup  (takes ~30 seconds)

    Exit
```

**State 2 — Set up, no catalog items** (config exists, catalog empty — e.g., sync not yet run):

```
PlugScout v0.3.4  ✓ Config loaded  ⚠ Catalog empty

  ❯ Scan my project
        Detect your stack and list matching plugins, MCPs, and extensions
        → plugscout scan --project . --format table

    Get recommendations
        Top safe picks ranked by fit + trust for your current directory
        → plugscout recommend --project . --only-safe --limit 10

    Open web report
        Generate a readable HTML report with score cards — opens in browser
        → plugscout web --open

    Check system health
        Verify prerequisites, catalog freshness, and config validity
        → plugscout doctor

    Exit
```

**State 3 — Operational** (config exists + catalog has items):

```
PlugScout v0.3.4  ✓ Catalogs: <N> items

  ❯ Scan my project
        Re-scan your repo and refresh match scores
        → plugscout scan --project . --format table

    Get recommendations
        Top safe picks ranked by fit + trust for your current directory
        → plugscout recommend --project . --only-safe --limit 10

    Inspect an item
        Show full risk profile, trust score, and install instructions
        → plugscout show --id <id>  (prompts for ID)

    Assess before installing
        Evaluate one candidate in detail — risk, policy, provenance
        → plugscout assess --id <id>  (prompts for ID)

    Install an item
        Policy-gated install; blocks high/critical risk by default
        → plugscout install --id <id> --yes  (prompts for ID)

    Sync catalogs
        Pull latest entries from all configured registries
        → plugscout sync

    Open web report
        Readable HTML with score legend and decision cards — opens in browser
        → plugscout web --open

    Check system health
        Verify prerequisites, catalog freshness, and config validity
        → plugscout doctor

    Exit
```

### Implementation

**No Ink, no Inquirer.js.** The interactive menu uses Node's `readline` in raw mode:

```typescript
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', handleKeypress);
```

Arrow keys emit `\u001b[A` (up) and `\u001b[B` (down). Enter emits `\r`. The menu re-renders in place using `\x1b[<N>A` (cursor up) + `\x1b[2K` (clear line) sequences.

- Non-TTY environments (e.g., pipes, CI): fall back to the existing `renderHomeScreen()` plain-text output from `src/interfaces/cli/ui/home.ts` — no interactive mode.
- Items that need an ID (show, assess, install) switch to a text input prompt using `readline.createInterface` before spawning the command.
- Selected option spawns the corresponding command via `child_process.spawn` with `stdio: 'inherit'` so output is visible in the same terminal.

**File:** The existing `src/interfaces/cli/ui/home.ts` is **extended** (not replaced):
- `renderHomeScreen()` remains for non-TTY / plain-text use
- New export `renderInteractiveHome()` handles TTY interactive mode
- `src/interfaces/cli/index.ts` calls `renderInteractiveHome()` when `process.stdout.isTTY`, otherwise falls back to `renderHomeScreen()`

### CLI router change

In `src/interfaces/cli/index.ts`, the existing `case ''` (no-args) branch already calls `renderHomeScreen()`. Change it to:

```typescript
case '': {
  if (process.stdout.isTTY) {
    await renderInteractiveHome();
  } else {
    const screen = await renderHomeScreen();
    process.stdout.write(screen + '\n');
  }
  return;
}
```

---

## Section 3: MCP Server

### Purpose

Expose the PlugScout catalog as MCP tools so AI assistants (Claude Desktop, Cursor, etc.) can search, browse, and propose installs. Human confirmation is required before any install executes.

### New dependency

Add to `package.json` `dependencies`:

```json
"@modelcontextprotocol/sdk": "^1.0.0"
```

Use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`.

### Registration

Users add to their MCP config file (e.g., `~/.claude.json`, `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "plugscout": {
      "command": "plugscout",
      "args": ["mcp"]
    }
  }
}
```

`plugscout mcp` starts a stdio MCP server.

### CLI router change

In `src/interfaces/cli/index.ts`:
1. Add `'mcp'` to `COMMAND_ALIASES`
2. Add `case 'mcp':` branch that imports and calls `handleMcp(rest)`

New file: **`src/interfaces/cli/mcp.ts`** (following existing convention — interface-layer files live in `src/interfaces/cli/`).

### Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `search_catalog` | `query: string, type?: string, provider?: string, limit?: number` | `CatalogItem[]` filtered by relevance score |
| `get_item` | `id: string` | Full `CatalogItem` or error if not found |
| `assess_item` | `id: string` | `RiskAssessment` with `tier`, `blocked`, `reasons[]`, `install_allowed` |
| `install_item` | `id: string` | See human-in-the-loop flow below |
| `sync_catalogs` | _(none)_ | `{ items_loaded: number, sources_updated: number, errors: string[] }` |

All tools are implemented by calling the API layer functions from Section 1.

### Human-in-the-loop install

The MCP server uses stdio transport, which means **stdin and stdout are owned by the MCP protocol layer** — they cannot be used for user confirmation prompts.

Instead, `install_item` reads from and writes to `/dev/tty` directly (Linux/macOS) or the console device on Windows:

```typescript
import { createReadStream, createWriteStream } from 'node:fs';

const tty = createWriteStream('/dev/tty');
const ttyIn = createReadStream('/dev/tty');

tty.write(`\nPlugScout install requested by AI assistant\n`);
tty.write(`Item: ${item.id} (risk: ${assessment.tier}/${item.securityScore})\n`);
tty.write(`Install command: ${installCmd}\n`);
tty.write(`Confirm? [y/N]: `);
// read one line from ttyIn...
```

Flow:
1. AI calls `install_item` with an `id`
2. MCP server loads the item, runs `assessRisk`, checks policy
3. If blocked (high/critical risk): skip prompt entirely, return `{ status: "blocked", detail: "risk tier: <tier>" }`
4. If install allowed: write confirmation prompt to `/dev/tty`, read response
5. Timeout after 60 seconds → return `{ status: "cancelled", detail: "timeout" }`
6. User types `y` → run install, return `{ status: "installed" }`
7. User types anything else → return `{ status: "cancelled" }`

### Policy enforcement

- `search_catalog`, `get_item`, `assess_item`, `sync_catalogs`: no restrictions
- `install_item`: blocked-tier items cannot be installed regardless of user input

---

## Error Handling

- All API layer functions throw `PlugScoutError` (from `src/api/errors.ts`) for domain errors, not generic `Error`
- Home screen catches errors from state detection and falls back to plain-text `renderHomeScreen()` output
- MCP tools return structured MCP error responses per SDK spec — no unhandled promise rejections
- `install_item`: 60-second `/dev/tty` read timeout returns `{ status: "cancelled", detail: "timeout" }`
- `searchCatalog`: if the extracted `computeSearchScore` is unavailable, returns empty array rather than throwing

---

## Testing

- **API layer:** Unit tests in `src/api/__tests__/api.test.ts` — verify each export returns the correct shape, throws `PlugScoutError` on bad input, and produces no console output or `process.exit` calls
- **`isSetUp()`:** Unit test with a temp directory (file exists → true, missing → false)
- **`searchCatalog`:** Unit test extracted `computeSearchScore` function with fixture items
- **Home screen:** Unit tests for `renderInteractiveHome()` state detection logic; integration test verifying the correct menu items appear per state
- **MCP server:** Integration tests using the `@modelcontextprotocol/sdk` in-process client/server pattern — instantiate `StdioServerTransport` with piped streams, call each tool, verify responses; `install_item` tested with a mocked `/dev/tty` write stream
