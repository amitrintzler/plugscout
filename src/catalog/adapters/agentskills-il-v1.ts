import { dedupe, readString } from './shared.js';

export function adaptAgentskillsIlEntries(sourceId: string, entries: unknown[]): unknown[] {
  return entries
    .map((entry) => mapEntry(sourceId, entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function mapEntry(sourceId: string, entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const source = readString(record, ['_source']);

  if (source === 'mcp') {
    return mapMcpEntry(sourceId, record);
  }

  return mapSkillEntry(sourceId, record);
}

function mapSkillEntry(sourceId: string, record: Record<string, unknown>): Record<string, unknown> | null {
  const slug = readString(record, ['_slug']);
  if (!slug) return null;

  const displayName = resolveLocalized(record['display_name'], 'en') ?? slug;
  const displayDescription = resolveLocalized(record['display_description'], 'en') ?? `AgentSkills IL skill: ${slug}`;
  const tagsEn = extractStringArray(resolveLocalized(record['tags'], 'en'));
  const tagsHe = extractStringArray(resolveLocalized(record['tags'], 'he'));
  const category = readString(record, ['category']) ?? readString(record, ['_repo']) ?? 'general';
  const repoUrl = readString(record, ['_repoUrl']);
  const supportedAgents = extractStringArray(record['supported_agents']);
  const compatibility = dedupe(['general', ...agentsToCompatibility(supportedAgents)]);
  const capabilities = dedupe([...tagsEn, categoryToCapability(category)].filter(Boolean));

  return {
    id: `skill:agentskills-il/${slug}`,
    kind: 'skill',
    provider: 'skills-il',
    name: displayName,
    description: displayDescription,
    capabilities,
    compatibility,
    source: sourceId,
    install: {
      kind: 'manual',
      instructions: `npx skills-il ${slug}`,
      url: repoUrl ?? `https://agentskills.co.il/skills/${slug}`
    },
    adoptionSignal: 55,
    maintenanceSignal: 72,
    provenanceSignal: 85,
    freshnessSignal: 75,
    securitySignals: {
      knownVulnerabilities: 0,
      suspiciousPatterns: 0,
      injectionFindings: 0,
      exfiltrationSignals: 0,
      integrityAlerts: 0
    },
    metadata: {
      repositoryUrl: repoUrl,
      category,
      tagsHe,
      descriptionHe: resolveLocalized(record['display_description'], 'he'),
      version: readString(record, ['version']),
      sourceType: 'vendor-feed',
      sourceConfidence: 'official'
    }
  };
}

function mapMcpEntry(sourceId: string, record: Record<string, unknown>): Record<string, unknown> | null {
  const slug = readString(record, ['_slug']);
  const pkgName = readString(record, ['name']);
  if (!slug && !pkgName) return null;

  const id = slug ?? pkgName ?? '';
  const name = toTitle(slug ?? pkgName?.replace(/^@[^/]+\//, '') ?? id);
  const description = readString(record, ['description']) ?? `AgentSkills IL MCP server: ${id}`;
  const keywords = extractStringArray(record['keywords']);
  const repoUrl = readString(record, ['_repoUrl']);
  const capabilities = dedupe(keywords.length > 0 ? keywords : ['israel']);

  return {
    id: `mcp:agentskills-il/${slug ?? id}`,
    kind: 'mcp',
    provider: 'skills-il',
    name,
    description,
    transport: 'stdio',
    authModel: 'none',
    capabilities,
    compatibility: ['general', 'node'],
    source: sourceId,
    install: {
      kind: 'skill.sh',
      target: pkgName ?? `@skills-il/${slug}`,
      args: []
    },
    adoptionSignal: 50,
    maintenanceSignal: 70,
    provenanceSignal: 85,
    freshnessSignal: 75,
    securitySignals: {
      knownVulnerabilities: 0,
      suspiciousPatterns: 0,
      injectionFindings: 0,
      exfiltrationSignals: 0,
      integrityAlerts: 0
    },
    metadata: {
      repositoryUrl: repoUrl,
      packageIdentifier: pkgName,
      packageRegistryType: 'npm',
      packageRuntime: 'node',
      version: readString(record, ['version']),
      sourceType: 'vendor-feed',
      sourceConfidence: 'official'
    }
  };
}

function resolveLocalized(value: unknown, lang: 'en' | 'he'): string | string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value as string[];
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  const v = rec[lang];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v as string[];
  return undefined;
}

function extractStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }
  return [];
}

function agentsToCompatibility(agents: string[]): string[] {
  const map: Record<string, string> = {
    'claude-code': 'claude',
    cursor: 'cursor',
    'github-copilot': 'github',
    windsurf: 'windsurf',
    'gemini-cli': 'gemini',
    codex: 'openai',
    opencode: 'general',
    antigravity: 'general',
  };
  return agents.map((a) => map[a]).filter((v): v is string => Boolean(v));
}

function categoryToCapability(category: string): string {
  const map: Record<string, string> = {
    'tax-and-finance': 'finance',
    localization: 'localization',
    'government-services': 'government',
    'security-compliance': 'security',
    communication: 'communication',
    'developer-tools': 'automation',
    'food-and-dining': 'food',
    'health-services': 'health',
    'marketing-growth': 'marketing',
    'legal-tech': 'legal',
    education: 'education',
    accounting: 'finance',
    'design-systems': 'design',
    courses: 'education',
  };
  return map[category] ?? category;
}

function toTitle(slug: string): string {
  return slug
    .replace(/^@[^/]+\//, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}
