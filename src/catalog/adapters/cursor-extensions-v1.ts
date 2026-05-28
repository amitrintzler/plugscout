import { dedupe, extractStringArray, readString, toCount, toScore } from './shared.js';

export function adaptCursorExtensionsEntries(sourceId: string, entries: unknown[]): unknown[] {
  return entries
    .map((entry) => mapCursorExtensionEntry(sourceId, entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function mapCursorExtensionEntry(sourceId: string, entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const slug = readString(record, ['slug', 'id', 'name']);
  if (!slug) {
    return null;
  }

  const name = readString(record, ['title', 'name']) ?? slug;
  const description = readString(record, ['description', 'summary']) ?? `Cursor extension ${name}`;
  const capabilities = dedupe(
    extractStringArray(record, ['capabilities', 'tools']).concat(extractStringArray(record, ['tags']))
  );
  const compatibility = dedupe(extractStringArray(record, ['compatibility']).concat(['cursor']));

  const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? (record.metadata as Record<string, unknown>)
    : {};
  const vsixId = typeof record.vsixId === 'string' ? record.vsixId : typeof metadata.vsixId === 'string' ? metadata.vsixId : undefined;

  const installInstructions =
    readString(record, ['install', 'instructions']) ??
    (vsixId
      ? `Install via Cursor Marketplace: open Extensions panel (Cmd+Shift+X) and search for ${name}.`
      : `Install via Cursor Marketplace: open Extensions panel (Cmd+Shift+X) and search for ${name}.`);

  const installUrl = readString(record, ['install', 'url']) ??
    (vsixId ? `https://marketplace.visualstudio.com/items?itemName=${vsixId}` : undefined);

  return {
    id: slug.startsWith('cursor-extension:') ? slug : `cursor-extension:${slug}`,
    kind: 'cursor-extension',
    provider: readString(record, ['provider']) ?? 'cursor',
    name,
    description,
    capabilities,
    compatibility,
    source: sourceId,
    install: {
      kind: 'manual',
      instructions: installInstructions,
      ...(installUrl ? { url: installUrl } : {})
    },
    adoptionSignal: toScore(record.adoptionSignal, 50),
    maintenanceSignal: toScore(record.maintenanceSignal, 50),
    provenanceSignal: toScore(record.provenanceSignal, 70),
    freshnessSignal: toScore(record.freshnessSignal, 60),
    securitySignals: {
      knownVulnerabilities: toCount(record.knownVulnerabilities),
      suspiciousPatterns: toCount(record.suspiciousPatterns),
      injectionFindings: toCount(record.injectionFindings),
      exfiltrationSignals: toCount(record.exfiltrationSignals),
      integrityAlerts: toCount(record.integrityAlerts)
    },
    metadata: {
      ...metadata,
      ...(vsixId ? { vsixId } : {})
    }
  };
}
