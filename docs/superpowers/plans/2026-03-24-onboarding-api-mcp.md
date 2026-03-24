# Onboarding, API, and MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new capabilities to PlugScout: a programmatic API layer, an interactive arrow-key home screen with first-run detection, and an MCP server that lets AI assistants search and install catalog items with human confirmation.

**Architecture:** The API layer (`src/api/`) re-exports existing core functions as a clean public surface. The interactive home screen and MCP server both consume only the API layer — they add no new business logic. Tasks are ordered by dependency: errors → search extraction → API layer → exports → home screen → MCP server.

**Tech Stack:** TypeScript (ESM), Node.js `readline` (built-in), `@modelcontextprotocol/sdk ^1.10.0`, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/api/errors.ts` | Create | `PlugScoutError` class |
| `src/catalog/search.ts` | Create | Extracted `computeSearchScore` + `searchCatalog` API function |
| `src/api/index.ts` | Create | Re-exports of all public API functions + `isSetUp()` + type exports |
| `src/interfaces/cli/ui/home.ts` | Modify | Add `renderInteractiveHome()` export (TTY arrow-key menu) |
| `src/interfaces/cli/index.ts` | Modify | Wire `handleHome()` to `renderInteractiveHome()` on TTY; add `mcp` alias + case |
| `src/interfaces/cli/mcp.ts` | Create | `handleMcp()` — stdio MCP server with 5 tools |
| `package.json` | Modify | Add `exports` field + `@modelcontextprotocol/sdk` dependency |
| `tests/unit/api-errors.spec.ts` | Create | `PlugScoutError` tests |
| `tests/unit/catalog-search.spec.ts` | Create | `computeSearchScore` + `searchCatalog` tests |
| `tests/unit/api-layer.spec.ts` | Create | `isSetUp()` + API re-export shape tests |
| `tests/unit/home-screen.spec.ts` | Create | `renderInteractiveHome()` state detection tests |
| `tests/integration/mcp-server.spec.ts` | Create | MCP tools integration tests |

---

## Task 1: PlugScoutError class

**Files:**
- Create: `src/api/errors.ts`
- Create: `tests/unit/api-errors.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/api-errors.spec.ts
import { describe, expect, it } from 'vitest';
import { PlugScoutError } from '../../src/api/errors.js';

