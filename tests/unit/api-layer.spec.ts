import { describe, expect, it } from 'vitest';
import {
  detectProjectSignals,
  recommend,
  assessRisk,
  buildAssessment,
  isBlockedTier,
  mapRiskTier,
  searchCatalog,
  loadCatalogItems,
  loadCatalogItemById,
  syncCatalogs,
  loadSecurityPolicy,
  isSetUp,
  PlugScoutError,
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

  it('exports buildAssessment as a function', () => {
    expect(typeof buildAssessment).toBe('function');
  });

  it('exports isBlockedTier as a function', () => {
    expect(typeof isBlockedTier).toBe('function');
  });

  it('exports mapRiskTier as a function', () => {
    expect(typeof mapRiskTier).toBe('function');
  });

  it('exports PlugScoutError as a class', () => {
    expect(typeof PlugScoutError).toBe('function');
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
