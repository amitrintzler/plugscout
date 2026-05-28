import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { getStaleRegistries, loadSyncState } from '../../catalog/sync-state.js';
import { loadCatalogItems } from '../../catalog/repository.js';
import { hasLegacySkillSh, resolveSkillsRuntime } from '../../install/dependencies.js';
import { getClientMcpConfigStatus } from './client-setup.js';
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
