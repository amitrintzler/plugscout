#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'silent', ...(options.env ?? {}) },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }

  return result;
}

function parsePackJson(raw) {
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length === 0 || typeof value[0]?.filename !== 'string') {
    throw new Error('Unexpected npm pack --json output');
  }
  return value[0].filename;
}

async function main() {
  const dryRun = run('npm', ['pack', '--dry-run', '--json'], { capture: true });
  const dryRunFile = parsePackJson(dryRun.stdout);
  console.log(`pack dry-run ok: ${dryRunFile}`);

  const pack = run('npm', ['pack', '--json'], { capture: true });
  const tarballName = parsePackJson(pack.stdout);
  const tarballPath = path.join(REPO_ROOT, tarballName);

  const tempProject = await mkdtemp(path.join(tmpdir(), 'plugscout-smoke-'));
  const toolkitHome = path.join(tempProject, '.plugscout-home');

  try {
    run('npm', ['init', '-y'], { env: {}, capture: false, cwd: tempProject });
    run('npm', ['install', tarballPath], { env: {}, capture: false, cwd: tempProject });

    const execOptions = { cwd: tempProject, env: { PLUGSCOUT_HOME: toolkitHome } };
    run('npm', ['exec', '--', 'plugscout'], execOptions);
    run('npm', ['exec', '--', 'plugscout', 'help'], execOptions);
    run('npm', ['exec', '--', 'plugscout', 'about'], execOptions);
    run('npm', ['exec', '--', 'plugscout', 'upgrade', 'check', '--no-update-check'], execOptions);
    run('npm', ['exec', '--', 'plugscout', 'status'], execOptions);
    run('npm', ['exec', '--', 'plugscout', 'recommend', '--kind', 'claude-plugin', '--limit', '5', '--format', 'json'], execOptions);
    run('npm', ['exec', '--', 'plugscout', 'recommend', '--kind', 'copilot-extension', '--limit', '5', '--format', 'json'], execOptions);

    console.log('smoke pack checks passed');
  } finally {
    await rm(tempProject, { recursive: true, force: true });
    await rm(tarballPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
