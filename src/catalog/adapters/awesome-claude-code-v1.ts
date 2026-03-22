import { dedupe, sanitizeUrl, slugify, stripHtml } from './shared.js';

const TRUSTED_HOSTS = ['github.com', 'raw.githubusercontent.com'];

const CSV_COLUMNS = [
  'ID', 'Display Name', 'Category', 'Sub-Category', 'Primary Link',
  'Secondary Link', 'Author Name', 'Author Link', 'Active', 'Date Added',
  'Last Modified', 'Last Checked', 'License', 'Description',
  'Removed From Origin', 'Stale', 'Repo Created', 'Latest Release',
  'Release Version', 'Release Source'
] as const;

type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

export function adaptAwesomeClaudeCodeEntries(sourceId: string, entries: unknown[]): unknown[] {
  const csv = entries.find((entry) => typeof entry === 'string');
  if (typeof csv !== 'string' || csv.trim().length === 0) {
    return [];
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) return [];

  const header = rows[0];
  const dataRows = rows.slice(1);

  const mapped: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const rawRow of dataRows) {
    const row = zipRow(header, rawRow);
    if (!row) continue;

    if (row['Active'].toUpperCase() !== 'TRUE') continue;
    if (row['Stale'].toUpperCase() === 'TRUE') continue;
    if (row['Removed From Origin'].toUpperCase() === 'TRUE') continue;

    const rawName = row['Display Name'].trim();
    const primaryLink = row['Primary Link'].trim();
    const description = row['Description'].trim();
    const category = row['Category'].trim();
    const releaseVersion = row['Release Version'].trim();
    const lastModified = row['Last Modified'].trim();
    const authorName = row['Author Name'].trim();
    const license = row['License'].trim();

    if (!rawName || !primaryLink) continue;

    const slug = slugify(rawName);
    if (!slug || seen.has(slug)) continue;

    const url = sanitizeUrl(primaryLink, TRUSTED_HOSTS);

    seen.add(slug);

    const capabilities = inferCapabilities(rawName, description, category);
    const hasRelease = releaseVersion.length > 0;
    const hasModified = lastModified.length > 0;

    mapped.push({
      id: `skill:${slug}`,
      kind: 'skill',
      provider: 'github',
      name: rawName.slice(0, 120),
      description: stripHtml(
        description || `${category} resource for Claude Code: ${rawName}.`,
        320
      ) || `Claude Code ${category} resource: ${rawName}.`,
      capabilities,
      compatibility: ['claude-code'],
      source: sourceId,
      install: {
        kind: 'manual',
        instructions: 'Visit the linked repository and follow its installation instructions.',
        ...(url ? { url } : {})
      },
      adoptionSignal: 72,
      maintenanceSignal: hasRelease ? 78 : hasModified ? 70 : 62,
      provenanceSignal: 82,
      freshnessSignal: hasModified ? 72 : 60,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 0,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      },
      metadata: {
        catalogType: 'skill',
        sourceConfidence: 'vetted-curated',
        awesomeClaudeCodeId: row['ID'],
        awesomeClaudeCodeCategory: category,
        ...(authorName ? { authorName } : {}),
        ...(license ? { license } : {}),
        ...(releaseVersion ? { releaseVersion } : {})
      }
    });
  }

  return mapped;
}

function zipRow(header: string[], values: string[]): CsvRow | null {
  if (values.length === 0) return null;
  const row = {} as Record<string, string>;
  for (let i = 0; i < header.length; i++) {
    row[header[i]] = values[i] ?? '';
  }
  return row as CsvRow;
}

function inferCapabilities(name: string, description: string, category: string): string[] {
  const haystack = `${name} ${description} ${category}`.toLowerCase();
  const capabilities: string[] = [];

  if (/(security|audit|vulnerability|compliance|malware)/.test(haystack)) capabilities.push('security');
  if (/(workflow|automation|ci|cd|devops|deploy|pipeline)/.test(haystack)) capabilities.push('automation');
  if (/(frontend|ui|design|css|react|vue|html)/.test(haystack)) capabilities.push('frontend');
  if (/(database|sql|postgres|redis|mongo)/.test(haystack)) capabilities.push('data');
  if (/(docs|documentation|guide|knowledge|handbook)/.test(haystack)) capabilities.push('docs');
  if (/(test|debug|review|qa|lint)/.test(haystack)) capabilities.push('guardrails');
  if (/(agent|orchestrat|subagent|multi-agent)/.test(haystack)) capabilities.push('orchestration');

  return dedupe(capabilities.length ? capabilities : ['automation']);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    rows.push(parseCsvLine(line));
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}
