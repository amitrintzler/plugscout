import { loadProviders, loadRegistries } from '../config/runtime.js';
import { logger } from '../lib/logger.js';
import { CatalogItemSchema, type CatalogItem, type CatalogKind, type Registry } from '../lib/validation/contracts.js';
import { adaptRegistryEntries } from './adapter.js';
import { resolveRegistryEntries } from './remote-registry.js';
import {
  getStaleRegistries,
  getUpdatedSince,
  loadSyncState,
  saveSyncState,
  setSuccessfulSync,
  setUpdatedSince
} from './sync-state.js';

import { saveCatalogItems, saveLegacyCatalogViews } from './repository.js';

export interface SyncCatalogOptions {
  kinds?: CatalogKind[];
}

export async function syncCatalogs(
  today = new Date().toISOString().slice(0, 10),
  options: SyncCatalogOptions = {}
): Promise<{
  items: CatalogItem[];
  staleRegistries: string[];
}> {
  const effectiveToday = process.env.SKILLS_MCPS_SYNC_TODAY || today;
  const [registries, providers] = await Promise.all([loadRegistries(), loadProviders()]);
  let syncState = await loadSyncState();

  const selectedKinds = options.kinds?.length ? new Set(options.kinds) : null;
  const allItems: CatalogItem[] = [];

  for (const registry of registries) {
    if (selectedKinds && !selectedKinds.has(registry.kind)) {
      continue;
    }

    if (registry.remote?.provider) {
      const provider = providers.get(registry.remote.provider);
      if (provider && provider.officialOnly && registry.sourceType === 'community-list' && !registry.officialOnly) {
        logger.warn(`Skipping non-official registry ${registry.id} due to provider policy (${provider.id})`);
        continue;
      }
    }

    const updatedSince = registry.remote?.supportsUpdatedSince ? getUpdatedSince(syncState, registry.id) : undefined;

    const resolved = await resolveRegistryEntries(registry, { updatedSince });
    const adaptedEntries = resolved.source === 'remote' ? adaptRegistryEntries(registry, resolved.entries) : resolved.entries;
    // Always include curated local entries so they persist even when remote succeeds
    const curatedEntries = resolved.source === 'remote' ? registry.entries : [];

    allItems.push(...normalizeItems([...adaptedEntries, ...curatedEntries], registry, effectiveToday));

    const nowStamp = new Date().toISOString();
    syncState = setSuccessfulSync(syncState, registry.id, nowStamp);

    if (registry.remote?.supportsUpdatedSince && resolved.source === 'remote') {
      syncState = setUpdatedSince(syncState, registry.id, nowStamp);
    }
  }

  const mergedItems = mergeItemsById(allItems);

  await Promise.all([saveCatalogItems(mergedItems), saveLegacyCatalogViews(mergedItems)]);
  await saveSyncState(syncState);

  const kindCounts = countByKind(mergedItems);
  logger.info(
    `Synced ${mergedItems.length} items (${kindCounts.skill} skills, ${kindCounts.mcp} MCPs, ${kindCounts['claude-plugin']} Claude plugins, ${kindCounts['claude-connector']} Claude connectors, ${kindCounts['copilot-extension']} Copilot extensions)`
  );

  const staleRegistries = getStaleRegistries(syncState);

  if (staleRegistries.length > 0) {
    logger.warn(`Stale registries (>48h without success): ${staleRegistries.join(', ')}`);
  }

  return { items: mergedItems, staleRegistries };
}

function normalizeItems(records: unknown[], registry: Registry, today: string): CatalogItem[] {
  return records
    .map((entry) => {
      const value = ensureObject(entry);
      const entryMetadata =
        value.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
          ? (value.metadata as Record<string, unknown>)
          : {};

      return CatalogItemSchema.parse({
        ...value,
        id: normalizeId(String(value.id ?? ''), registry.kind),
        kind: value.kind ?? registry.kind,
        provider: value.provider ?? registry.remote?.provider ?? inferProviderFromKind(registry.kind),
        source: value.source ?? registry.id,
        lastSeenAt: value.lastSeenAt ?? today,
        metadata: {
          ...entryMetadata,
          sourceRegistryId: registry.id,
          sourceType: entryMetadata.sourceType ?? registry.sourceType,
          sourceConfidence: entryMetadata.sourceConfidence ?? defaultSourceConfidence(registry.sourceType)
        }
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid registry entry: expected object');
  }
  return value as Record<string, unknown>;
}

function normalizeId(id: string, kind: CatalogKind): string {
  if (id.startsWith(`${kind}:`)) {
    return id;
  }

  const prefixMap: Record<CatalogKind, string> = {
    skill: 'skill',
    mcp: 'mcp',
    'claude-plugin': 'claude-plugin',
    'claude-connector': 'claude-connector',
    'copilot-extension': 'copilot-extension'
  };

  return `${prefixMap[kind]}:${id.replace(/^([a-z-]+):/, '')}`;
}

function inferProviderFromKind(kind: CatalogKind): string {
  if (kind === 'mcp') {
    return 'mcp';
  }
  if (kind === 'claude-plugin') {
    return 'anthropic';
  }
  if (kind === 'claude-connector') {
    return 'anthropic';
  }
  if (kind === 'copilot-extension') {
    return 'github';
  }
  return 'openai';
}

function mergeItemsById(items: CatalogItem[]): CatalogItem[] {
  const state = new Map<string, CatalogItem>();

  for (const item of items) {
    const existing = state.get(item.id);
    if (!existing) {
      state.set(item.id, item);
      continue;
    }

    state.set(item.id, {
      ...existing,
      name: item.name.length > existing.name.length ? item.name : existing.name,
      description: item.description.length > existing.description.length ? item.description : existing.description,
      capabilities: dedupe([...existing.capabilities, ...item.capabilities]),
      compatibility: dedupe([...existing.compatibility, ...item.compatibility]),
      maintenanceSignal: Math.max(existing.maintenanceSignal, item.maintenanceSignal),
      adoptionSignal: Math.max(existing.adoptionSignal, item.adoptionSignal),
      provenanceSignal: Math.max(existing.provenanceSignal, item.provenanceSignal),
      freshnessSignal: Math.max(existing.freshnessSignal, item.freshnessSignal),
      lastSeenAt: item.lastSeenAt >= existing.lastSeenAt ? item.lastSeenAt : existing.lastSeenAt,
      metadata: {
        ...existing.metadata,
        ...item.metadata
      }
    });
  }

  return Array.from(state.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0))).sort((a, b) => a.localeCompare(b));
}

function countByKind(items: CatalogItem[]): Record<CatalogKind, number> {
  return items.reduce<Record<CatalogKind, number>>(
    (acc, item) => {
      acc[item.kind] += 1;
      return acc;
    },
    {
      skill: 0,
      mcp: 0,
      'claude-plugin': 0,
      'claude-connector': 0,
      'copilot-extension': 0
    }
  );
}

function defaultSourceConfidence(sourceType: Registry['sourceType']): string {
  if (sourceType === 'vendor-feed' || sourceType === 'public-index') {
    return 'official';
  }
  return 'vetted-curated';
}
