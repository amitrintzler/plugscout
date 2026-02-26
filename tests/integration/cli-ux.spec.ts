import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/interfaces/cli/index.js';

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as Response;
}

function captureConsoleLogs(): { spy: ReturnType<typeof vi.spyOn>; joined: () => string } {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return {
    spy,
    joined: () => spy.mock.calls.map((call) => call.map((part) => String(part)).join(' ')).join('\n')
  };
}

describe('cli ux behaviors', () => {
  let toolkitHome: string;
  let testProject: string;
  let previousCwd: string;
  let previousToolkitHome: string | undefined;
  let previousTTY: unknown;

  beforeEach(async () => {
    toolkitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkit-cli-ux-'));
    testProject = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkit-cli-project-'));
    previousCwd = process.cwd();
    previousToolkitHome = process.env.TOOLKIT_HOME;
    previousTTY = (process.stdout as { isTTY?: unknown }).isTTY;
    process.env.TOOLKIT_HOME = toolkitHome;

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false
    });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: previousTTY
    });

    if (previousToolkitHome === undefined) {
      delete process.env.TOOLKIT_HOME;
    } else {
      process.env.TOOLKIT_HOME = previousToolkitHome;
    }

    await fs.rm(toolkitHome, { recursive: true, force: true });
    await fs.rm(testProject, { recursive: true, force: true });
    process.chdir(previousCwd);
  });

  it('renders branded home screen on no-arg invocation', async () => {
    const output = captureConsoleLogs();

    await runCli([]);

    const logs = output.joined();
    expect(logs).toContain('Quick actions');
    expect(logs).toContain('Toolkit v');
    expect(logs).toContain('toolkit doctor');
  });

  it('prints plain help without logger prefixes', async () => {
    const output = captureConsoleLogs();

    await runCli(['help']);

    const logs = output.joined();
    expect(logs).toContain('Commands:');
    expect(logs).not.toContain('[INFO]');
  });

  it('shows explicit empty sync-state line in verbose status', async () => {
    const output = captureConsoleLogs();

    await runCli(['status', '--verbose']);

    const logs = output.joined();
    expect(logs).toContain('Registry Sync State');
    expect(logs).toContain('- none yet');
  });

  it('init defaults include plugin kinds', async () => {
    const output = captureConsoleLogs();
    await runCli(['init', '--project', testProject]);

    const configRaw = await fs.readFile(path.join(testProject, '.skills-mcps.json'), 'utf8');
    const config = JSON.parse(configRaw) as { defaultKinds?: string[] };
    expect(config.defaultKinds).toEqual(['skill', 'mcp', 'claude-plugin', 'copilot-extension']);
    expect(output.joined()).toContain('Risk scale (lower is safer):');
  });

  it('strict risk posture defaults recommendations to safe-only output', async () => {
    const output = captureConsoleLogs();
    process.chdir(testProject);

    await fs.writeFile(
      path.join(testProject, '.skills-mcps.json'),
      JSON.stringify(
        {
          defaultKinds: ['skill', 'mcp', 'claude-plugin', 'copilot-extension'],
          defaultProviders: [],
          riskPosture: 'strict',
          outputStyle: 'rich-table',
          initializedAt: new Date().toISOString()
        },
        null,
        2
      ),
      'utf8'
    );

    await fs.mkdir(path.join(toolkitHome, 'data/quarantine'), { recursive: true });
    await fs.writeFile(
      path.join(toolkitHome, 'data/quarantine/quarantined.json'),
      JSON.stringify(
        {
          quarantined: [
            {
              id: 'claude-plugin:repo-threat-review',
              reason: 'strict-mode test',
              quarantinedAt: new Date().toISOString()
            }
          ]
        },
        null,
        2
      ),
      'utf8'
    );

    await runCli(['recommend', '--project', testProject, '--kind', 'claude-plugin', '--format', 'json', '--limit', '10']);
    const logs = output.joined();
    expect(logs).toContain('Strict risk posture is active');
    expect(logs).not.toContain('claude-plugin:repo-threat-review');
  });

  it('uses packaged install hint in show output', async () => {
    const output = captureConsoleLogs();

    await runCli(['show', '--id', 'claude-plugin:repo-threat-review']);

    const logs = output.joined();
    expect(logs).toContain('Hint: Install with: toolkit install --id claude-plugin:repo-threat-review --yes');
    expect(logs).toContain('Provenance: source=');
  });

  it('renders source and confidence columns in list output', async () => {
    const output = captureConsoleLogs();

    await runCli(['list', '--kind', 'claude-plugin', '--limit', '5']);

    const logs = output.joined();
    expect(logs).toContain('SOURCE');
    expect(logs).toContain('CONFIDENCE');
  });

  it('supports readable wrapped table output', async () => {
    const output = captureConsoleLogs();

    await runCli(['list', '--kind', 'claude-plugin', '--limit', '3', '--readable']);

    const logs = output.joined();
    expect(logs).toContain('claude-plugin:');
    expect(logs).not.toContain('anthropic-claude-connec…');
  });

  it('renders per-item decision details in list view', async () => {
    const output = captureConsoleLogs();

    await runCli(['list', '--kind', 'claude-plugin', '--limit', '2', '--details']);

    const logs = output.joined();
    expect(logs).toContain('Decision details');
    expect(logs).toContain('Why use:');
    expect(logs).toContain('Install: toolkit install --id');
  });

  it('renders recommendation score explanation in top details view', async () => {
    const output = captureConsoleLogs();

    await runCli(['top', '--project', testProject, '--kind', 'claude-plugin', '--limit', '2', '--details']);

    const logs = output.joined();
    expect(logs).toContain('Recommendation details');
    expect(logs).toContain('Score:');
    expect(logs).toContain('Why ranked:');
  });

  it('writes web report html', async () => {
    const output = captureConsoleLogs();
    const reportPath = path.join(testProject, 'toolkit-report.html');

    await runCli(['web', '--out', reportPath, '--kind', 'claude-plugin', '--limit', '20']);

    const html = await fs.readFile(reportPath, 'utf8');
    expect(output.joined()).toContain('Web report written:');
    expect(html).toContain('Toolkit Web Report');
    expect(html).toContain('Top Claude Plugins');
    expect(html).toContain('How to read scores');
    expect(html).toContain('Decision details per item');
  });

  it('handles upgrade check states using mocked release responses', async () => {
    const output = captureConsoleLogs();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v9.9.9' })));
    await runCli(['upgrade', 'check']);
    expect(output.joined()).toContain('New Toolkit version available: v0.3.0 -> v9.9.9');

    output.spy.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v0.3.0' })));
    await runCli(['upgrade', 'check']);
    expect(output.joined()).toContain('Toolkit is up to date (v0.3.0).');

    output.spy.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, {})));
    await runCli(['upgrade', 'check']);
    expect(output.joined()).toContain('No published release found yet.');
  });
});
