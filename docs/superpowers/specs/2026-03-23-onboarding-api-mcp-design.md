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
| `syncCatalogs(options?)` | wraps `syncCatalogs` (see note below) | `src/catalog/sync.ts` |
| `loadSecurityPolicy()` | `loadSecurityPolicy` | `src/config/runtime.ts` |

**`syncCatalogs` wrapper note:** The underlying `syncCatalogs` in `src/catalog/sync.ts` has the signature `syncCatalogs(today?, options?)` where `today` is an internal override used for testing. The API wrapper omits `today` and exposes only `options?`:

```typescript
import { syncCatalogs as _syncCatalogs, type SyncCatalogOptions } from '../catalog/sync.js';

export async function syncCatalogs(options?: SyncCatalogOptions) {
  return _syncCatalogs(undefined, options);
}
```

The underlying function returns `{ items: CatalogItem[], staleRegistries: string[] }`. The API wrapper re-exports this shape as-is.

**`searchCatalog` extraction:** The `computeSearchScore` function in `src/interfaces/cli/index.ts` is private. As part of this work, extract it to `src/catalog/search.ts` as an exported function. The `searchCatalog(query, opts?)` API function wraps it, filters catalog items by score > 0, and returns sorted results.

After extraction, update the existing `handleSearch()` in `src/interfaces/cli/index.ts` to call `searchCatalog(query, { limit: 20 })` instead of the old private function — this preserves the current 20-result cap in the CLI command.

`opts` type: `{ kind?: CatalogKind; provider?: string; limit?: number }`. Filtering by `kind` and `provider` is applied after scoring; `limit` caps the returned array. If no opts are provided, all matching items are returned.

### `isSetUp()` — determining first-run state

`isSetUp()` is defined in `src/api/index.ts` and determines whether `plugscout setup` has been run. The setup command syncs catalogs and writes catalog data to disk at `getStatePath('data/catalog/items.json')` (via `loadCatalogItems()` / `saveCatalogItems()` in `src/catalog/repository.ts`). This file does **not** exist before setup. It is a runtime-state file, not a bundled file.

```typescript
import fsExtra from 'fs-extra';
import { getStatePath } from '../lib/paths.js';

export async function isSetUp(): Promise<boolean> {
  const itemsPath = getStatePath('data/catalog/items.json');
  return fsExtra.pathExists(itemsPath);
}
```

This means `isSetUp()` and `(await loadCatalogItems()).length > 0` are closely related — both check presence of catalog data. The two-state split is:
- `isSetUp() === false` → State 1 (no catalog file at all)
- `isSetUp() === true` but items empty → State 2 (file exists but empty — unlikely in normal operation, but handled gracefully)
- `isSetUp() === true` and items present → State 3 (operational)

### TypeScript types re-exported

Re-export from `src/api/index.ts` (type-only re-exports):

```typescript
export type {
  CatalogItem,
  CatalogKind,
  RiskAssessment,
  RiskTier,
  Recommendation,
  SecurityPolicy,
  RankingPolicy,
} from '../lib/validation/contracts.js';

export type { ProjectSignals } from '../recommendation/project-analysis.js';
export type { SyncCatalogOptions } from '../catalog/sync.js';
```

(`SyncCatalogOptions` is exported from `src/catalog/sync.ts` only — it does **not** exist in `contracts.ts`. `ProjectSignals` is from `src/recommendation/project-analysis.ts`. No changes to `contracts.ts` are needed.)

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

1. `await isSetUp()` — checks if `getStatePath('data/catalog/items.json')` exists
2. If set up: `(await loadCatalogItems()).length > 0` — checks if any catalog items are loaded

**State 1 — Not set up** (catalog file missing):

```
PlugScout v0.3.4

  Welcome! Looks like this is your first time.

  ❯ Run setup now
        Installs prerequisites, writes config, syncs all catalogs
        → plugscout setup  (takes ~30 seconds)

    Exit
```

**State 2 — Set up, no catalog items** (catalog file exists but empty):

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

**State 3 — Operational** (catalog file exists with items):

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

- **Non-TTY environments** (e.g., pipes, CI): fall back to the existing `renderHomeScreen()` plain-text output from `src/interfaces/cli/ui/home.ts`. The non-TTY path always produces the existing rich dashboard — the state-aware interactive menu is TTY-only.
- Items that need an ID (show, assess, install) switch to a text input prompt using `readline.createInterface` before spawning the command.
- Selected option spawns the corresponding command via `child_process.spawn` with `stdio: 'inherit'` so output is visible in the same terminal.

**File:** The existing `src/interfaces/cli/ui/home.ts` is **extended** (not replaced):
- `renderHomeScreen()` remains for non-TTY / plain-text use (no changes)
- New export `renderInteractiveHome()` handles TTY interactive mode

### CLI router change

The `case 'home':` branch in `src/interfaces/cli/index.ts` (line 91) calls `handleHome()`, which is defined at line 164:

```typescript
async function handleHome(): Promise<void> {
  const output = await renderHomeScreen();
  console.log(output);
}
```

**Modify `handleHome()`** (not the switch case itself):

```typescript
async function handleHome(): Promise<void> {
  if (process.stdout.isTTY) {
    await renderInteractiveHome();
  } else {
    const output = await renderHomeScreen();
    console.log(output);
  }
}
```

(`'home'` is the default command when no arguments are passed — line 82: `const [rawCommand = 'home', ...rest] = filtered`.)

