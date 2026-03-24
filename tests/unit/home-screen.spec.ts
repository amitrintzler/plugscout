import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the API layer to control state
vi.mock('../../src/api/index.js', () => ({
  isSetUp: vi.fn(),
  loadCatalogItems: vi.fn(),
}));

import { isSetUp, loadCatalogItems } from '../../src/api/index.js';
import { getMenuItems } from '../../src/interfaces/cli/ui/home.js';

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
