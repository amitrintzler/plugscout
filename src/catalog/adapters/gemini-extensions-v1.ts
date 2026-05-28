import { dedupe, extractStringArray, readString, toCount, toScore } from './shared.js';

export function adaptGeminiExtensionsEntries(sourceId: string, entries: unknown[]): unknown[] {
  return entries
    .map((entry) => mapGeminiExtensionEntry(sourceId, entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function mapGeminiExtensionEntry(sourceId: string, entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const slug = readString(record, ['slug', 'id', 'name']);
  if (!slug) {
    return null;
  }

  const name = readString(record, ['title', 'name']) ?? slug;
  const description = readString(record, ['description', 'summary']) ?? `Gemini CLI extension ${name}`;
  const capabilities = dedupe(
    extractStringArray(record, ['capabilities', 'tools']).concat(extractStringArray(record, ['tags']))
  );
  const compatibility = dedupe(extractStringArray(record, ['compatibility']).concat(['gemini', 'gemini-cli']));

  const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? (record.metadata as Record<string, unknown>)
    : {};
  const npmPkg =
    typeof record.npmPackage === 'string'
      ? record.npmPackage
      : typeof metadata.npmPackage === 'string'
        ? metadata.npmPackage
        : undefined;

  const installInstructions =
    readString(record, ['install', 'instructions']) ??
    (npmPkg
      ? `Add to ~/.gemini/settings.json under mcpServers: { "${slug.replace('gemini-extension:', '')}": { "command": "npx", "args": ["-y", "${npmPkg}"] } }`
      : `Configure in ~/.gemini/settings.json under mcpServers.`);

  const installUrl = readString(record, ['install', 'url']) ??
    (npmPkg ? `https://www.npmjs.com/package/${npmPkg}` : undefined);

  return {
    id: slug.startsWith('gemini-extension:') ? slug : `gemini-extension:${slug}`,
    kind: 'gemini-extension',
    provider: readString(record, ['provider']) ?? 'google',
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
    provenanceSignal: toScore(record.provenanceSignal, 75),
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
      ...(npmPkg ? { npmPackage: npmPkg } : {})
    }
  };
}
