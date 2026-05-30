import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface, moveCursor, clearScreenDown } from 'node:readline';

import { loadQuarantine, loadWhitelist } from '../../../catalog/repository.js';
import { getStaleRegistries, loadSyncState } from '../../../catalog/sync-state.js';
import { getPackagePath } from '../../../lib/paths.js';
import { colors } from '../formatters/colors.js';
import { isSetUp, loadCatalogItems } from '../../../api/index.js';

interface PackageMeta {
  name?: string;
  version?: string;
  author?: string;
}

export async function renderHomeScreen(): Promise<string> {
  const termCols = process.stdout.columns ?? 80;
  const useCompact = termCols < 82;

  const [logo, pkg, catalogStats, runtimeStats] = await Promise.all([
    readLogo(useCompact),
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
  lines.push(colorIfTty('Discover and safely install Claude plugins, connectors,', colors.dim));
  lines.push(colorIfTty('Copilot/Cursor/Gemini extensions, Skills, and MCP servers.', colors.dim));
  lines.push('');

  lines.push(colorIfTty('Catalog', colors.bold));
  lines.push(
    colorIfTty(
      `  items=${catalogStats.items}  skill=${catalogStats.skill}  mcp=${catalogStats.mcp}  claude-plugin=${catalogStats.claudePlugin}  claude-connector=${catalogStats.claudeConnector}`,
      colors.dim
    )
  );
  lines.push(
    colorIfTty(
      `  copilot-extension=${catalogStats.copilotExtension}  cursor-extension=${catalogStats.cursorExtension}  gemini-extension=${catalogStats.geminiExtension}`,
      colors.dim
    )
  );
  lines.push(
    colorIfTty(
      `  stale-registries=${runtimeStats.staleRegistries}  whitelist=${runtimeStats.whitelist}  quarantined=${runtimeStats.quarantined}`,
      colors.dim
    )
  );
  lines.push('');

  lines.push(colorIfTty('Quick actions', colors.bold));
  for (const cmd of [
    'plugscout doctor',
    'plugscout status --verbose',
    'plugscout recommend --project . --only-safe --limit 10',
    'plugscout sync --dry-run',
    'plugscout help',
  ]) {
    lines.push(`  ${colorIfTty(cmd, colors.cyan)}`);
  }
  lines.push('');

  lines.push(colorIfTty('Examples', colors.bold));
  for (const cmd of [
    'plugscout list --kind connectors --limit 10',
    'plugscout list --kind cursor --limit 15',
    'plugscout search github',
    'plugscout show --id claude-connector:asana',
  ]) {
    lines.push(`  ${colorIfTty(cmd, colors.cyan)}`);
  }
  lines.push('');

  lines.push(colorIfTty('Kind aliases', colors.bold));
  lines.push(colorIfTty('  skills · mcps · plugins · connectors · extensions · cursor · gemini', colors.dim));
  lines.push('');

  lines.push(colorIfTty('Ranking meaning', colors.bold));
  lines.push(colorIfTty('  top/recommend output is repo-aware suggestions, not a global popularity chart', colors.dim));
  lines.push(colorIfTty('  score = fit + trust + freshness - security - blocked', colors.dim));
  lines.push(colorIfTty('  review before installing — do not install blindly from rank alone', colors.dim));

  return lines.join('\n');
}

async function readLogo(compact = false): Promise<string> {
  const file = compact ? 'assets/cli/logo-compact.txt' : 'assets/cli/logo.txt';
  try {
    return await fs.readFile(getPackagePath(file), 'utf8');
  } catch {
    try {
      return await fs.readFile(getPackagePath('assets/cli/logo.txt'), 'utf8');
    } catch {
      return 'PlugScout';
    }
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
  cursorExtension: number;
  geminiExtension: number;
}> {
  const items = await loadCatalogItems();
  let skill = 0, mcp = 0, claudePlugin = 0, claudeConnector = 0;
  let copilotExtension = 0, cursorExtension = 0, geminiExtension = 0;

  items.forEach((item) => {
    if (item.kind === 'skill') { skill += 1; }
    else if (item.kind === 'mcp') { mcp += 1; }
    else if (item.kind === 'claude-plugin') { claudePlugin += 1; }
    else if (item.kind === 'claude-connector') { claudeConnector += 1; }
    else if (item.kind === 'cursor-extension') { cursorExtension += 1; }
    else if (item.kind === 'gemini-extension') { geminiExtension += 1; }
    else { copilotExtension += 1; }
  });

  return { items: items.length, skill, mcp, claudePlugin, claudeConnector, copilotExtension, cursorExtension, geminiExtension };
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

  const items = await loadCatalogItems();
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

  const screen = await renderHomeScreen();
  process.stdout.write(screen + '\n\n');

  let selected = 0;
  const ARROW_UP = '[A';
  const ARROW_DOWN = '[B';
  const ENTER = '\r';
  const CTRL_C = '';

  // Physical lines written by the last render call — used to move the cursor
  // back up accurately regardless of terminal width / line wrapping.
  let linesDrawn = 0;

  function physicalLines(text: string): number {
    const cols = process.stdout.columns || 80;
    // Strip ANSI codes before measuring display width
    // eslint-disable-next-line no-control-regex
    const plain = text.replace(/\x1b\[[^m]*m/g, '');
    if (plain.length === 0) return 1;
    return Math.max(1, Math.ceil(plain.length / cols));
  }

  function render(firstRender: boolean): void {
    if (!firstRender) {
      moveCursor(process.stdout, 0, -linesDrawn);
      clearScreenDown(process.stdout);
    }
    let drawn = 0;
    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      const prefix = i === selected ? '  ❯ ' : '    ';
      const labelLine = `${prefix}${item.label}`;
      process.stdout.write(`${labelLine}\n`);
      drawn += physicalLines(labelLine);
      if (item.description) {
        const firstLine = item.description.split('\n')[0];
        const descLine = `        ${firstLine}`;
        process.stdout.write(`\x1b[2m${descLine}\x1b[0m\n`);
        drawn += physicalLines(descLine);
      } else {
        process.stdout.write('\n');
        drawn += 1;
      }
    }
    linesDrawn = drawn;
  }

  let running = true;
  while (running) {
    process.stdout.write('\n');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    render(true);

    const action = await new Promise<{ exit: boolean; args?: string[] }>((resolve) => {
      process.stdin.on('data', async function onKey(key: string) {
        if (key === CTRL_C) {
          process.stdin.removeListener('data', onKey);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve({ exit: true });
          return;
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
            resolve({ exit: true });
            return;
          }

          let args = [...item.command];
          if (item.needsId) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            process.stdin.resume();
            const id = await new Promise<string>((res) => {
              rl.question('  Catalog ID (e.g. mcp:github, skill:code-review, cursor-extension:gitlens): ', (answer) => {
                rl.close();
                res(answer.trim());
              });
            });
            if (!id) {
              resolve({ exit: false });
              return;
            }
            args = [...args, '--id', id];
          }

          resolve({ exit: false, args });
        }
      });
    });

    if (action.exit) {
      running = false;
    } else {
      if (action.args) {
        const cliPath = getPackagePath('dist/cli.js');
        await new Promise<void>((done) => {
          const child = spawn(process.execPath, [cliPath, ...action.args!], { stdio: 'inherit' });
          child.on('close', () => done());
          child.on('error', () => done());
        });
      }
      process.stdout.write('\n');
    }
  }
}
