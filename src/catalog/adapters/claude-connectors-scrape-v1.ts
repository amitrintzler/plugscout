import { dedupe, sanitizeUrl, slugify, stripHtml } from './shared.js';

const TRUSTED_HOSTS = ['claude.com', 'www.claude.com', 'anthropic.com', 'www.anthropic.com'];
const CONNECTOR_PATH_PATTERN = /(?:https:\/\/claude\.com)?\/connectors\/([a-z0-9-]+)/gi;

export function adaptClaudeConnectorsScrapeEntries(sourceId: string, entries: unknown[]): unknown[] {
  const html = entries.find((entry) => typeof entry === 'string');
  if (typeof html !== 'string' || html.trim().length === 0) {
    return [];
  }

  const connectorSlugs = collectConnectorSlugs(html);
  const mapped: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const slug of connectorSlugs) {
    const id = `claude-connector:${slug}`;
    if (seen.has(id)) {
      continue;
    }

    const snippet = extractAnchorSnippet(html, slug);
    const label = stripHtml(snippet, 120);
    const name = titleizeSlug(label.length >= 3 ? label : slug);
    const link = sanitizeUrl(`https://claude.com/connectors/${slug}`, TRUSTED_HOSTS);
    if (!link) {
      continue;
    }

    seen.add(id);
    mapped.push({
      id,
      kind: 'claude-connector',
      provider: 'anthropic',
      name: sanitizeText(name, 120),
      description: sanitizeText(
        `Connector listed on Claude Connectors for ${name}. Verify connector permissions before enabling.`,
        320
      ),
      capabilities: inferCapabilities(name, slug),
      compatibility: ['claude', 'mcp'],
      source: sourceId,
      install: {
        kind: 'manual',
        instructions: 'Enable this connector from Claude Connectors.',
        url: link
      },
      adoptionSignal: 52,
      maintenanceSignal: 60,
      provenanceSignal: 72,
      freshnessSignal: 65,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 1,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      },
      metadata: {
        catalogType: 'connector',
        sourcePage: 'https://claude.com/connectors',
        scrapedAt: new Date().toISOString(),
        sourceConfidence: 'scraped'
      }
    });
  }

  return mapped;
}

function collectConnectorSlugs(html: string): string[] {
  const slugs = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = CONNECTOR_PATH_PATTERN.exec(html)) !== null) {
    const slug = slugify(match[1] ?? '');
    if (!slug) {
      continue;
    }
    slugs.add(slug);
  }

  return Array.from(slugs).sort((a, b) => a.localeCompare(b));
}

function extractAnchorSnippet(html: string, slug: string): string {
  const pattern = new RegExp(`<a[^>]+href="(?:https:\\/\\/claude\\.com)?\\/connectors\\/${slug}"[^>]*>([\\s\\S]{0,500}?)<\\/a>`, 'i');
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

  if (/(jira|linear|asana|clickup|trello|task)/.test(text)) {
    capabilities.push('tickets');
  }
  if (/(github|gitlab|bitbucket|repo|code)/.test(text)) {
    capabilities.push('code-scanning');
  }
  if (/(drive|dropbox|box|sharepoint|doc|notion|confluence)/.test(text)) {
    capabilities.push('docs');
  }
  if (/(salesforce|hubspot|crm|zendesk|intercom)/.test(text)) {
    capabilities.push('search');
  }
  capabilities.push('automation');

  return dedupe(capabilities);
}
