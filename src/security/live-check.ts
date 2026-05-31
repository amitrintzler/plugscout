import path from 'node:path';
import fs from 'fs-extra';

import type { CatalogItem } from '../lib/validation/contracts.js';
import { getStatePath } from '../lib/paths.js';

export interface LiveFinding {
  severity: 'info' | 'warn' | 'critical';
  text: string;
}

export interface LiveCheckResult {
  source: string;
  label: string;
  status: 'clean' | 'flagged' | 'unavailable' | 'error';
  findings: LiveFinding[];
  checkedAt: string;
}

interface CacheEntry {
  results: LiveCheckResult[];
  cachedAt: string;
}

const TTL_MS: Record<string, number> = {
  'osv': 6 * 60 * 60 * 1000,
  'npm-registry': 6 * 60 * 60 * 1000,
  'vscode-marketplace': 6 * 60 * 60 * 1000,
  'github': 60 * 60 * 1000,
  'url-health': 60 * 60 * 1000,
};
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

async function readCache(itemId: string): Promise<LiveCheckResult[] | null> {
  const p = getStatePath('data', 'live-checks', `${itemId.replace(/[^a-zA-Z0-9-_.]/g, '_')}.json`);
  try {
    const entry = await fs.readJson(p) as CacheEntry;
    const now = Date.now();
    // Each result may have a different TTL — use the shortest applicable
    const allFresh = entry.results.every(r => {
      const ttl = TTL_MS[r.source] ?? DEFAULT_TTL_MS;
      return now - new Date(r.checkedAt).getTime() < ttl;
    });
    return allFresh ? entry.results : null;
  } catch {
    return null;
  }
}

async function writeCache(itemId: string, results: LiveCheckResult[]): Promise<void> {
  const p = getStatePath('data', 'live-checks', `${itemId.replace(/[^a-zA-Z0-9-_.]/g, '_')}.json`);
  const entry: CacheEntry = { results, cachedAt: new Date().toISOString() };
  try {
    await fs.ensureFile(p);
    await fs.writeJson(p, entry, { spaces: 2 });
  } catch {
    // cache write failure is non-fatal
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkOsv(pkg: string): Promise<LiveCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(
      'https://api.osv.dev/v1/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: { name: pkg, ecosystem: 'npm' } }),
      },
      6000
    );
    if (!res.ok) {
      return { source: 'osv', label: 'OSV vulnerability database', status: 'error', findings: [], checkedAt };
    }
    const data = await res.json() as {
      vulns?: Array<{ id: string; summary?: string }>;
    };
    const vulns = data.vulns ?? [];
    if (vulns.length === 0) {
      return {
        source: 'osv', label: 'OSV vulnerability database', status: 'clean',
        findings: [{ severity: 'info', text: 'No known vulnerabilities' }],
        checkedAt,
      };
    }
    return {
      source: 'osv', label: 'OSV vulnerability database', status: 'flagged',
      findings: vulns.slice(0, 5).map(v => ({
        severity: 'critical' as const,
        text: `${v.id}${v.summary ? ': ' + v.summary.slice(0, 100) : ''}`,
      })),
      checkedAt,
    };
  } catch {
    return { source: 'osv', label: 'OSV vulnerability database', status: 'error', findings: [{ severity: 'info', text: 'Check timed out' }], checkedAt };
  }
}

async function checkNpmRegistry(pkg: string): Promise<LiveCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(
      `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`,
      { headers: { 'User-Agent': 'plugscout/1.0' } },
      6000
    );
    if (!res.ok) {
      return { source: 'npm-registry', label: 'npm registry', status: 'unavailable', findings: [{ severity: 'warn', text: `Package not found (HTTP ${res.status})` }], checkedAt };
    }
    const data = await res.json() as { deprecated?: string | boolean; version?: string };
    if (data.deprecated) {
      const msg = typeof data.deprecated === 'string' ? data.deprecated : 'package is deprecated';
      return {
        source: 'npm-registry', label: 'npm registry', status: 'flagged',
        findings: [{ severity: 'warn', text: `Deprecated: ${msg}` }],
        checkedAt,
      };
    }
    return {
      source: 'npm-registry', label: 'npm registry', status: 'clean',
      findings: [{ severity: 'info', text: `Latest: v${data.version ?? 'unknown'} — not deprecated` }],
      checkedAt,
    };
  } catch {
    return { source: 'npm-registry', label: 'npm registry', status: 'error', findings: [{ severity: 'info', text: 'Check timed out' }], checkedAt };
  }
}

interface MarketplaceCheckResult {
  result: LiveCheckResult;
  repositoryUrl?: string;
}

