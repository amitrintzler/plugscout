import { dedupe, extractStringArray, readNestedString, readString } from './shared.js';

export function adaptMcpRegistryEntries(sourceId: string, entries: unknown[]): unknown[] {
  return entries
    .map((entry) => mapMcpRegistryEntry(sourceId, entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function mapMcpRegistryEntry(sourceId: string, entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const server = resolveServerRecord(record);
  const name = readString(server, ['name', 'id']);
  if (!name) {
    return null;
  }

  const title = readString(server, ['title', 'displayName']) ?? name;
  const description = readString(server, ['description']) ?? `MCP server ${name}`;
  const packages = Array.isArray(server.packages) ? (server.packages as unknown[]) : [];
  const remotes = Array.isArray(server.remotes) ? (server.remotes as unknown[]) : [];

  const packageRecords = packages
    .filter((pkg) => pkg && typeof pkg === 'object' && !Array.isArray(pkg))
    .map((pkg) => pkg as Record<string, unknown>);
  const remoteRecords = remotes
    .filter((remote) => remote && typeof remote === 'object' && !Array.isArray(remote))
    .map((remote) => remote as Record<string, unknown>);

  const firstPackage = packageRecords[0] ?? {};
  const firstRemote = remoteRecords[0] ?? {};
  const transport =
    normalizeTransport(readNestedString(firstPackage, ['transport', 'type']) ?? readString(firstPackage, ['transport'])) ??
    normalizeTransport(readString(firstRemote, ['type'])) ??
    normalizeTransport(readString(server, ['transport'])) ??
    'stdio';
  const authModel = normalizeAuthModel(readString(server, ['authModel', 'auth'])) ?? inferAuthModel(firstPackage, remoteRecords);

  const compatibility = dedupe(
    packageRecords
      .flatMap((pkg) => detectCompatibilityFromPackage(pkg))
      .concat(detectCompatibilityFromRemotes(remoteRecords))
      .concat(['general'])
  );

  const capabilities = dedupe(
    extractStringArray(server, ['capabilities', 'tools'])
      .concat(extractStringArray(server, ['tags']))
      .concat(extractStringArray(record, ['tags']))
  );

  const target =
    readNestedString(firstPackage, ['identifier']) ??
    readNestedString(firstPackage, ['name']) ??
    readString(server, ['name']) ??
    name;
  const installUrl = readString(server, ['websiteUrl']) ?? readNestedString(server, ['repository', 'url']);
  const install =
    packageRecords.length > 0
      ? {
          kind: 'skill.sh' as const,
          target,
          args: []
        }
      : {
          kind: 'manual' as const,
          instructions: 'Configure using the MCP server repository or hosted remote endpoint.',
          url: installUrl
        };
  const publishedAt = readNestedString(record, ['_meta', 'io.modelcontextprotocol.registry/official', 'publishedAt']);
  const freshnessSignal = scoreFreshness(publishedAt);

  return {
    id: `mcp:${name}`,
    kind: 'mcp',
    provider: 'mcp',
    name: title,
    description,
    transport,
    authModel,
    capabilities,
    compatibility,
    source: sourceId,
    install,
    adoptionSignal: 50,
    maintenanceSignal: 65,
    provenanceSignal: 90,
    freshnessSignal,
    securitySignals: {
      knownVulnerabilities: 0,
      suspiciousPatterns: 0,
      injectionFindings: 0,
      exfiltrationSignals: 0,
      integrityAlerts: 0
    },
    metadata: {
      websiteUrl: readString(server, ['websiteUrl']),
      repositoryUrl: readNestedString(server, ['repository', 'url']),
      packageIdentifier: readNestedString(firstPackage, ['identifier']) ?? readNestedString(firstPackage, ['name']),
      packageRegistryType: readString(firstPackage, ['registryType']),
      packageRuntime: readString(firstPackage, ['runtime']),
      version: readString(server, ['version']),
      publishedAt
    }
  };
}

function resolveServerRecord(entry: Record<string, unknown>): Record<string, unknown> {
  const nested = entry.server;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return entry;
}

function normalizeTransport(value: string | undefined): 'stdio' | 'http' | 'sse' | 'websocket' | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'http') {
    return 'http';
  }
  if (normalized === 'streamable-http') {
    return 'http';
  }
  if (normalized === 'sse') {
    return 'sse';
  }
  if (normalized === 'websocket' || normalized === 'ws') {
    return 'websocket';
  }
  if (normalized === 'stdio') {
    return 'stdio';
  }
  return undefined;
}

function normalizeAuthModel(value: string | undefined): 'none' | 'api_key' | 'oauth' | 'custom' | undefined {
  const normalized = value?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'none' || normalized === 'noauth') {
    return 'none';
  }
  if (normalized === 'api_key' || normalized === 'apikey' || normalized === 'bearer') {
    return 'api_key';
  }
  if (normalized === 'oauth' || normalized === 'oauth2') {
    return 'oauth';
  }
  return undefined;
}

function inferAuthModel(
  firstPackage: Record<string, unknown>,
  remotes: Record<string, unknown>[]
): 'none' | 'api_key' | 'oauth' | 'custom' {
  const envVars = Array.isArray(firstPackage.environmentVariables) ? (firstPackage.environmentVariables as unknown[]) : [];
  const hasSecretEnv = envVars.some((envVar) => {
    if (!envVar || typeof envVar !== 'object' || Array.isArray(envVar)) {
      return false;
    }
    return (envVar as Record<string, unknown>).isSecret === true;
  });

  if (hasSecretEnv) {
    return 'api_key';
  }
  if (remotes.length > 0) {
    return 'custom';
  }
  return 'none';
}

function detectCompatibilityFromPackage(pkg: Record<string, unknown>): string[] {
  const words = [
    readString(pkg, ['registryType']) ?? '',
    readString(pkg, ['runtime']) ?? '',
    readString(pkg, ['name']) ?? '',
    readString(pkg, ['identifier']) ?? ''
  ]
    .join(' ')
    .toLowerCase();

  const tags: string[] = [];
  if (words.includes('npm') || words.includes('node')) {
    tags.push('node');
  }
  if (words.includes('pypi') || words.includes('python')) {
    tags.push('python');
  }
  if (words.includes('docker') || words.includes('container')) {
    tags.push('container');
  }

  return tags;
}

function detectCompatibilityFromRemotes(remotes: Record<string, unknown>[]): string[] {
  const tags = new Set<string>();
  remotes.forEach((remote) => {
    const remoteType = readString(remote, ['type'])?.toLowerCase() ?? '';
    if (remoteType.includes('http') || remoteType === 'sse') {
      tags.add('network');
    }
    if (remoteType === 'websocket' || remoteType === 'ws') {
      tags.add('network');
    }
  });
  return Array.from(tags);
}

function scoreFreshness(publishedAt: string | undefined): number {
  if (!publishedAt) {
    return 60;
  }
  const stamp = Date.parse(publishedAt);
  if (!Number.isFinite(stamp)) {
    return 60;
  }
  const ageMs = Date.now() - stamp;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 7) {
    return 95;
  }
  if (ageDays <= 30) {
    return 85;
  }
  if (ageDays <= 90) {
    return 75;
  }
  if (ageDays <= 180) {
    return 65;
  }
  return 55;
}
