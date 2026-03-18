import type { Registry } from '../../lib/validation/contracts.js';
import { dedupe, readString, sanitizeUrl, slugify, stripHtml, toCount, toScore } from './shared.js';

const TRUSTED_HOSTS = ['github.com', 'raw.githubusercontent.com'];

export function adaptClaudeCodeMarketplaceEntries(registry: Registry, entries: unknown[]): unknown[] {
  const seen = new Set<string>();
  const mapped: Record<string, unknown>[] = [];

  for (const entry of entries) {
    const candidates = mapMarketplaceEntries(registry, entry);
    for (const candidate of candidates) {
      const candidateId = candidate.id;
      if (typeof candidateId !== 'string' || seen.has(candidateId)) {
        continue;
      }

      seen.add(candidateId);
      mapped.push(candidate);
    }
  }

  return mapped;
}

function mapMarketplaceEntries(registry: Registry, entry: unknown): Record<string, unknown>[] {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [];
  }

  const record = entry as Record<string, unknown>;
  const rawName = readString(record, ['name', 'title', 'id']);
  if (!rawName) {
    return [];
  }

  if (registry.kind === 'skill') {
    const skills = extractSkillRefs(record);
    if (skills.length > 0) {
      return skills
        .map((skillRef) => mapBundledSkillEntry(registry, record, rawName, skillRef))
        .filter((value): value is Record<string, unknown> => value !== null);
    }
  }

  const slug = slugify(rawName);
  if (!slug) {
    return [];
  }

  const kind = registry.kind;
  const description =
    stripHtml(readString(record, ['description']) ?? defaultDescription(kind, rawName), 320) ||
    defaultDescription(kind, rawName);
  const sourceUrl = resolveMarketplaceSourceUrl(registry, record);
  const version = readString(record, ['version']);
  const capabilities = dedupe(
    extractTags(record)
      .concat(extractSkillRefs(record))
      .concat(inferCapabilities(rawName, description))
  );
  const compatibility = inferCompatibility(kind, capabilities);

  return [{
    id: `${kind}:${slug}`,
    kind,
    provider: registry.remote?.provider ?? 'github',
    name: rawName.trim().slice(0, 120),
    description,
    capabilities,
    compatibility,
    source: registry.id,
    install: {
      kind: 'manual',
      instructions: defaultInstallInstructions(kind),
      ...(sourceUrl ? { url: sourceUrl } : {})
    },
    adoptionSignal: toScore(record.adoptionSignal, registry.sourceType === 'vendor-feed' ? 66 : 58),
    maintenanceSignal: toScore(record.maintenanceSignal, version ? 78 : 70),
    provenanceSignal: toScore(record.provenanceSignal, registry.sourceType === 'vendor-feed' ? 88 : 74),
    freshnessSignal: toScore(record.freshnessSignal, version ? 76 : 68),
    securitySignals: {
      knownVulnerabilities: toCount(record.knownVulnerabilities),
      suspiciousPatterns: toCount(record.suspiciousPatterns),
      injectionFindings: toCount(record.injectionFindings),
      exfiltrationSignals: toCount(record.exfiltrationSignals),
      integrityAlerts: toCount(record.integrityAlerts)
    },
    metadata: {
      catalogType: kind === 'skill' ? 'skill' : 'plugin',
      marketplaceRegistry: registry.id,
      marketplaceSource: 'github',
      rawVersion: version ?? 'unknown',
      sourceConfidence: registry.sourceType === 'vendor-feed' ? 'official' : 'vetted-curated',
      ...(sourceUrl ? { githubUrl: sourceUrl } : {})
    }
  }];
}

function defaultDescription(kind: Registry['kind'], rawName: string): string {
  if (kind === 'skill') {
    return `GitHub marketplace skill: ${rawName}.`;
  }

  return `GitHub marketplace Claude Code plugin: ${rawName}.`;
}

function defaultInstallInstructions(kind: Registry['kind']): string {
  if (kind === 'skill') {
    return 'Review the linked GitHub skill and follow its repository installation instructions.';
  }

  return 'Review the linked GitHub Claude Code plugin and follow its repository installation instructions.';
}

function extractTags(record: Record<string, unknown>): string[] {
  const tags: string[] = [];

  for (const field of ['keywords', 'tags']) {
    const value = record[field];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (typeof item === 'string' && item.trim().length > 0) {
        tags.push(item.trim().toLowerCase());
      }
    }
  }

  const category = readString(record, ['category']);
  if (category) {
    tags.push(category.toLowerCase());
  }

  return dedupe(tags);
}

function extractSkillRefs(record: Record<string, unknown>): string[] {
  const value = record.skills;
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim().length > 0) {
      refs.push(item.trim().replace(/^\.?\//, '').toLowerCase());
    }
  }

  return dedupe(refs);
}

