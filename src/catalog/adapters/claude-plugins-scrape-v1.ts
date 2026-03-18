import { dedupe, sanitizeUrl, slugify, stripHtml } from './shared.js';

const TRUSTED_HOSTS = ['claude.com', 'www.claude.com', 'anthropic.com', 'www.anthropic.com'];
const PLUGIN_PATH_PATTERN = /(?:https:\/\/claude\.com)?\/plugins\/([a-z0-9-]+)/gi;

export function adaptClaudePluginsScrapeEntries(sourceId: string, entries: unknown[]): unknown[] {
  const html = entries.find((entry) => typeof entry === 'string');
  if (typeof html !== 'string' || html.trim().length === 0) {
    return [];
  }

  const pluginSlugs = collectPluginSlugs(html);
  const mapped: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const slug of pluginSlugs) {
    const id = `claude-plugin:${slug}`;
    if (seen.has(id)) {
      continue;
    }

    const snippet = extractAnchorSnippet(html, slug);
    const label = stripHtml(snippet, 140);
    const name = titleizeSlug(label.length >= 3 ? label : slug);
    const link = sanitizeUrl(`https://claude.com/plugins/${slug}`, TRUSTED_HOSTS);
    if (!link) {
      continue;
    }

    seen.add(id);
    mapped.push({
      id,
      kind: 'claude-plugin',
      provider: 'anthropic',
      name: sanitizeText(name, 140),
      description: sanitizeText(
        `Plugin listed on Claude Plugins for ${name}. Review plugin behavior and permissions before enabling.`,
        320
      ),
      capabilities: inferCapabilities(name, slug),
      compatibility: ['claude', 'claude-code', 'cowork'],
      source: sourceId,
      install: {
        kind: 'manual',
        instructions: 'Enable this plugin from Claude Plugins.',
        url: link
      },
      adoptionSignal: 58,
      maintenanceSignal: 68,
      provenanceSignal: 88,
      freshnessSignal: 72,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 0,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      },
      metadata: {
        catalogType: 'plugin',
        sourcePage: 'https://claude.com/plugins',
        scrapedAt: new Date().toISOString(),
        sourceConfidence: 'scraped'
      }
    });
  }

  return mapped;
}

function collectPluginSlugs(html: string): string[] {
  const slugs = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = PLUGIN_PATH_PATTERN.exec(html)) !== null) {
    const slug = slugify(match[1] ?? '');
    if (!slug) {
      continue;
    }
    slugs.add(slug);
  }

  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}

function extractAnchorSnippet(html: string, slug: string): string {
  const pattern = new RegExp(`<a[^>]+href="(?:https:\\/\\/claude\\.com)?\\/plugins\\/${slug}"[^>]*>([\\s\\S]{0,700}?)<\\/a>`, 'i');
  const match = html.match(pattern);
  if (!match || typeof match[1] !== 'string') {
    return '';
  }
  return match[1];
}

function sanitizeText(value: string, maxLength: number): string {
  return stripHtml(value, maxLength).slice(0, maxLength);
}

function titleizeSlug(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/g)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join(' ');
}

function inferCapabilities(name: string, slug: string): string[] {
  const text = `${name} ${slug}`.toLowerCase();
  const capabilities: string[] = [];

  if (/(github|gitlab|repo|review|commit|code|playwright|lsp|semgrep|sentry|security)/.test(text)) {
    capabilities.push('code-scanning');
  }
  if (/(asana|atlassian|linear|slack|notion|figma|product|operations|support)/.test(text)) {
    capabilities.push('automation');
  }
  if (/(research|finance|legal|marketing|sales|enterprise-search|data)/.test(text)) {
    capabilities.push('search');
  }
  if (/(design|brand|learning|output-style|creator|setup|management)/.test(text)) {
    capabilities.push('prompting');
  }

  capabilities.push('automation');

  return dedupe(capabilities);
}