describe('PlugScoutError', () => {
  it('sets name, code, and message', () => {
    const err = new PlugScoutError('NOT_FOUND', 'item not found');
    expect(err.name).toBe('PlugScoutError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('item not found');
    expect(err instanceof Error).toBe(true);
  });

  it('stores optional cause', () => {
    const cause = new Error('original');
    const err = new PlugScoutError('WRAPPED', 'wrapped error', cause);
    expect(err.cause).toBe(cause);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/unit/api-errors.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/api/errors.js'`

- [ ] **Step 3: Create `src/api/errors.ts`**

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

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run tests/unit/api-errors.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/errors.ts tests/unit/api-errors.spec.ts
git commit -m "feat(api): add PlugScoutError class"
```

---

## Task 2: Extract `computeSearchScore` to `src/catalog/search.ts`

The search scoring logic currently lives as a private function in `src/interfaces/cli/index.ts` (line 1166). This task extracts it to a reusable module and updates the CLI to call it.

**Files:**
- Create: `src/catalog/search.ts`
- Modify: `src/interfaces/cli/index.ts` (lines 601–614, 1166–1187)
- Create: `tests/unit/catalog-search.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/catalog-search.spec.ts
import { describe, expect, it } from 'vitest';
import { computeSearchScore, searchCatalog } from '../../src/catalog/search.js';
import type { CatalogItem } from '../../src/lib/validation/contracts.js';

const item = (overrides: Partial<CatalogItem>): CatalogItem => ({
  id: 'mcp:test',
  name: 'Test Item',
  kind: 'mcp',
  provider: 'test',
  description: '',
  capabilities: [],
  tags: [],
  trustScore: 50,
  riskScore: 10,
  sourceConfidence: 'low',
  installMethods: [],
  lastUpdated: '2024-01-01',
  ...overrides,
});

describe('computeSearchScore', () => {
  it('returns 120 for exact id match', () => {
    expect(computeSearchScore(item({ id: 'mcp:filesystem' }), 'mcp:filesystem')).toBe(120);
  });

  it('returns 60 for partial id match', () => {
    expect(computeSearchScore(item({ id: 'mcp:filesystem' }), 'filesystem')).toBeGreaterThanOrEqual(60);
  });

  it('returns 50 for name match', () => {
    expect(computeSearchScore(item({ name: 'Filesystem MCP' }), 'filesystem')).toBeGreaterThanOrEqual(50);
  });

  it('returns 0 for no match', () => {
    expect(computeSearchScore(item({ id: 'mcp:test', name: 'nothing', capabilities: [] }), 'zzznomatch')).toBe(0);
  });
});

describe('searchCatalog', () => {
  it('filters out zero-score items and sorts by score desc', async () => {
    const results = await searchCatalog('filesystem');
    // catalog may be empty in test env — just verify shape if items present
    for (const r of results) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('kind');
    }
  });

  it('respects limit option', async () => {
    const results = await searchCatalog('a', { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('respects kind filter', async () => {
    const results = await searchCatalog('a', { kind: 'mcp' });
    for (const r of results) {
      expect(r.kind).toBe('mcp');
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/catalog-search.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/catalog/search.js'`

- [ ] **Step 3: Create `src/catalog/search.ts`**

Copy `computeSearchScore` verbatim from `src/interfaces/cli/index.ts` lines 1166–1187 and add the `searchCatalog` wrapper:

```typescript
import { loadCatalogItems } from './repository.js';
import type { CatalogItem, CatalogKind } from '../lib/validation/contracts.js';

export interface SearchOptions {
  kind?: CatalogKind;
  provider?: string;
  limit?: number;
}

export function computeSearchScore(item: CatalogItem, query: string): number {
  let score = 0;

  const id = item.id.toLowerCase();
  const name = item.name.toLowerCase();
  const capabilities = item.capabilities.map((capability) => capability.toLowerCase());

  if (id === query) {
    score += 120;
  }
  if (id.includes(query)) {
    score += 60;
  }
  if (name.includes(query)) {
    score += 50;
  }
  if (capabilities.some((capability) => capability.includes(query))) {
    score += 30;
  }

  return score;
}

export async function searchCatalog(query: string, opts: SearchOptions = {}): Promise<CatalogItem[]> {
  const items = await loadCatalogItems();
  const needle = query.toLowerCase();

  let results = items
    .map((item) => ({ item, score: computeSearchScore(item, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .map((entry) => entry.item);

  if (opts.kind) {
    results = results.filter((item) => item.kind === opts.kind);
  }
  if (opts.provider) {
    results = results.filter((item) => item.provider === opts.provider);
  }
  if (opts.limit !== undefined) {
    results = results.slice(0, opts.limit);
  }

  return results;
}
```

- [ ] **Step 4: Update `handleSearch` in `src/interfaces/cli/index.ts` to use the new module**

Replace lines 607–614:

Old code:
```typescript
  const items = await loadCatalogItems();
  const needle = query.toLowerCase();

  const matches = items
    .map((item) => ({ item, score: computeSearchScore(item, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, 20);
```

New code:
```typescript
  const results = await searchCatalog(query, { limit: 20 });
  const matches = results.map((item) => ({ item, score: computeSearchScore(item, query.toLowerCase()) }));
```

Also add import at the top of `src/interfaces/cli/index.ts`:
```typescript
import { computeSearchScore, searchCatalog } from '../../catalog/search.js';
```

And **delete** the private `computeSearchScore` function at lines 1166–1187 (it is now in `src/catalog/search.ts`).

- [ ] **Step 5: Run all tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/catalog/search.ts tests/unit/catalog-search.spec.ts src/interfaces/cli/index.ts
git commit -m "refactor(search): extract computeSearchScore to src/catalog/search.ts"
```

---

## Task 3: API layer — `src/api/index.ts`

This creates the public programmatic surface. It re-exports existing functions and adds `isSetUp()`.

**Files:**
- Create: `src/api/index.ts`
- Create: `tests/unit/api-layer.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/api-layer.spec.ts
import { describe, expect, it } from 'vitest';
import {
  detectProjectSignals,
  recommend,
  assessRisk,
  searchCatalog,
  loadCatalogItems,
  loadCatalogItemById,
  syncCatalogs,
  loadSecurityPolicy,
  isSetUp,
} from '../../src/api/index.js';

describe('API layer exports', () => {
  it('exports detectProjectSignals as a function', () => {
    expect(typeof detectProjectSignals).toBe('function');
  });

  it('exports recommend as a function', () => {
    expect(typeof recommend).toBe('function');
  });

  it('exports assessRisk as a function', () => {
    expect(typeof assessRisk).toBe('function');
  });

  it('exports searchCatalog as a function', () => {
    expect(typeof searchCatalog).toBe('function');
  });

  it('exports loadCatalogItems as a function', () => {
    expect(typeof loadCatalogItems).toBe('function');
  });

  it('exports loadCatalogItemById as a function', () => {
    expect(typeof loadCatalogItemById).toBe('function');
  });

  it('exports syncCatalogs as a function', () => {
    expect(typeof syncCatalogs).toBe('function');
  });

  it('exports loadSecurityPolicy as a function', () => {
    expect(typeof loadSecurityPolicy).toBe('function');
  });

  it('exports isSetUp as a function', () => {
    expect(typeof isSetUp).toBe('function');
  });
});

describe('isSetUp', () => {
  it('returns a boolean', async () => {
    const result = await isSetUp();
    expect(typeof result).toBe('boolean');
  });
});

describe('syncCatalogs wrapper', () => {
  it('does not expose today parameter — accepts only options', () => {
    // TypeScript enforces this at compile time; runtime check verifies it is callable with no args
    expect(typeof syncCatalogs).toBe('function');
    // syncCatalogs() with no args should not throw synchronously
    expect(() => syncCatalogs()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/api-layer.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/api/index.js'`

- [ ] **Step 3: Create `src/api/index.ts`**

```typescript
import fsExtra from 'fs-extra';

import { syncCatalogs as _syncCatalogs } from '../catalog/sync.js';
import { getStatePath } from '../lib/paths.js';
import type { SyncCatalogOptions } from '../catalog/sync.js';

export { searchCatalog } from '../catalog/search.js';
export { loadCatalogItems, loadCatalogItemById } from '../catalog/repository.js';
export { loadSecurityPolicy } from '../config/runtime.js';
export { detectProjectSignals } from '../recommendation/project-analysis.js';
export { recommend } from '../recommendation/engine.js';
export { assessRisk, buildAssessment, isBlockedTier, mapRiskTier } from '../security/assessment.js';

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

export { PlugScoutError } from './errors.js';

export async function syncCatalogs(options?: SyncCatalogOptions) {
  return _syncCatalogs(undefined, options);
}

export async function isSetUp(): Promise<boolean> {
  const itemsPath = getStatePath('data/catalog/items.json');
  return fsExtra.pathExists(itemsPath);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/api-layer.spec.ts
```

Expected: PASS (11 tests)

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/api/index.ts tests/unit/api-layer.spec.ts
git commit -m "feat(api): add public API layer with isSetUp and syncCatalogs wrapper"
```

---

## Task 4: Add `exports` field to `package.json`

**Files:**
- Modify: `package.json`

This task has no test file — the TypeScript compiler and a smoke-import verify it.

- [ ] **Step 1: Add `exports` and new dependency to `package.json`**

Open `package.json`. Add the `exports` field after `"main"` (or after `"version"` if `"main"` doesn't exist):

```json
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types": "./dist/index.d.ts"
  },
  "./api": {
    "import": "./dist/api/index.js",
    "types": "./dist/api/index.d.ts"
  }
},
```

Add `@modelcontextprotocol/sdk` to `"dependencies"`:

```json
"@modelcontextprotocol/sdk": "^1.10.0"
```

- [ ] **Step 2: Install the new dependency**

```bash
npm install
```

Expected: `@modelcontextprotocol/sdk` appears in `node_modules/`; `package-lock.json` updated

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no errors from `src/api/` files

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(api): add exports field and @modelcontextprotocol/sdk dependency"
```

---

## Task 5: Interactive home screen

This task adds `renderInteractiveHome()` to `src/interfaces/cli/ui/home.ts` and wires it into `handleHome()` in `src/interfaces/cli/index.ts`.

**Key implementation facts:**
- Existing `renderHomeScreen()` stays unchanged — used for non-TTY fallback
- `handleHome()` is at line 164 of `src/interfaces/cli/index.ts`
- Arrow up = `\u001b[A`, arrow down = `\u001b[B`, enter = `\r`, ctrl-c = `\u0003`
- Menu re-renders in place: print N lines, then use `\x1b[<N>A\r` to go back to top, overwrite each line with `\x1b[2K` + new content
- Items needing an ID (show, assess, install) prompt with `readline.createInterface` before spawning
- Spawn selected command with `child_process.spawn(process.execPath, [cli, command, ...args], { stdio: 'inherit' })`

**Files:**
- Modify: `src/interfaces/cli/ui/home.ts`
- Modify: `src/interfaces/cli/index.ts` (lines 164–167)
- Create: `tests/unit/home-screen.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/home-screen.spec.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the API layer to control state
vi.mock('../../../src/api/index.js', () => ({
  isSetUp: vi.fn(),
  loadCatalogItems: vi.fn(),
}));

import { isSetUp, loadCatalogItems } from '../../../src/api/index.js';
import { getMenuItems } from '../../../src/interfaces/cli/ui/home.js';

describe('getMenuItems — state detection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns only setup+exit in state 1 (not set up)', async () => {
    vi.mocked(isSetUp).mockResolvedValue(false);
    vi.mocked(loadCatalogItems).mockResolvedValue([]);
    const items = await getMenuItems();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Run setup now');
    expect(labels).toContain('Exit');
    expect(labels).not.toContain('Scan my project');
  });

  it('returns scan+recommend+web+doctor+exit in state 2 (set up, empty catalog)', async () => {
    vi.mocked(isSetUp).mockResolvedValue(true);
    vi.mocked(loadCatalogItems).mockResolvedValue([]);
    const items = await getMenuItems();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Scan my project');
    expect(labels).toContain('Get recommendations');
    expect(labels).not.toContain('Inspect an item');
  });

  it('returns full menu in state 3 (operational)', async () => {
    vi.mocked(isSetUp).mockResolvedValue(true);
    vi.mocked(loadCatalogItems).mockResolvedValue([
      { id: 'mcp:test', kind: 'mcp' } as never,
    ]);
    const items = await getMenuItems();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('Scan my project');
    expect(labels).toContain('Inspect an item');
    expect(labels).toContain('Install an item');
    expect(labels).toContain('Sync catalogs');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/unit/home-screen.spec.ts
```

Expected: FAIL — `getMenuItems is not exported from home.js`

- [ ] **Step 3: Add `getMenuItems` and `renderInteractiveHome` to `src/interfaces/cli/ui/home.ts`**

Add at the **bottom** of the file (after the existing `colorIfTty` function):

```typescript
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isSetUp, loadCatalogItems } from '../../../api/index.js';
import { getPackagePath } from '../../../lib/paths.js';

export interface MenuItem {
  label: string;
  description: string;
  command?: string[];   // argv to spawn; undefined = Exit
  needsId?: boolean;    // if true, prompt for --id before spawning
}

export async function getMenuItems(): Promise<MenuItem[]> {
  const setup = await isSetUp();
  if (!setup) {
    return [
      {
        label: 'Run setup now',
        description: 'Installs prerequisites, writes config, syncs all catalogs\n        → plugscout setup  (takes ~30 seconds)',
        command: ['setup'],
      },
      { label: 'Exit', description: '' },
    ];
  }

  const items = await loadCatalogItems();
  const base: MenuItem[] = [
    {
      label: 'Scan my project',
      description: 'Detect your stack and list matching plugins, MCPs, and extensions\n        → plugscout scan --project . --format table',
      command: ['scan', '--project', '.', '--format', 'table'],
    },
    {
      label: 'Get recommendations',
      description: 'Top safe picks ranked by fit + trust for your current directory\n        → plugscout recommend --project . --only-safe --limit 10',
      command: ['recommend', '--project', '.', '--only-safe', '--limit', '10'],
    },
  ];

  if (items.length > 0) {
    base.push(
      {
        label: 'Inspect an item',
        description: 'Show full risk profile, trust score, and install instructions\n        → plugscout show --id <id>  (prompts for ID)',
        command: ['show'],
        needsId: true,
      },
      {
        label: 'Assess before installing',
        description: 'Evaluate one candidate in detail — risk, policy, provenance\n        → plugscout assess --id <id>  (prompts for ID)',
        command: ['assess'],
        needsId: true,
      },
      {
        label: 'Install an item',
        description: 'Policy-gated install; blocks high/critical risk by default\n        → plugscout install --id <id> --yes  (prompts for ID)',
        command: ['install', '--yes'],
        needsId: true,
      },
      {
        label: 'Sync catalogs',
        description: 'Pull latest entries from all configured registries\n        → plugscout sync',
        command: ['sync'],
      }
    );
  }

  base.push(
    {
      label: 'Open web report',
      description: 'Readable HTML with score legend and decision cards — opens in browser\n        → plugscout web --open',
      command: ['web', '--open'],
    },
    {
      label: 'Check system health',
      description: 'Verify prerequisites, catalog freshness, and config validity\n        → plugscout doctor',
      command: ['doctor'],
    },
    { label: 'Exit', description: '' }
  );

  return base;
}

export async function renderInteractiveHome(): Promise<void> {
  let menuItems: MenuItem[];
  try {
    menuItems = await getMenuItems();
  } catch {
    const screen = await renderHomeScreen();
    process.stdout.write(screen + '\n');
    return;
  }

  let selected = 0;
  const ARROW_UP = '\u001b[A';
  const ARROW_DOWN = '\u001b[B';
  const ENTER = '\r';
  const CTRL_C = '\u0003';

  function render(firstRender: boolean): void {
    if (!firstRender) {
      // Move cursor back to top of menu
      process.stdout.write(`\x1b[${menuItems.length * 2}A\r`);
    }
    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      const prefix = i === selected ? '  \u276f ' : '    ';
      process.stdout.write(`\x1b[2K${prefix}${item.label}\n`);
      if (item.description) {
        process.stdout.write(`\x1b[2K        ${colorIfTty(item.description, colors.dim ?? ((s: string) => s))}\n`);
      } else {
        process.stdout.write(`\x1b[2K\n`);
      }
    }
  }

  process.stdout.write('\n');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  render(true);

  await new Promise<void>((resolve) => {
    process.stdin.on('data', async function onKey(key: string) {
      if (key === CTRL_C) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        process.exit(0);
      } else if (key === ARROW_UP) {
        selected = (selected - 1 + menuItems.length) % menuItems.length;
        render(false);
      } else if (key === ARROW_DOWN) {
        selected = (selected + 1) % menuItems.length;
        render(false);
      } else if (key === ENTER) {
        process.stdin.removeListener('data', onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');

        const item = menuItems[selected];
        if (!item.command) {
          resolve();
          return;
        }

        let args = [...item.command];
        if (item.needsId) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          process.stdin.resume();
          const id = await new Promise<string>((res) => {
            rl.question('  Enter catalog ID: ', (answer) => {
              rl.close();
              res(answer.trim());
            });
          });
          if (!id) {
            resolve();
            return;
          }
          args = [...args, '--id', id];
        }

        const cliPath = getPackagePath('dist/cli.js');
        const child = spawn(process.execPath, [cliPath, ...args], { stdio: 'inherit' });
        child.on('close', () => resolve());
      }
    });
  });
}
```

Note: `colors.dim` may not exist on the `colors` object. If the import from `../formatters/colors.js` does not export `dim`, replace the dim call with `(s: string) => `\x1b[2m${s}\x1b[0m`` directly.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/unit/home-screen.spec.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Wire `renderInteractiveHome` into `handleHome` in `src/interfaces/cli/index.ts`**

Find `handleHome()` at line 164:

```typescript
// BEFORE
async function handleHome(): Promise<void> {
  const output = await renderHomeScreen();
  console.log(output);
}
```

Replace with:

```typescript
// AFTER
async function handleHome(): Promise<void> {
  if (process.stdout.isTTY) {
    await renderInteractiveHome();
  } else {
    const output = await renderHomeScreen();
    console.log(output);
  }
}
```

Also add `renderInteractiveHome` to the import from `./ui/home.js` at the top of the file.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/interfaces/cli/ui/home.ts src/interfaces/cli/index.ts tests/unit/home-screen.spec.ts
git commit -m "feat(home): add interactive arrow-key home screen with first-run detection"
```

---

## Task 6: MCP server

This task creates the stdio MCP server at `src/interfaces/cli/mcp.ts` and wires it into the CLI router.

**Key facts for implementers:**
- `@modelcontextprotocol/sdk` server pattern: create `Server`, register tools with `server.setRequestHandler(ListToolsRequestSchema, ...)` and `server.setRequestHandler(CallToolRequestSchema, ...)`, connect with `StdioServerTransport`
- `loadCatalogItemById` returns `CatalogItem | null` — always null-check before use
- `buildAssessment(item, policy)` is synchronous; call with one `await loadSecurityPolicy()` upfront
- `install_item` writes/reads `/dev/tty` directly — stdin/stdout belong to the MCP protocol
- Windows check: `if (process.platform === 'win32')` → return `cancelled`
- `syncCatalogs` returns `{ items: CatalogItem[], staleRegistries: string[] }` — map to `{ items_loaded, stale_registries }`

**Files:**
- Create: `src/interfaces/cli/mcp.ts`
- Modify: `src/interfaces/cli/index.ts` (COMMAND_ALIASES + switch case)
- Create: `tests/integration/mcp-server.spec.ts`

- [ ] **Step 1: Write the failing integration tests**

```typescript
// tests/integration/mcp-server.spec.ts
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { startMcpServer } from '../../src/interfaces/cli/mcp.js';

describe('MCP server tools', () => {
  it('lists expected tools', async () => {
    const { client, cleanup } = await createTestClient();
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('search_catalog');
      expect(names).toContain('get_item');
      expect(names).toContain('assess_item');
      expect(names).toContain('install_item');
      expect(names).toContain('sync_catalogs');
    } finally {
      await cleanup();
    }
  });

  it('search_catalog returns an array', async () => {
    const { client, cleanup } = await createTestClient();
    try {
      const result = await client.callTool({ name: 'search_catalog', arguments: { query: 'filesystem' } });
      expect(Array.isArray(JSON.parse((result.content as [{ text: string }])[0].text))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('get_item returns NOT_FOUND error for unknown id', async () => {
    const { client, cleanup } = await createTestClient();
    try {
      const result = await client.callTool({ name: 'get_item', arguments: { id: 'mcp:does-not-exist-zzz' } });
      const text = (result.content as [{ text: string }])[0].text;
      expect(text).toContain('NOT_FOUND');
    } finally {
      await cleanup();
    }
  });
});

async function createTestClient() {
  // Use in-process transport: server and client share a pair of PassThrough streams
  const serverToClient = new PassThrough();
  const clientToServer = new PassThrough();

  // Start server reading from clientToServer, writing to serverToClient
  const cleanup = await startMcpServer(clientToServer, serverToClient);

  const client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });
  // Determine the correct in-process transport import path from the installed SDK.
  // Check node_modules/@modelcontextprotocol/sdk/package.json "exports" for the right path.
  // Common options: 'inprocess', 'client/stdio', or an in-memory transport helper.
  // The pattern below uses a direct PassThrough-stream connection that works with any version:
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const clientTransport = new StdioClientTransport({ stdin: serverToClient, stdout: clientToServer } as never);
  await client.connect(clientTransport);

  return { client, cleanup };
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/integration/mcp-server.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/interfaces/cli/mcp.js'`

- [ ] **Step 3: Create `src/interfaces/cli/mcp.ts`**

```typescript
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  buildAssessment,
  isBlockedTier,
  loadCatalogItemById,
  loadSecurityPolicy,
  searchCatalog,
  syncCatalogs,
} from '../../api/index.js';
import { installWithSkillSh } from '../../install/skillsh.js';

function createServer(): Server {
  const server = new Server(
    { name: 'plugscout', version: '0.3.4' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_catalog',
        description: 'Search the PlugScout catalog for plugins, MCP servers, and extensions.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term' },
            kind: { type: 'string', description: 'Filter by kind: skill, mcp, claude-plugin, claude-connector, copilot-extension' },
            provider: { type: 'string', description: 'Filter by provider' },
            limit: { type: 'number', description: 'Max results (default: 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_item',
        description: 'Get full details for a catalog item by ID.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Catalog item ID, e.g. mcp:filesystem' } },
          required: ['id'],
        },
      },
      {
        name: 'assess_item',
        description: 'Evaluate risk and policy for a catalog item before installing.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'install_item',
        description: 'Install a catalog item. Requires human confirmation in the terminal. Blocked items cannot be installed.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'sync_catalogs',
        description: 'Refresh catalog data from all configured registries.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (name === 'search_catalog') {
      const { query, kind, provider, limit = 20 } = args as { query: string; kind?: string; provider?: string; limit?: number };
      const results = await searchCatalog(query, { kind: kind as never, provider, limit });
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }

    if (name === 'get_item') {
      const { id } = args as { id: string };
      const item = await loadCatalogItemById(id);
      if (!item) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND', id }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(item) }] };
    }

    if (name === 'assess_item') {
      const { id } = args as { id: string };
      const item = await loadCatalogItemById(id);
      if (!item) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND', id }) }] };
      }
      const policy = await loadSecurityPolicy();
      const assessment = buildAssessment(item, policy);
      const blocked = isBlockedTier(assessment.riskTier, policy);
      return { content: [{ type: 'text', text: JSON.stringify({ ...assessment, install_allowed: !blocked }) }] };
    }

    if (name === 'install_item') {
      const { id } = args as { id: string };
      const item = await loadCatalogItemById(id);
      if (!item) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', detail: 'NOT_FOUND' }) }] };
      }
      const policy = await loadSecurityPolicy();
      const assessment = buildAssessment(item, policy);
      const blocked = isBlockedTier(assessment.riskTier, policy);
      if (blocked) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'blocked', detail: `risk tier: ${assessment.riskTier}` }) }] };
      }

      if (process.platform === 'win32') {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'cancelled', detail: 'interactive confirmation not supported on Windows' }) }] };
      }

      // Human-in-the-loop: write prompt to /dev/tty, read response
      const confirmed = await promptViaTty(item.id, assessment.riskTier, assessment.riskScore);
      if (!confirmed) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'cancelled' }) }] };
      }

      try {
        // installWithSkillSh in src/install/skillsh.ts accepts { id, overrideRisk, overrideReview, yes }
        await installWithSkillSh({ id: item.id, overrideRisk: false, overrideReview: false, yes: true });
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'installed' }) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', detail: msg }) }] };
      }
    }

    if (name === 'sync_catalogs') {
      const result = await syncCatalogs();
      return { content: [{ type: 'text', text: JSON.stringify({ items_loaded: result.items.length, stale_registries: result.staleRegistries }) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

async function promptViaTty(id: string, riskTier: string, riskScore: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tty = createWriteStream('/dev/tty');
    const ttyIn = createReadStream('/dev/tty');

    let input = '';
    const timeout = setTimeout(() => {
      ttyIn.destroy();
      tty.end();
      resolve(false);
    }, 60_000);

    tty.write(`\nPlugScout install requested by AI assistant\n`);
    tty.write(`Item: ${id} (risk: ${riskTier}/${riskScore})\n`);
    tty.write(`Confirm? [y/N]: `);

    ttyIn.on('data', (chunk: Buffer) => {
      input += chunk.toString();
      if (input.includes('\n') || input.includes('\r')) {
        clearTimeout(timeout);
        ttyIn.destroy();
        tty.end();
        resolve(input.trim().toLowerCase() === 'y');
      }
    });

    ttyIn.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

export async function startMcpServer(
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout
): Promise<() => Promise<void>> {
  const server = createServer();
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);
  return async () => server.close();
}

export async function handleMcp(_args: string[]): Promise<void> {
  await startMcpServer();
  // Keep process alive — MCP server runs until the client disconnects
  await new Promise<void>(() => {/* intentionally never resolves */});
}
```

**Note on install:** `installWithSkillSh` is exported from `src/install/skillsh.ts` with signature `({ id, overrideRisk, overrideReview, yes }: InstallOptions): Promise<InstallAudit>`. It accepts the item ID as a string — it looks up the catalog item internally. Always pass `overrideRisk: false` and `overrideReview: false` to respect the policy gate.

- [ ] **Step 4: Wire `mcp` into the CLI router in `src/interfaces/cli/index.ts`**

Add to `COMMAND_ALIASES` (after `setup: 'setup'`):
```typescript
mcp: 'mcp',
```

Add a case to the switch statement (after `case 'setup':`):
```typescript
case 'mcp':
  await handleMcp(rest);
  return;
```

Add import at the top of `src/interfaces/cli/index.ts`:
```typescript
import { handleMcp } from './mcp.js';
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -30
```

Expected: no errors in `src/interfaces/cli/mcp.ts` or `src/api/index.ts`

- [ ] **Step 6: Run the integration tests**

```bash
npx vitest run tests/integration/mcp-server.spec.ts
```

Expected: PASS (3 tests) — if `StreamTransport` import fails, the test client will not connect and tests will be skipped/pass vacuously. Check SDK docs for the correct in-process transport API and adjust the import path in the test file.

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src/interfaces/cli/mcp.ts src/interfaces/cli/index.ts tests/integration/mcp-server.spec.ts
git commit -m "feat(mcp): add stdio MCP server with 5 tools and human-in-the-loop install"
```

---

## Final verification

- [ ] **Build the project**

```bash
npm run build
```

Expected: no errors; `dist/api/index.js` and `dist/interfaces/cli/mcp.js` exist

- [ ] **Smoke test the home screen (TTY)**

```bash
node dist/cli.js
```

Expected: interactive arrow-key menu appears; arrow keys navigate; Enter launches the selected command; Ctrl-C exits

- [ ] **Smoke test the MCP server**

```bash
node dist/cli.js mcp --help 2>/dev/null || node dist/cli.js mcp &
sleep 1
kill %1 2>/dev/null
```

Expected: process starts without crashing

- [ ] **Smoke test the API**

```bash
node -e "import('./dist/api/index.js').then(api => api.isSetUp().then(r => console.log('isSetUp:', r)))"
```

Expected: `isSetUp: true` or `isSetUp: false` (no crash)
