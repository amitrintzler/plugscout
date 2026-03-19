import fs from 'node:fs/promises';

import { loadCatalogItems, loadQuarantine, loadWhitelist } from '../../../catalog/repository.js';
import { getStaleRegistries, loadSyncState } from '../../../catalog/sync-state.js';
import { getPackagePath } from '../../../lib/paths.js';
import { colors } from '../formatters/colors.js';

interface PackageMeta {
  name?: string;
  version?: string;
  author?: string;
}

export async function renderHomeScreen(): Promise<string> {
  const [logo, pkg, catalogStats, runtimeStats] = await Promise.all([
    readLogo(),
    readPackageMeta(),
    readCatalogStats(),
    readRuntimeStats()
  ]);

  const lines: string[] = [];
  const displayName = (pkg.name ?? 'plugscout') === 'plugscout' ? 'PlugScout' : (pkg.name ?? 'plugscout');
  const version = pkg.version ?? '0.0.0';
  const author = pkg.author ?? '';
  const metaLine = author
    ? `         v${version}  ·  maintained by ${author}`
    : `         v${version}`;
  lines.push(colorIfTty(logo.trimEnd() + '\n' + metaLine, colors.cyan));
  lines.push('');
  lines.push('Discover and safely install Claude plugins, Claude connectors, Copilot extensions, Skills, and MCP servers.');
  lines.push('');
  lines.push(colorIfTty('Catalog', colors.bold));
  lines.push(
    `- items=${catalogStats.items} skill=${catalogStats.skill} mcp=${catalogStats.mcp} claude-plugin=${catalogStats.claudePlugin} claude-connector=${catalogStats.claudeConnector} copilot-extension=${catalogStats.copilotExtension}`
  );
  lines.push(
    `- stale-registries=${runtimeStats.staleRegistries} whitelist=${runtimeStats.whitelist} quarantined=${runtimeStats.quarantined}`
  );
  lines.push('');
  lines.push(colorIfTty('Quick actions', colors.bold));
  lines.push('- plugscout doctor');
  lines.push('- plugscout status --verbose');
  lines.push('- plugscout recommend --project . --only-safe --limit 10');
  lines.push('- plugscout sync --dry-run');
  lines.push('- plugscout help');
  lines.push('');
  lines.push(colorIfTty('Examples', colors.bold));
  lines.push('- plugscout list --kind connectors --limit 10');
  lines.push('- plugscout search github');
  lines.push('- plugscout show --id claude-connector:asana');
  lines.push('');
  lines.push(colorIfTty('Kind aliases', colors.bold));
  lines.push('- skills, mcps, plugins, connectors, extensions');
  lines.push('');
  lines.push(colorIfTty('Ranking meaning', colors.bold));
  lines.push('- `top` and `recommend` are repo-aware suggestions, not global popularity charts.');
  lines.push('- score = fit + trust + freshness - security - blocked');
  lines.push('- higher score means a better match for this repo under current policy');
  lines.push('- review each suggestion before installing; do not install blindly from rank alone');

  return lines.join('\n');
}

async function readLogo(): Promise<string> {
  try {
    return await fs.readFile(getPackagePath('assets/cli/logo.txt'), 'utf8');
  } catch {
    return 'PlugScout';
  }
}

async function readPackageMeta(): Promise<PackageMeta> {
  try {
    const raw = await fs.readFile(getPackagePath('package.json'), 'utf8');
    return JSON.parse(raw) as PackageMeta;
  } catch {
    return { name: 'plugscout', version: '0.0.0' };
  }
}

async function readCatalogStats(): Promise<{
  items: number;
  skill: number;
  mcp: number;
  claudePlugin: number;
  claudeConnector: number;
  copilotExtension: number;
}> {
  const items = await loadCatalogItems();
  let skill = 0;
  let mcp = 0;
  let claudePlugin = 0;
  let claudeConnector = 0;
  let copilotExtension = 0;

  items.forEach((item) => {
    if (item.kind === 'skill') {
      skill += 1;
      return;
    }

    if (item.kind === 'mcp') {
      mcp += 1;
      return;
    }

    if (item.kind === 'claude-plugin') {
      claudePlugin += 1;
      return;
    }

    if (item.kind === 'claude-connector') {
      claudeConnector += 1;
      return;
    }

    copilotExtension += 1;
  });

  return {
    items: items.length,
    skill,
    mcp,
    claudePlugin,
    claudeConnector,
    copilotExtension
  };
}

async function readRuntimeStats(): Promise<{
  staleRegistries: number;
  whitelist: number;
  quarantined: number;
}> {
  const [syncState, whitelist, quarantine] = await Promise.all([loadSyncState(), loadWhitelist(), loadQuarantine()]);
  return {
    staleRegistries: getStaleRegistries(syncState).length,
    whitelist: whitelist.size,
    quarantined: quarantine.length
  };
}

function colorIfTty(value: string, apply: (raw: string) => string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR === '1') {
    return value;
  }
  return apply(value);
}
