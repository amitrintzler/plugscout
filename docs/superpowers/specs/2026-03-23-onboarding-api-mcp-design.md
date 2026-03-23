# Onboarding, API, and MCP Server Design

## Goal

Add three capabilities to PlugScout: an interactive home screen with first-run detection, a programmatic API surface for developers, and an MCP server that exposes the catalog to AI assistants with human-in-the-loop install confirmation.

## Architecture

The three features share a common API layer (`src/api/index.ts`) that re-exports core functions already implemented in the CLI. The home screen consumes the API layer for state detection. The MCP server consumes the API layer for all tool implementations. No new business logic is added — only new surfaces over existing logic.

**Tech Stack:** TypeScript, Ink (existing CLI UI framework), Inquirer.js (existing, used in `init`), `@modelcontextprotocol/sdk`, Node.js stdio transport

---

## Section 1: API Layer

### Purpose

Allow developers to import PlugScout functions directly in their own scripts or applications without shelling out to the CLI.

### Package exports

Add an `exports` field to `package.json` with two entry points:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./api": "./dist/api/index.js"
  }
}
```

### `src/api/index.ts`

Re-exports the following functions with stable, documented signatures:

| Export | Source | Description |
|--------|--------|-------------|
| `scanProject(dir, opts?)` | `src/commands/scan.ts` | Scan a directory and return structured results |
| `recommend(dir, opts?)` | `src/commands/recommend.ts` | Return policy-filtered ranked recommendations |
| `assess(id)` | `src/commands/assess.ts` | Risk assessment for one catalog item |
| `search(query, opts?)` | `src/catalog/search.ts` | Search catalog by keyword/type/provider |
| `getItem(id)` | `src/catalog/catalog.ts` | Full detail for one catalog entry |
| `syncCatalogs()` | `src/commands/sync.ts` | Refresh all catalogs, return summary |
| `loadConfig()` | `src/config/config.ts` | Load current config, return typed object |
| `isSetUp()` | `src/config/config.ts` | Returns true if config file exists |
| `hasPriorScan()` | `src/catalog/state.ts` | Returns true if a scan result exists on disk |

All functions return plain data objects (no `process.exit`, no console output). Existing CLI commands call these functions and handle formatting — the API layer exposes the same functions without the formatting wrapper.

### TypeScript types

Export a `PlugScoutTypes` namespace from `src/api/types.ts` covering: `CatalogItem`, `ScanResult`, `Recommendation`, `Assessment`, `SearchResult`, `Config`.

---

## Section 2: Interactive Home Screen

### Purpose

When the user runs `plugscout` with no arguments, display an interactive arrow-key menu with state-aware options and descriptions so new users immediately know what to do next.

### Three states

State is determined by two checks at startup (using `isSetUp()` and `hasPriorScan()` from the API layer):

**State 1 — Not set up** (config file missing):

```
PlugScout v0.3.4

  Welcome! Looks like this is your first time.

  ❯ Run setup now
        Installs prerequisites, writes config, syncs all catalogs
        → plugscout setup  (takes ~30 seconds)

    Exit
```

**State 2 — Set up, no scan yet** (config exists, no scan history):

```
PlugScout v0.3.4  ✓ Catalogs: 147 items  ⚠ No scan yet

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

**State 3 — Operational** (config + at least one prior scan):

```
PlugScout v0.3.4  ✓ Catalogs: 147 items  Last scan: 2h ago

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

- Rendered with Ink (already used for the existing home screen)
- Each menu item: label line + description line in `<Text dimColor>`
- Arrow keys navigate, Enter spawns the corresponding command as a child process in the same terminal (output is visible)
- Items that need an ID (show, assess, install) show a text input prompt before launching
- Status bar (catalog count, last scan time) populated from `isSetUp()`, `hasPriorScan()`, and catalog metadata
- Replaces/enhances the existing `home.ts` command — no new entry point needed

---

## Section 3: MCP Server

### Purpose

Expose the PlugScout catalog as MCP tools so AI assistants (Claude Desktop, Cursor, etc.) can search, browse, and propose installs. Human confirmation is required before any install executes.

### Registration

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

`plugscout mcp` starts a stdio MCP server using `@modelcontextprotocol/sdk`.

### Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `search_catalog` | `query: string, type?: string, provider?: string, limit?: number` | `CatalogItem[]` with id, name, type, risk score, trust score, blocked |
| `get_item` | `id: string` | Full `CatalogItem` with description, install command, provenance, policy status |
| `assess_item` | `id: string` | `{risk_tier, blocked, reasons[], install_allowed}` |
| `install_item` | `id: string` | Pauses, prints confirmation prompt to terminal, waits for y/n, returns `{status: "installed" | "cancelled" | "blocked", detail}` |
| `sync_catalogs` | _(none)_ | `{items_loaded, sources_updated, errors[]}` |

### Human-in-the-loop install

When `install_item` is called:
1. MCP server prints to the process terminal (not the AI chat):
   ```
   PlugScout install requested by AI assistant
   Item: mcp:filesystem (risk: low/10, trust: 85)
   Install command: npm install -g @modelcontextprotocol/server-filesystem
   Confirm? [y/N]:
   ```
2. Server reads from stdin and waits
3. If `y`: runs the install, returns `{status: "installed"}`
4. If `n` or timeout: returns `{status: "cancelled"}`
5. If item is blocked (high/critical risk): skips prompt entirely, returns `{status: "blocked", detail: "risk tier: high"}` — AI is informed it cannot proceed

### Policy enforcement

- `search_catalog` and `get_item`: no restrictions, freely callable
- `assess_item`: no restrictions
- `install_item`: blocked items cannot be installed even if user types `y`
- `sync_catalogs`: no restrictions

### New file

`src/commands/mcp.ts` — MCP server entry point. Imports tools from the API layer. Registered as `plugscout mcp` in the CLI router.

---

## Error Handling

- API layer functions throw typed errors (`PlugScoutError` with `code` and `message`) rather than calling `process.exit`
- Home screen catches errors from state detection and falls back to State 1 (safest default)
- MCP tools return structured error responses per MCP spec (no unhandled rejections)
- `install_item` has a 60-second stdin timeout; if no input received, returns `{status: "cancelled", detail: "timeout"}`

## Testing

- API layer: unit tests for each export, verifying return types and no side effects (no console output, no process.exit)
- Home screen: Ink component tests for each state using `ink-testing-library`
- MCP server: integration tests using `@modelcontextprotocol/sdk` test utilities; `install_item` tested with mocked stdin
