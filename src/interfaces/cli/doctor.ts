import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { getStaleRegistries, loadSyncState } from '../../catalog/sync-state.js';
import { loadCatalogItems } from '../../catalog/repository.js';
import { hasLegacySkillSh, resolveSkillsRuntime } from '../../install/dependencies.js';
import { getClientMcpConfigStatus, CLIENT_DEFS } from './client-setup.js';
import type { DoctorCheckResult } from './types.js';

export async function runDoctorChecks(projectPath = '.'): Promise<DoctorCheckResult[]> {
  const checks: DoctorCheckResult[] = [];

  checks.push(checkSkillsRuntime());
  checks.push(
    hasLegacySkillSh()
      ? { name: 'Legacy skill.sh', status: 'pass', message: 'skill.sh available' }
      : {
          name: 'Legacy skill.sh',
          status: 'warn',
          message: 'skill.sh not found',
          suggestion:
            'Optional: some legacy MCP installs still expect skill.sh. Official skills can install through the modern skills CLI.'
        }
  );
  checks.push(checkBinary('gh'));

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(
    nodeMajor >= 18
      ? { name: 'Node version', status: 'pass', message: `Node ${process.versions.node}` }
      : {
          name: 'Node version',
          status: 'fail',
          message: `Node ${process.versions.node}`,
          suggestion: 'Upgrade to Node >=18.17'
        }
  );

  try {
    const items = await loadCatalogItems();
    checks.push(
      items.length > 0
        ? { name: 'Catalog', status: 'pass', message: `${items.length} items loaded` }
        : { name: 'Catalog', status: 'warn', message: 'Catalog is empty', suggestion: 'Run: npm run sync' }
    );
  } catch {
    checks.push({ name: 'Catalog', status: 'fail', message: 'Catalog unreadable', suggestion: 'Run: npm run sync' });
  }

  const syncState = await loadSyncState();
  const stale = getStaleRegistries(syncState);
  checks.push(
    stale.length === 0
      ? { name: 'Sync freshness', status: 'pass', message: 'No stale registries' }
      : {
          name: 'Sync freshness',
          status: 'warn',
          message: `${stale.length} stale registries`,
          suggestion: 'Run: npm run sync'
        }
  );

  const configPath = path.resolve(projectPath, '.skills-mcps.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    JSON.parse(raw);
    checks.push({ name: 'Local config', status: 'pass', message: '.skills-mcps.json is valid' });
  } catch {
    checks.push({
      name: 'Local config',
      status: 'warn',
      message: '.skills-mcps.json missing or invalid',
      suggestion: 'Run: npm run dev -- init'
    });
  }

  // Cursor IDE check
  const cursorInstalled =
    spawnSync('which', ['cursor'], { encoding: 'utf8' }).status === 0 ||
    await fs.access(path.join(os.homedir(), '.cursor')).then(() => true).catch(() => false);
  checks.push(
    cursorInstalled
      ? { name: 'Cursor IDE', status: 'pass', message: 'Cursor detected' }
      : { name: 'Cursor IDE', status: 'warn', message: 'Cursor not detected', suggestion: 'Install Cursor from https://cursor.sh' }
  );

  // Gemini CLI check
  checks.push(checkBinary('gemini', { suggestion: 'Install Gemini CLI: npm install -g @google/gemini-cli' }));

  // Cursor MCP config check
  try {
    const cursorStatus = await getClientMcpConfigStatus('cursor', 'user');
    checks.push(
      cursorStatus.configured
        ? { name: 'Cursor MCP config', status: 'pass', message: `plugscout wired in ${cursorStatus.configPath}` }
        : { name: 'Cursor MCP config', status: 'warn', message: 'plugscout not in Cursor MCP config', suggestion: 'Run: plugscout client setup --client cursor' }
    );
  } catch {
    checks.push({ name: 'Cursor MCP config', status: 'warn', message: 'Could not read Cursor MCP config', suggestion: 'Run: plugscout client setup --client cursor' });
  }

  // Gemini MCP config check
  try {
    const geminiStatus = await getClientMcpConfigStatus('gemini', 'user');
    checks.push(
      geminiStatus.configured
        ? { name: 'Gemini MCP config', status: 'pass', message: `plugscout wired in ${geminiStatus.configPath}` }
        : { name: 'Gemini MCP config', status: 'warn', message: 'plugscout not in Gemini MCP config', suggestion: 'Run: plugscout client setup --client gemini' }
    );
  } catch {
    checks.push({ name: 'Gemini MCP config', status: 'warn', message: 'Could not read Gemini MCP config', suggestion: 'Run: plugscout client setup --client gemini' });
  }

  // Claude Desktop check
  const claudeDesktopConfigPath = CLIENT_DEFS['claude-desktop'].getConfigPath('user');
  const claudeDesktopPresent =
    spawnSync('which', ['claude'], { encoding: 'utf8' }).status === 0 ||
    await fs.access(path.dirname(claudeDesktopConfigPath)).then(() => true).catch(() => false) ||
    await fs.access(path.join('/', 'Applications', 'Claude.app')).then(() => true).catch(() => false);
  checks.push(
    claudeDesktopPresent
      ? { name: 'Claude Desktop', status: 'pass', message: 'Claude Desktop detected' }
      : { name: 'Claude Desktop', status: 'warn', message: 'Claude Desktop not detected', suggestion: 'Install from https://claude.ai/download' }
  );

  // Claude Desktop MCP config check
  try {
    const claudeStatus = await getClientMcpConfigStatus('claude-desktop', 'user');
    checks.push(
      claudeStatus.configured
        ? { name: 'Claude Desktop MCP', status: 'pass', message: `plugscout wired in ${claudeStatus.configPath}` }
        : { name: 'Claude Desktop MCP', status: 'warn', message: 'plugscout not in Claude Desktop config', suggestion: 'Run: plugscout client setup --client claude-desktop' }
    );
  } catch {
    checks.push({ name: 'Claude Desktop MCP', status: 'warn', message: 'Could not read Claude Desktop config', suggestion: 'Run: plugscout client setup --client claude-desktop' });
  }

  // Windsurf check
  checks.push(checkBinary('windsurf', { suggestion: 'Install Windsurf from https://windsurf.ai' }));

  // Windsurf MCP config check
  try {
    const windsurfStatus = await getClientMcpConfigStatus('windsurf', 'user');
    checks.push(
      windsurfStatus.configured
        ? { name: 'Windsurf MCP config', status: 'pass', message: `plugscout wired in ${windsurfStatus.configPath}` }
        : { name: 'Windsurf MCP config', status: 'warn', message: 'plugscout not in Windsurf MCP config', suggestion: 'Run: plugscout client setup --client windsurf' }
    );
  } catch {
    checks.push({ name: 'Windsurf MCP config', status: 'warn', message: 'Could not read Windsurf MCP config', suggestion: 'Run: plugscout client setup --client windsurf' });
  }

  // OpenCode check
  checks.push(checkBinary('opencode', { suggestion: 'Install OpenCode: npm install -g opencode-ai' }));

  // OpenCode MCP config check
  try {
    const opencodeStatus = await getClientMcpConfigStatus('opencode', 'user');
    checks.push(
      opencodeStatus.configured
        ? { name: 'OpenCode MCP config', status: 'pass', message: `plugscout wired in ${opencodeStatus.configPath}` }
        : { name: 'OpenCode MCP config', status: 'warn', message: 'plugscout not in OpenCode config', suggestion: 'Run: plugscout client setup --client opencode' }
    );
  } catch {
    checks.push({ name: 'OpenCode MCP config', status: 'warn', message: 'Could not read OpenCode config', suggestion: 'Run: plugscout client setup --client opencode' });
  }

  // Zed check
  const zedInstalled =
    spawnSync('which', ['zed'], { encoding: 'utf8' }).status === 0 ||
    await fs.access(path.join('/', 'Applications', 'Zed.app')).then(() => true).catch(() => false);
  checks.push(
    zedInstalled
      ? { name: 'Zed', status: 'pass', message: 'Zed detected' }
      : { name: 'Zed', status: 'warn', message: 'Zed not detected', suggestion: 'Install Zed from https://zed.dev' }
  );

  // Zed MCP config check
  try {
    const zedStatus = await getClientMcpConfigStatus('zed', 'user');
    checks.push(
      zedStatus.configured
        ? { name: 'Zed MCP config', status: 'pass', message: `plugscout wired in ${zedStatus.configPath}` }
        : { name: 'Zed MCP config', status: 'warn', message: 'plugscout not in Zed settings', suggestion: 'Run: plugscout client setup --client zed' }
    );
  } catch {
    checks.push({ name: 'Zed MCP config', status: 'warn', message: 'Could not read Zed settings', suggestion: 'Run: plugscout client setup --client zed' });
  }

  return checks;
}

function checkSkillsRuntime(): DoctorCheckResult {
  const runtime = resolveSkillsRuntime();
  if (runtime) {
    return {
      name: 'Skills CLI',
      status: 'pass',
      message: `${runtime.label} available`
    };
  }

  return {
    name: 'Skills CLI',
    status: 'fail',
    message: 'skills CLI not found',
    suggestion: 'Run: plugscout doctor --install-deps'
  };
}

function checkBinary(
  name: string,
  options: {
    required?: boolean;
    suggestion?: string;
  } = {}
): DoctorCheckResult {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  if (result.status === 0) {
    return { name, status: 'pass', message: `${name} available` };
  }

  return {
    name,
    status: options.required ? 'fail' : 'warn',
    message: `${name} not found`,
    suggestion: options.suggestion ?? `Install ${name}`
  };
}
