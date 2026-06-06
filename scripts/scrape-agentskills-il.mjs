/**
 * Scrape skills-il GitHub org and bundle metadata into assets/registries/agentskills-il.json
 *
 * Run: node scripts/scrape-agentskills-il.mjs
 * Uses GITHUB_TOKEN env var if set (avoids rate limiting).
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../assets/registries/agentskills-il.json');

const ORG = 'skills-il';
const SKILL_CATEGORY_REPOS = [
  'tax-and-finance',
  'localization',
  'government-services',
  'security-compliance',
  'communication',
  'developer-tools',
  'food-and-dining',
  'health-services',
  'marketing-growth',
  'legal-tech',
  'education',
  'accounting',
  'design-systems',
  'courses',
];

const HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'plugscout-scraper/1.0',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function ghGet(path) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchMetadataJson(repo, dir) {
  try {
    const item = await ghGet(`/repos/${ORG}/${repo}/contents/${dir}/metadata.json`);
    const content = Buffer.from(item.content, 'base64').toString('utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function fetchPackageJson(repo, dir) {
  try {
    const item = await ghGet(`/repos/${ORG}/${repo}/contents/${dir}/package.json`);
    const content = Buffer.from(item.content, 'base64').toString('utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function listDirs(repo) {
  const contents = await ghGet(`/repos/${ORG}/${repo}/contents/`);
  return contents
    .filter((item) => item.type === 'dir' && !item.name.startsWith('.') && item.name !== 'scripts')
    .map((item) => item.name);
}

async function scrapeSkillRepo(repo) {
  const dirs = await listDirs(repo);
  const results = [];

  for (const dir of dirs) {
    const meta = await fetchMetadataJson(repo, dir);
    if (!meta) continue;

    results.push({
      _source: 'skill',
      _repo: repo,
      _slug: dir,
      _repoUrl: `https://github.com/${ORG}/${repo}/tree/main/${dir}`,
      ...meta,
    });

    process.stdout.write('.');
  }

  return results;
}

async function scrapeMcpRepo() {
  const dirs = await listDirs('mcps');
  const results = [];

  for (const dir of dirs) {
    const pkg = await fetchPackageJson('mcps', dir);
    if (!pkg) continue;

    results.push({
      _source: 'mcp',
      _repo: 'mcps',
      _slug: dir,
      _repoUrl: `https://github.com/${ORG}/mcps/tree/main/${dir}`,
      name: pkg.name ?? dir,
      version: pkg.version,
      description: pkg.description ?? '',
      keywords: pkg.keywords ?? [],
    });

    process.stdout.write('.');
  }

  return results;
}

async function main() {
  const all = [];

  for (const repo of SKILL_CATEGORY_REPOS) {
    process.stdout.write(`\n  ${repo}: `);
    try {
      const entries = await scrapeSkillRepo(repo);
      all.push(...entries);
      process.stdout.write(` (${entries.length})`);
    } catch (err) {
      process.stdout.write(` ERROR: ${err.message}`);
    }
  }

  process.stdout.write('\n  mcps: ');
  try {
    const mcpEntries = await scrapeMcpRepo();
    all.push(...mcpEntries);
    process.stdout.write(` (${mcpEntries.length})`);
  } catch (err) {
    process.stdout.write(` ERROR: ${err.message}`);
  }

  console.log(`\n\nTotal: ${all.length} entries`);

  writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf-8');
  console.log(`Written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
