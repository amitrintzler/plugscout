import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import { loadCatalogItems, loadQuarantine, loadWhitelist } from '../../../catalog/repository.js';
import { getStaleRegistries, loadSyncState } from '../../../catalog/sync-state.js';
import { getPackagePath } from '../../../lib/paths.js';
import { colors } from '../formatters/colors.js';
import { isSetUp, loadCatalogItems as loadCatalogItemsFromApi } from '../../../api/index.js';

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
  const version = pkg.version ?? '0.0.0';
  const author = pkg.author ?? '';
  const renderedLogo = logo
    .replace('{{version}}', `v${version}`)
    .replace('{{author}}', author || 'unknown');
  lines.push(colorIfTty(renderedLogo.trimEnd(), colors.cyan));
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

export interface MenuItem {
  label: string;
  description: string;
  command?: string[];   // argv to spawn; undefined = Exit
  needsId?: boolean;    // if true, prompt for --id before spawning
}

export async function getMenuItems(): Promise<MenuItem[]> {
  const setup = await isSetUp();
  if (!setup) {
    return [
      {
        label: 'Run setup now',
        description: 'Installs prerequisites, writes config, syncs all catalogs\n        → plugscout setup  (takes ~30 seconds)',
        command: ['setup'],
      },
      { label: 'Exit', description: '' },
    ];
  }

  const items = await loadCatalogItemsFromApi();
  const base: MenuItem[] = [
    {
      label: 'Scan my project',
      description: 'Detect your stack and list matching plugins, MCPs, and extensions\n        → plugscout scan --project . --format table',
      command: ['scan', '--project', '.', '--format', 'table'],
    },
    {
      label: 'Get recommendations',
      description: 'Top safe picks ranked by fit + trust for your current directory\n        → plugscout recommend --project . --only-safe --limit 10',
      command: ['recommend', '--project', '.', '--only-safe', '--limit', '10'],
    },
  ];

  if (items.length > 0) {
    base.push(
      {
        label: 'Inspect an item',
        description: 'Show full risk profile, trust score, and install instructions\n        → plugscout show --id <id>  (prompts for ID)',
        command: ['show'],
        needsId: true,
      },
      {
        label: 'Assess before installing',
        description: 'Evaluate one candidate in detail — risk, policy, provenance\n        → plugscout assess --id <id>  (prompts for ID)',
        command: ['assess'],
        needsId: true,
      },
      {
        label: 'Install an item',
        description: 'Policy-gated install; blocks high/critical risk by default\n        → plugscout install --id <id> --yes  (prompts for ID)',
        command: ['install', '--yes'],
        needsId: true,
      },
      {
        label: 'Sync catalogs',
        description: 'Pull latest entries from all configured registries\n        → plugscout sync',
        command: ['sync'],
      }
    );
  }

  base.push(
    {
      label: 'Open web report',
      description: 'Readable HTML with score legend and decision cards — opens in browser\n        → plugscout web --open',
      command: ['web', '--open'],
    },
    {
      label: 'Check system health',
      description: 'Verify prerequisites, catalog freshness, and config validity\n        → plugscout doctor',
      command: ['doctor'],
    },
    { label: 'Exit', description: '' }
  );

  return base;
}

export async function renderInteractiveHome(): Promise<void> {
  let menuItems: MenuItem[];
  try {
    menuItems = await getMenuItems();
  } catch {
    const screen = await renderHomeScreen();
    process.stdout.write(screen + '\n');
    return;
  }

  let selected = 0;
  const ARROW_UP = '\u001b[A';
  const ARROW_DOWN = '\u001b[B';
  const ENTER = '\r';
  const CTRL_C = '\u0003';

  function render(firstRender: boolean): void {
    if (!firstRender) {
      process.stdout.write(`\x1b[${menuItems.length * 2}A\r`);
    }
    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      const prefix = i === selected ? '  \u276f ' : '    ';
      process.stdout.write(`\x1b[2K${prefix}${item.label}\n`);
      if (item.description) {
        process.stdout.write(`\x1b[2K        \x1b[2m${item.description}\x1b[0m\n`);
      } else {
        process.stdout.write(`\x1b[2K\n`);
      }
    }
  }

  process.stdout.write('\n');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  render(true);

  await new Promise<void>((resolve) => {
    process.stdin.on('data', async function onKey(key: string) {
      if (key === CTRL_C) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        process.exit(0);
      } else if (key === ARROW_UP) {
        selected = (selected - 1 + menuItems.length) % menuItems.length;
        render(false);
      } else if (key === ARROW_DOWN) {
        selected = (selected + 1) % menuItems.length;
        render(false);
      } else if (key === ENTER) {
        process.stdin.removeListener('data', onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');

        const item = menuItems[selected];
        if (!item.command) {
          resolve();
          return;
        }

        let args = [...item.command];
        if (item.needsId) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          process.stdin.resume();
          const id = await new Promise<string>((res) => {
            rl.question('  Enter catalog ID: ', (answer) => {
              rl.close();
              res(answer.trim());
            });
          });
          if (!id) {
            resolve();
            return;
          }
          args = [...args, '--id', id];
        }

        const cliPath = getPackagePath('dist/cli.js');
        const child = spawn(process.execPath, [cliPath, ...args], { stdio: 'inherit' });
        child.on('close', () => resolve());
      }
    });
  });
}
