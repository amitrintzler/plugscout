import { describe, expect, it } from 'vitest';

import type { CatalogItem } from '../../src/lib/validation/contracts.js';
import { buildSkillShInstallArgs, resolvePreferredInstallPlan } from '../../src/install/skillsh.js';

describe('buildSkillShInstallArgs', () => {
  it('builds arguments with yes flag when requested', () => {
    expect(buildSkillShInstallArgs('mcp-filesystem', ['--transport', 'stdio'], true)).toEqual([
      'install',
      'mcp-filesystem',
      '--transport',
      'stdio',
      '--yes'
    ]);
  });

  it('builds arguments without yes flag by default', () => {
    expect(buildSkillShInstallArgs('secure-prompting', [], false)).toEqual(['install', 'secure-prompting']);
  });

  it('prefers modern skills cli for official skill installs', () => {
    const item = {
      id: 'skill:playwright',
      kind: 'skill',
      name: 'Playwright',
      description: 'desc',
      provider: 'openai',
      capabilities: ['browser-control'],
      compatibility: ['node'],
      source: 'openai-skills-curated',
      lastSeenAt: '2026-03-10',
      install: { kind: 'skill.sh', target: 'Playwright', args: [] },
      adoptionSignal: 72,
      maintenanceSignal: 82,
      provenanceSignal: 96,
      freshnessSignal: 80,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 0,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      },
      metadata: {
        sourceRegistryId: 'openai-skills-curated',
        githubUrl: 'https://github.com/openai/skills/tree/main/skills/.curated/playwright'
      }
    } satisfies CatalogItem;

    const plan = resolvePreferredInstallPlan(item, true);
    expect(plan).toBeTruthy();
    expect(plan?.installer).toBe('skills');
    expect(plan?.args).toContain('add');
    expect(plan?.args).toContain('https://github.com/openai/skills');
    expect(plan?.args).toContain('playwright');
  });

  it('uses npm for node-backed MCP package installs', () => {
    const item = {
      id: 'mcp:io.github.example/server',
      kind: 'mcp',
      name: 'Example',
      description: 'desc',
      provider: 'mcp',
      capabilities: ['automation'],
      compatibility: ['node'],
      source: 'mcp-registry',
      lastSeenAt: '2026-03-10',
      transport: 'stdio',
      authModel: 'none',
      install: { kind: 'skill.sh', target: '@example/mcp-server', args: [] },
      adoptionSignal: 50,
      maintenanceSignal: 65,
      provenanceSignal: 90,
      freshnessSignal: 60,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 0,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      },
      metadata: {
        packageRegistryType: 'npm'
      }
    } satisfies CatalogItem;

    const plan = resolvePreferredInstallPlan(item, true);
    expect(plan).toEqual({
      binary: 'npm',
      args: ['install', '-g', '@example/mcp-server'],
      label: 'npm',
      installer: 'npm'
    });
  });

  it('uses docker pull for container-backed MCP installs', () => {
    const item = {
      id: 'mcp:io.github.example/docker-server',
      kind: 'mcp',
      name: 'Docker Example',
      description: 'desc',
      provider: 'mcp',
      capabilities: ['automation'],
      compatibility: ['container'],
      source: 'mcp-registry',
      lastSeenAt: '2026-03-10',
      transport: 'stdio',
      authModel: 'none',
      install: { kind: 'skill.sh', target: 'ghcr.io/example/mcp-server:1.2.3', args: [] },
      adoptionSignal: 50,
      maintenanceSignal: 65,
      provenanceSignal: 90,
      freshnessSignal: 60,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 0,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      },
      metadata: {}
    } satisfies CatalogItem;

    const plan = resolvePreferredInstallPlan(item, false);
    expect(plan).toEqual({
      binary: 'docker',
      args: ['pull', 'ghcr.io/example/mcp-server:1.2.3'],
      label: 'docker',
      installer: 'docker'
    });
  });
});
