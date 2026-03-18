import { describe, expect, it } from 'vitest';

import { CatalogItemSchema, RegistrySchema } from '../../src/lib/validation/contracts.js';

describe('RegistrySchema', () => {
  it('accepts plugin kinds and adapter variants', () => {
    const claude = RegistrySchema.parse({
      id: 'official-claude-plugins',
      kind: 'claude-plugin',
      sourceType: 'vendor-feed',
      adapter: 'claude-plugins-scrape-v1',
      enabled: true,
      entries: []
    });

    const copilot = RegistrySchema.parse({
      id: 'official-copilot-extensions',
      kind: 'copilot-extension',
      sourceType: 'vendor-feed',
      adapter: 'copilot-extensions-v0.1',
      enabled: true,
      entries: []
    });

    const copilotMarketplace = RegistrySchema.parse({
      id: 'github-copilot-plugins-official',
      kind: 'copilot-extension',
      sourceType: 'vendor-feed',
      adapter: 'copilot-plugin-marketplace-v1',
      enabled: true,
      entries: []
    });

    const claudeConnectors = RegistrySchema.parse({
      id: 'anthropic-claude-connectors-scrape',
      kind: 'claude-connector',
      sourceType: 'vendor-feed',
      adapter: 'claude-connectors-scrape-v1',
      enabled: true,
      entries: []
    });

    const githubMarketplace = RegistrySchema.parse({
      id: 'github-n-skills-marketplace',
      kind: 'skill',
      sourceType: 'community-list',
      adapter: 'claude-code-marketplace-v1',
      enabled: true,
      entries: []
    });

    expect(claude.kind).toBe('claude-plugin');
    expect(copilot.kind).toBe('copilot-extension');
    expect(copilotMarketplace.adapter).toBe('copilot-plugin-marketplace-v1');
    expect(claude.adapter).toBe('claude-plugins-scrape-v1');
    expect(claudeConnectors.kind).toBe('claude-connector');
    expect(claudeConnectors.adapter).toBe('claude-connectors-scrape-v1');
    expect(githubMarketplace.adapter).toBe('claude-code-marketplace-v1');
  });
});

describe('CatalogItemSchema', () => {
  it('parses unified item shape', () => {
    const item = CatalogItemSchema.parse({
      id: 'copilot-extension:repo-security',
      kind: 'copilot-extension',
      name: 'Repo Security',
      description: 'Security insights for repositories',
      provider: 'github',
      capabilities: ['security'],
      compatibility: ['copilot', 'github'],
      source: 'official-copilot-extensions',
      lastSeenAt: '2026-02-10',
      install: { kind: 'gh-cli', target: 'copilot-extension', args: ['install', 'repo-security'] },
      adoptionSignal: 65,
      maintenanceSignal: 75,
      provenanceSignal: 95,
      freshnessSignal: 70,
      securitySignals: {
        knownVulnerabilities: 0,
        suspiciousPatterns: 0,
        injectionFindings: 0,
        exfiltrationSignals: 0,
        integrityAlerts: 0
      }
    });

    expect(item.kind).toBe('copilot-extension');
  });
});