function mapBundledSkillEntry(
  registry: Registry,
  record: Record<string, unknown>,
  rawName: string,
  skillRef: string
): Record<string, unknown> | null {
  const slug = slugify(skillRef.split('/').at(-1) ?? skillRef);
  if (!slug) {
    return null;
  }

  const description =
    stripHtml(
      readString(record, ['description']) ?? `GitHub marketplace skill from ${rawName}: ${skillRef}.`,
      320
    ) || `GitHub marketplace skill from ${rawName}: ${skillRef}.`;
  const sourceUrl = resolveMarketplaceSourceUrl(registry, { ...record, source: `./${skillRef}` });
  const version = readString(record, ['version']);
  const capabilities = dedupe(
    extractTags(record).concat(extractSkillRefs(record)).concat(inferCapabilities(skillRef, description))
  );

  return {
    id: `skill:${slug}`,
    kind: 'skill',
    provider: registry.remote?.provider ?? 'github',
    name: slug,
    description,
    capabilities,
    compatibility: inferCompatibility('skill', capabilities),
    source: registry.id,
    install: {
      kind: 'manual',
      instructions: defaultInstallInstructions('skill'),
      ...(sourceUrl ? { url: sourceUrl } : {})
    },
    adoptionSignal: toScore(record.adoptionSignal, registry.sourceType === 'vendor-feed' ? 66 : 58),
    maintenanceSignal: toScore(record.maintenanceSignal, version ? 78 : 70),
    provenanceSignal: toScore(record.provenanceSignal, registry.sourceType === 'vendor-feed' ? 88 : 74),
    freshnessSignal: toScore(record.freshnessSignal, version ? 76 : 68),
    securitySignals: {
      knownVulnerabilities: toCount(record.knownVulnerabilities),
      suspiciousPatterns: toCount(record.suspiciousPatterns),
      injectionFindings: toCount(record.injectionFindings),
      exfiltrationSignals: toCount(record.exfiltrationSignals),
      integrityAlerts: toCount(record.integrityAlerts)
    },
    metadata: {
      catalogType: 'skill',
      marketplacePlugin: rawName,
      marketplaceRegistry: registry.id,
      marketplaceSource: 'github',
      rawVersion: version ?? 'unknown',
      sourceConfidence: registry.sourceType === 'vendor-feed' ? 'official' : 'vetted-curated',
      bundledSkillPath: skillRef,
      ...(sourceUrl ? { githubUrl: sourceUrl } : {})
    }
  };
}

function inferCapabilities(name: string, description: string): string[] {
  const haystack = `${name} ${description}`.toLowerCase();
  const capabilities: string[] = [];

  if (/(browser|devtools|screenshot|web automation|playwright)/.test(haystack)) {
    capabilities.push('browser-control');
  }
  if (/(security|sast|vulnerability|compliance|audit|auth)/.test(haystack)) {
    capabilities.push('security');
  }
  if (/(database|postgres|redis|drizzle|sql|neo4j)/.test(haystack)) {
    capabilities.push('data');
  }
  if (/(github|workflow|orchestration|automation|ci|cd|build)/.test(haystack)) {
    capabilities.push('automation');
  }
  if (/(docs|documentation|markdown|diagram|mermaid|presentation)/.test(haystack)) {
    capabilities.push('docs');
  }
  if (/(prompt|rag|evaluation|testing|review)/.test(haystack)) {
    capabilities.push('guardrails');
  }
  if (capabilities.length === 0) {
    capabilities.push('automation');
  }

  return dedupe(capabilities);
}

function inferCompatibility(kind: Registry['kind'], capabilities: string[]): string[] {
  const compatibility = kind === 'skill' ? ['claude-code', 'codex', 'general'] : ['claude', 'claude-code'];

  if (capabilities.includes('browser-control') || capabilities.includes('automation')) {
    compatibility.push('node');
  }
  if (capabilities.includes('data')) {
    compatibility.push('database');
  }
  if (capabilities.includes('security')) {
    compatibility.push('github');
  }

  return dedupe(compatibility);
}

function resolveMarketplaceSourceUrl(
  registry: Registry,
  record: Record<string, unknown>
): string | undefined {
  const direct = sanitizeUrl(readString(record, ['homepage', 'repository', 'url']), TRUSTED_HOSTS);
  if (direct) {
    return direct;
  }

  const source = record.source;
  if (typeof source === 'string' && source.trim().length > 0) {
    const sanitized = sanitizeUrl(source, TRUSTED_HOSTS);
    if (sanitized) {
      return sanitized;
    }

    const repoContext = deriveGitHubRepoContext(registry.remote?.url);
    if (repoContext) {
      const normalized = source.trim().replace(/^\.?\//, '');
      return `${repoContext.treeUrl}/${normalized}`;
    }
  }

  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const sourceRecord = source as Record<string, unknown>;
    const repo = readString(sourceRecord, ['repo', 'repository']);
    if (repo) {
      return sanitizeUrl(`https://github.com/${repo}`, TRUSTED_HOSTS);
    }
  }

  return deriveGitHubRepoContext(registry.remote?.url)?.repoUrl;
}

function deriveGitHubRepoContext(
  remoteUrl: string | undefined
): { repoUrl: string; treeUrl: string } | null {
  if (!remoteUrl) {
    return null;
  }

  try {
    const url = new URL(remoteUrl);
    if (url.hostname !== 'raw.githubusercontent.com') {
      return null;
    }

    const [owner, repo, branch] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo || !branch) {
      return null;
    }

    return {
      repoUrl: `https://github.com/${owner}/${repo}`,
      treeUrl: `https://github.com/${owner}/${repo}/tree/${branch}`
    };
  } catch {
    return null;
  }
}
