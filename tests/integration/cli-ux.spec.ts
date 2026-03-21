import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/interfaces/cli/index.js';
import { getReviewStatePath } from '../../src/install/review-state.js';

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
    toolkitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'plugscout-cli-ux-'));
    testProject = await fs.mkdtemp(path.join(os.tmpdir(), 'plugscout-cli-project-'));
    previousCwd = process.cwd();
    previousToolkitHome = process.env.PLUGSCOUT_HOME;
    previousTTY = (process.stdout as { isTTY?: unknown }).isTTY;
    process.env.PLUGSCOUT_HOME = toolkitHome;

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
      delete process.env.PLUGSCOUT_HOME;
    } else {
      process.env.PLUGSCOUT_HOME = previousToolkitHome;
    }

    await fs.rm(getReviewStatePath(), { force: true });
    await fs.rm(toolkitHome, { recursive: true, force: true });
    await fs.rm(testProject, { recursive: true, force: true });
    process.chdir(previousCwd);
  });

  it('renders branded home screen on no-arg invocation', async () => {
    const output = captureConsoleLogs();

    await runCli([]);

    const logs = output.joined();
    expect(logs).toContain('Quick actions');
    expect(logs).toContain('Examples');
    expect(logs).toContain('maintained by');
    expect(logs).toContain('plugscout doctor');
    expect(logs).toContain('Ranking meaning');
    expect(logs).toContain('repo-aware suggestions');
    expect(logs).toContain('do not install blindly from rank alone');
  });

  it('prints plain help without logger prefixes', async () => {
    const output = captureConsoleLogs();

    await runCli(['help']);

    const logs = output.joined();
    expect(logs).toContain('PlugScout commands');
    expect(logs).toContain('Kind aliases');
    expect(logs).toContain('repo-aware rankings');
    expect(logs).toContain('do not install blindly from rank alone');
    expect(logs).toContain('plugscout list --kind connectors --limit 10');
    expect(logs).not.toContain('[INFO]');
  });

  it('bootstraps supported install dependencies from doctor', async () => {
    const output = captureConsoleLogs();
    const previousDryRun = process.env.SKILLS_MCPS_DEP_INSTALL_DRY_RUN;
    process.env.SKILLS_MCPS_DEP_INSTALL_DRY_RUN = '1';

    try {
      await runCli(['doctor', '--install-deps']);
      const logs = output.joined();
      expect(logs).toContain('Dependency bootstrap');
    } finally {
      if (previousDryRun === undefined) {
        delete process.env.SKILLS_MCPS_DEP_INSTALL_DRY_RUN;
      } else {
        process.env.SKILLS_MCPS_DEP_INSTALL_DRY_RUN = previousDryRun;
      }
    }
  });

  it('explains ranking intent in about output', async () => {
    const output = captureConsoleLogs();

    await runCli(['about']);

    const logs = output.joined();
    expect(logs).toContain('Meaning: top/recommend output is repo-aware guidance');
    expect(logs).toContain('do not install blindly from rank alone');
  });

  it('suggests a nearby command for unknown input', async () => {
    const output = captureConsoleLogs();

    await runCli(['statuz']);

    const logs = output.joined();
    expect(logs).toContain('Unknown command: statuz');
    expect(logs).toContain('Did you mean: status');
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
    expect(config.defaultKinds).toEqual(['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension']);
    expect(output.joined()).toContain('Risk scale (lower is safer):');
  });

  it('strict risk posture defaults recommendations to safe-only output', async () => {
    const output = captureConsoleLogs();
    process.chdir(testProject);

    await fs.writeFile(
      path.join(testProject, '.skills-mcps.json'),
      JSON.stringify(
        {
          defaultKinds: ['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension'],
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
    await fs.mkdir(path.join(toolkitHome, 'data/catalog'), { recursive: true });
    await fs.writeFile(
      path.join(toolkitHome, 'data/catalog/items.json'),
      JSON.stringify(
        [
          {
            id: 'claude-plugin:repo-threat-review',
            kind: 'claude-plugin',
            name: 'Repo Threat Review',
            description: 'Threat-centric review assistant for pull requests and workflows.',
            provider: 'anthropic',
            capabilities: ['security', 'guardrails', 'code-scanning'],
            compatibility: ['claude', 'github', 'node'],
            source: 'official-claude-plugins',
            lastSeenAt: '2026-03-10',
            install: { kind: 'manual', instructions: 'Enable from Claude plugin catalog.' },
            adoptionSignal: 72,
            maintenanceSignal: 81,
            provenanceSignal: 97,
            freshnessSignal: 79,
            securitySignals: {
              knownVulnerabilities: 0,
              suspiciousPatterns: 0,
              injectionFindings: 0,
              exfiltrationSignals: 0,
              integrityAlerts: 0
            },
            metadata: {
              sourcePage: 'https://claude.com/plugins/repo-threat-review',
              sourceConfidence: 'official'
            }
          }
        ],
        null,
        2
      ),
      'utf8'
    );

    await runCli(['show', '--id', 'claude-plugin:repo-threat-review']);

    const logs = output.joined();
    expect(logs).toContain('Hint: Install with: plugscout install --id claude-plugin:repo-threat-review --yes');
    expect(logs).toContain('Hint: Review provenance, risk, and capabilities first.');
    expect(logs).toContain('Provenance: source=');
  });

  it('renders source and confidence columns in list output', async () => {
    const output = captureConsoleLogs();

    await runCli(['list', '--kind', 'plugins', '--limit', '5']);

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
    expect(logs).toContain('Install: plugscout install --id');
  });

  it('renders recommendation score explanation in top details view', async () => {
    const output = captureConsoleLogs();

    await runCli(['top', '--project', testProject, '--kind', 'claude-plugin', '--limit', '2', '--details']);

    const logs = output.joined();
    expect(logs).toContain('Hint: Ranking meaning: these are the best safe matches for this repo');
    expect(logs).toContain('Hint: Score formula: fit + trust + freshness - security - blocked.');
    expect(logs).toContain('Hint: Review each suggestion before installing.');
    expect(logs).toContain('Recommendation details');
    expect(logs).toContain('Score:');
    expect(logs).toContain('Why ranked:');
  });

  it('requires review before install and allows install after show', async () => {
    const previousDryRun = process.env.SKILLS_MCPS_INSTALL_DRY_RUN;
    const firstOutput = captureConsoleLogs();
    process.env.SKILLS_MCPS_INSTALL_DRY_RUN = '1';

    try {
      await expect(runCli(['install', '--id', 'claude-plugin:asana', '--yes'])).rejects.toThrow(
        'Review required before install'
      );

      firstOutput.spy.mockRestore();

      const secondOutput = captureConsoleLogs();
      await runCli(['show', '--id', 'claude-plugin:asana']);
      await runCli(['install', '--id', 'claude-plugin:asana', '--yes']);

      const logs = secondOutput.joined();
      expect(logs).toContain('Hint: Review provenance, risk, and capabilities first.');
      expect(logs).toContain('"policyDecision": "allowed"');
    } finally {
      if (previousDryRun === undefined) {
        delete process.env.SKILLS_MCPS_INSTALL_DRY_RUN;
      } else {
        process.env.SKILLS_MCPS_INSTALL_DRY_RUN = previousDryRun;
      }
    }
  });

  it('writes web report html', async () => {
    const output = captureConsoleLogs();
    const reportPath = path.join(testProject, 'plugscout-report.html');

    await runCli(['web', '--out', reportPath, '--kind', 'claude-plugin', '--limit', '20']);

    const html = await fs.readFile(reportPath, 'utf8');
    expect(output.joined()).toContain('Web report written:');
    expect(html).toContain('PlugScout Web Report');
    expect(html).toContain('Top Claude Plugins');
    expect(html).toContain('Top Claude Connectors');
    expect(html).toContain('How to read scores');
    expect(html).toContain('Decision details per item');
  });

  it('handles upgrade check states using mocked release responses', async () => {
    const output = captureConsoleLogs();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v9.9.9' })));
    await runCli(['upgrade', 'check']);
    expect(output.joined()).toContain('New PlugScout version available: v0.3.3 -> v9.9.9');

    output.spy.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v0.3.3' })));
    await runCli(['upgrade', 'check']);
    expect(output.joined()).toContain('PlugScout is up to date (v0.3.3).');

    output.spy.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, {})));
    await runCli(['upgrade', 'check']);
    expect(output.joined()).toContain('No published release found yet.');
  });
});