async function checkVscodeMarketplace(vsixId: string): Promise<MarketplaceCheckResult> {
  const checkedAt = new Date().toISOString();
  const error = (status: LiveCheckResult['status'], text?: string): MarketplaceCheckResult => ({
    result: { source: 'vscode-marketplace', label: 'VS Code Marketplace', status, findings: text ? [{ severity: 'info' as const, text }] : [], checkedAt },
  });
  try {
    const res = await fetchWithTimeout(
      'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json;api-version=7.2-preview.1',
          'User-Agent': 'plugscout/1.0',
        },
        body: JSON.stringify({
          filters: [{ criteria: [{ filterType: 7, value: vsixId }] }],
          // statistics (0x200) + assetUri (0x100) + excludeNonValidated (0x20) + versionProperties (0x10)
          flags: 0x200 | 0x100 | 0x20 | 0x10,
        }),
      },
      8000
    );
    if (!res.ok) return error('error');
    const data = await res.json() as {
      results?: Array<{
        extensions?: Array<{
          publisher: { isDomainVerified?: boolean };
          versions?: Array<{
            version: string;
            lastUpdated: string;
            properties?: Array<{ key: string; value: string }>;
          }>;
          statistics?: Array<{ statisticName: string; value: number }>;
        }>;
      }>;
    };
    const ext = data.results?.[0]?.extensions?.[0];
    if (!ext) {
      return {
        result: {
          source: 'vscode-marketplace', label: 'VS Code Marketplace', status: 'unavailable',
          findings: [{ severity: 'warn', text: 'Extension not found in marketplace — may have been removed' }],
          checkedAt,
        },
      };
    }

    // Extract GitHub repository URL from version properties
    const props = ext.versions?.[0]?.properties ?? [];
    const repoProp = props.find(p =>
      p.key === 'Microsoft.VisualStudio.Services.Links.Source' ||
      p.key === 'Microsoft.VisualStudio.Services.Links.GitHub'
    );
    const repositoryUrl = repoProp?.value?.includes('github.com') ? repoProp.value : undefined;

    const findings: LiveFinding[] = [];
    const verified = ext.publisher.isDomainVerified ?? false;
    const latest = ext.versions?.[0];
    const installs = ext.statistics?.find(s => s.statisticName === 'install')?.value ?? 0;

    findings.push({
      severity: verified ? 'info' : 'warn',
      text: verified ? 'Publisher domain verified' : 'Publisher not domain-verified',
    });
    if (latest) {
      findings.push({ severity: 'info', text: `v${latest.version} — updated ${latest.lastUpdated.slice(0, 10)}` });
    }
    if (installs > 0) {
      findings.push({ severity: 'info', text: `${installs.toLocaleString()} installs` });
    }
    return {
      result: {
        source: 'vscode-marketplace', label: 'VS Code Marketplace',
        status: verified ? 'clean' : 'flagged',
        findings, checkedAt,
      },
      repositoryUrl,
    };
  } catch {
    return error('error', 'Check timed out');
  }
}

function extractGithubOwnerRepo(url: string): string | null {
  const m = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\/|$|#|\?|\.git)/);
  return m ? m[1] : null;
}