**Non-TTY note:** In non-TTY mode (pipes, CI), `renderHomeScreen()` is always called unchanged regardless of state (States 1/2/3). The state-aware interactive display is TTY-only. `renderHomeScreen()` already handles zero catalog items gracefully by showing `items=0`.

---

## Section 3: MCP Server

### Purpose

Expose the PlugScout catalog as MCP tools so AI assistants (Claude Desktop, Cursor, etc.) can search, browse, and propose installs. Human confirmation is required before any install executes.

### New dependency

Add to `package.json` `dependencies`:

```json
"@modelcontextprotocol/sdk": "^1.0.0"
```

Use `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. Minimum tested version: `^1.10.0` (pin to this floor to avoid pre-1.10 breaking changes in the SDK).

### Registration

Users add to their MCP host config. Example paths by platform:

- **Claude Desktop (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Cursor:** `.cursor/mcp.json` in the project root

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
1. Add `mcp: 'mcp'` to `COMMAND_ALIASES`
2. Add `case 'mcp':` branch that imports and calls `handleMcp(rest)`

New file: **`src/interfaces/cli/mcp.ts`** (following existing convention — interface-layer command handlers live in `src/interfaces/cli/`).

### Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `search_catalog` | `query: string, kind?: CatalogKind, provider?: string, limit?: number` | `CatalogItem[]` filtered by relevance score (delegates to `searchCatalog` API) |
| `get_item` | `id: string` | Full `CatalogItem` or MCP error if not found |
| `assess_item` | `id: string` | `RiskAssessment` augmented with `install_allowed: boolean` (see note) |
| `install_item` | `id: string` | `{ status: "installed" \| "cancelled" \| "blocked", detail?: string }` |
| `sync_catalogs` | _(none)_ | `{ items_loaded: number, stale_registries: string[] }` (mapped from `syncCatalogs` return) |

**`assess_item` augmentation:** Use `buildAssessment(item, policy)` (synchronous, from `src/security/assessment.ts`) with a single `await loadSecurityPolicy()` call to avoid the double policy load that would occur with `assessRisk` (which loads policy internally). The MCP tool does:

```typescript
const policy = await loadSecurityPolicy();
const assessment = buildAssessment(item, policy);
const blocked = isBlockedTier(assessment.riskTier, policy);
return { ...assessment, install_allowed: !blocked };
```

**`sync_catalogs` return mapping:** The underlying `syncCatalogs()` returns `{ items: CatalogItem[], staleRegistries: string[] }`. The MCP tool maps this to `{ items_loaded: items.length, stale_registries: staleRegistries }`.

All tools are implemented by calling the API layer functions from Section 1. **Null guard:** `get_item`, `assess_item`, and `install_item` must check whether `loadCatalogItemById` returns `null` and immediately return an MCP `NOT_FOUND` error before calling any downstream function.

### Human-in-the-loop install

The MCP server uses stdio transport, which means **stdin and stdout are owned by the MCP protocol layer** — they cannot be used for user confirmation prompts.

Instead, `install_item` reads from and writes to `/dev/tty` directly on Linux/macOS. Windows is out of scope for this feature — if `process.platform === 'win32'`, return `{ status: "cancelled", detail: "interactive confirmation not supported on Windows" }` without prompting. `/dev/tty` usage:

```typescript
import { createReadStream, createWriteStream } from 'node:fs';

const tty = createWriteStream('/dev/tty');
const ttyIn = createReadStream('/dev/tty');

tty.write(`\nPlugScout install requested by AI assistant\n`);
tty.write(`Item: ${item.id} (risk: ${assessment.riskTier}/${assessment.riskScore})\n`);
tty.write(`Install command: ${installCmd}\n`);
tty.write(`Confirm? [y/N]: `);
// read one line from ttyIn with 60-second timeout...
```

Flow:
1. AI calls `install_item` with an `id`
2. MCP server loads the item via `loadCatalogItemById`, runs `assessRisk`, checks `isBlockedTier`
3. If blocked (high/critical risk): skip prompt entirely, return `{ status: "blocked", detail: "risk tier: <riskTier>" }`
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
- Home screen catches errors from state detection and falls back to plain-text `renderHomeScreen()` output (State 3 level of detail is best-effort)
- MCP tools return structured MCP error responses per SDK spec — no unhandled promise rejections
- `install_item`: 60-second `/dev/tty` read timeout returns `{ status: "cancelled", detail: "timeout" }`
- `searchCatalog`: returns empty array on error rather than throwing (catalog may not be synced yet)

---

## Testing

- **API layer:** Unit tests split by logical group: `src/api/__tests__/search.test.ts` (searchCatalog + computeSearchScore), `src/api/__tests__/setup.test.ts` (isSetUp), `src/api/__tests__/sync.test.ts` (syncCatalogs wrapper). Each verifies return shape, `PlugScoutError` on bad input, and no console output / `process.exit` side effects.
- **`isSetUp()`:** Unit test with a temp directory: no file → `false`, file present → `true`
- **`searchCatalog`:** Unit test extracted `computeSearchScore` with fixture `CatalogItem` objects
- **Home screen:** Unit tests for state detection logic (mock `isSetUp` and `loadCatalogItems`); integration test verifying the correct menu items appear per state in TTY mode
- **MCP server:** Integration tests using the `@modelcontextprotocol/sdk` in-process client/server pattern. Tests create a pair of `PassThrough` streams and pass them to `StdioServerTransport` in place of `process.stdin`/`process.stdout`. The MCP SDK `Client` class connects to the same streams from the other side, calls each tool, and verifies the response shape. `install_item` is tested by replacing the `/dev/tty` write/read streams with `PassThrough` mocks injected via a test-only parameter.
