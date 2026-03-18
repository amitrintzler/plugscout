import type { Registry } from '../lib/validation/contracts.js';
import { adaptClaudeConnectorsScrapeEntries } from './adapters/claude-connectors-scrape-v1.js';
import { adaptClaudeCodeMarketplaceEntries } from './adapters/claude-code-marketplace-v1.js';
import { adaptClaudePluginsEntries } from './adapters/claude-plugins-v0.1.js';
import { adaptClaudePluginsScrapeEntries } from './adapters/claude-plugins-scrape-v1.js';
import { adaptCopilotPluginMarketplaceEntries } from './adapters/copilot-plugin-marketplace-v1.js';
import { adaptCopilotExtensionsEntries } from './adapters/copilot-extensions-v0.1.js';
import { adaptMcpRegistryEntries } from './adapters/mcp-registry-v0.1.js';
import { adaptOpenAiSkillsGitHubEntries } from './adapters/openai-skills-github-v1.js';
import { adaptOpenAiSkillsEntries } from './adapters/openai-skills-v1.js';

export function adaptRegistryEntries(registry: Registry, entries: unknown[]): unknown[] {
  if (registry.adapter === 'mcp-registry-v0.1') {
    return adaptMcpRegistryEntries(registry.id, entries);
  }

  if (registry.adapter === 'openai-skills-v1') {
    return adaptOpenAiSkillsEntries(registry.id, entries);
  }

  if (registry.adapter === 'openai-skills-github-v1') {
    return adaptOpenAiSkillsGitHubEntries(registry.id, entries);
  }

  if (registry.adapter === 'claude-plugins-v0.1') {
    return adaptClaudePluginsEntries(registry.id, entries);
  }

  if (registry.adapter === 'claude-plugins-scrape-v1') {
    return adaptClaudePluginsScrapeEntries(registry.id, entries);
  }

  if (registry.adapter === 'claude-code-marketplace-v1') {
    return adaptClaudeCodeMarketplaceEntries(registry, entries);
  }

  if (registry.adapter === 'copilot-extensions-v0.1') {
    return adaptCopilotExtensionsEntries(registry.id, entries);
  }

  if (registry.adapter === 'copilot-plugin-marketplace-v1') {
    return adaptCopilotPluginMarketplaceEntries(registry.id, entries);
  }

  if (registry.adapter === 'claude-connectors-scrape-v1') {
    return adaptClaudeConnectorsScrapeEntries(registry.id, entries);
  }

  return entries;
}