async function checkGithubRepo(ownerRepo: string): Promise<LiveCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${ownerRepo}`,
      { headers: { 'User-Agent': 'plugscout/1.0', 'Accept': 'application/vnd.github.v3+json' } },
      6000
    );
    if (res.status === 404) {
      return {
        source: 'github', label: 'GitHub repository', status: 'unavailable',
        findings: [{ severity: 'warn', text: 'Repository not found or private' }],
        checkedAt,
      };
    }
    if (res.status === 403) {
      return { source: 'github', label: 'GitHub repository', status: 'error', findings: [{ severity: 'info', text: 'Rate limited — try again later' }], checkedAt };
    }
    if (!res.ok) {
      return { source: 'github', label: 'GitHub repository', status: 'error', findings: [], checkedAt };
    }
    const repo = await res.json() as { archived: boolean; disabled: boolean; pushed_at?: string };
    const findings: LiveFinding[] = [];
    if (repo.disabled) {
      findings.push({ severity: 'critical', text: 'Repository is disabled' });
    } else if (repo.archived) {
      findings.push({ severity: 'warn', text: 'Repository is archived — no longer maintained' });
    } else {
      const lastPush = repo.pushed_at ? repo.pushed_at.slice(0, 10) : 'unknown';
      findings.push({ severity: 'info', text: `Active — last push: ${lastPush}` });
    }
    return {
      source: 'github', label: 'GitHub repository',
      status: (repo.archived || repo.disabled) ? 'flagged' : 'clean',
      findings, checkedAt,
    };
  } catch {
    return { source: 'github', label: 'GitHub repository', status: 'error', findings: [{ severity: 'info', text: 'Check timed out' }], checkedAt };
  }
}

async function checkUrlHealth(url: string): Promise<LiveCheckResult> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', headers: { 'User-Agent': 'plugscout/1.0' } }, 6000);
    // 405 = HEAD not allowed but server is live
    const reachable = res.status < 400 || res.status === 405;
    return {
      source: 'url-health', label: 'Install URL',
      status: reachable ? 'clean' : 'flagged',
      findings: [{ severity: reachable ? 'info' : 'warn', text: `HTTP ${res.status} — ${reachable ? 'reachable' : 'not reachable'}` }],
      checkedAt,
    };
  } catch {
    return {
      source: 'url-health', label: 'Install URL', status: 'flagged',
      findings: [{ severity: 'warn', text: 'URL unreachable' }],
      checkedAt,
    };
  }
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function findGithubOwnerRepo(item: CatalogItem, meta: Record<string, unknown>): string | null {
  const candidates = [meta.repositoryUrl, meta.githubUrl, meta.sourceRepo];
  for (const c of candidates) {
    if (typeof c === 'string') {
      if (c.includes('github.com')) {
        const r = extractGithubOwnerRepo(c);
        if (r) return r;
      } else if (!c.startsWith('http') && c.includes('/')) {
        return c;
      }
    }
  }
  const installUrl = (item.install as Record<string, unknown>).url;
  if (typeof installUrl === 'string' && installUrl.includes('github.com')) {
    return extractGithubOwnerRepo(installUrl);
  }
  return null;
}

export async function runLiveChecks(item: CatalogItem, opts: { noCache?: boolean } = {}): Promise<LiveCheckResult[]> {
  if (!opts.noCache) {
    const cached = await readCache(item.id);
    if (cached) return cached;
  }

  const meta = asMetadata(item.metadata);
  const checks: Promise<LiveCheckResult>[] = [];

  const npmPkg = typeof meta.npmPackage === 'string' ? meta.npmPackage : null;
  if (npmPkg) {
    checks.push(checkOsv(npmPkg));
    checks.push(checkNpmRegistry(npmPkg));
  }

  // cursor-extension: marketplace first (to extract repo URL), then github check if found
  const cursorMarketplaceResults: LiveCheckResult[] = [];
  if (item.kind === 'cursor-extension') {
    const vsixId = typeof meta.vsixId === 'string' ? meta.vsixId : null;
    if (vsixId) {
      const mkt = await checkVscodeMarketplace(vsixId);
      cursorMarketplaceResults.push(mkt.result);
      const ghOwnerRepo = mkt.repositoryUrl ? extractGithubOwnerRepo(mkt.repositoryUrl) : findGithubOwnerRepo(item, meta);
      if (ghOwnerRepo) {
        checks.push(checkGithubRepo(ghOwnerRepo));
      }
    }
  } else {
    const ghOwnerRepo = findGithubOwnerRepo(item, meta);
    if (ghOwnerRepo) {
      checks.push(checkGithubRepo(ghOwnerRepo));
    }
  }

  if (item.kind === 'claude-plugin' || item.kind === 'claude-connector') {
    const installUrl = (item.install as Record<string, unknown>).url;
    if (typeof installUrl === 'string' && installUrl.startsWith('https://')) {
      checks.push(checkUrlHealth(installUrl));
    }
  }

  const results = [...cursorMarketplaceResults, ...(checks.length > 0 ? await Promise.all(checks) : [])];
  if (results.length === 0) return [];

  await writeCache(item.id, results);
  return results;
}

export function formatLiveChecks(results: LiveCheckResult[]): string {
  if (results.length === 0) return '';
  const lines: string[] = ['\nLive checks:'];
  for (const r of results) {
    const icon = r.status === 'clean' ? '\x1b[32m✓\x1b[0m'
      : r.status === 'flagged' ? '\x1b[31m✗\x1b[0m'
      : r.status === 'unavailable' ? '\x1b[33m?\x1b[0m'
      : '\x1b[90m~\x1b[0m';
    const cached = new Date(r.checkedAt).getTime() < Date.now() - 10000 ? ' \x1b[90m(cached)\x1b[0m' : '';
    lines.push(`  ${icon} ${r.label}${cached}`);
    for (const f of r.findings) {
      const fc = f.severity === 'critical' ? '\x1b[31m' : f.severity === 'warn' ? '\x1b[33m' : '\x1b[90m';
      lines.push(`      ${fc}${f.text}\x1b[0m`);
    }
  }
  return lines.join('\n');
}

export async function clearLiveCheckCache(itemId?: string): Promise<void> {
  if (itemId) {
    const p = getStatePath('data', 'live-checks', `${itemId.replace(/[^a-zA-Z0-9-_.]/g, '_')}.json`);
    await fs.remove(p);
  } else {
    await fs.emptyDir(getStatePath('data', 'live-checks'));
  }
}

// Suppress unused import warning — path is used implicitly via getStatePath internals
void path.resolve;
