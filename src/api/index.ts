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
