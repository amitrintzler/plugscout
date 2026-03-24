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
  } else if (id.includes(query)) {
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
