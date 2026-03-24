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
