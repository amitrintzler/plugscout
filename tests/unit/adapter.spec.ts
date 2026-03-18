import { describe, expect, it } from 'vitest';

import { adaptRegistryEntries } from '../../src/catalog/adapter.js';
import { RegistrySchema } from '../../src/lib/validation/contracts.js';

describe('adaptRegistryEntries', () => {
  it('maps mcp-registry-v0.1 entries into internal catalog shape', () => {
    const registry = RegistrySchema.parse({
      id: 'official-mcp-registry',
      kind: 'mcp',
      sourceType: 'public-index',
      adapter: 'mcp-registry-v0.1',
      enabled: true,
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        server: {
          name: 'filesystem',
          title: 'Filesystem MCP',
          description: 'Access local files',
          packages: [
            {
              registryType: 'npm',
              identifier: '@mcp/filesystem',
              transport: { type: 'stdio' }
            }
          ],
          capabilities: ['file-read', 'file-write'],
          authModel: 'none'
        }
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'mcp:filesystem',
        kind: 'mcp',
        provider: 'mcp',
        name: 'Filesystem MCP',
        description: 'Access local files',
        transport: 'stdio',
        authModel: 'none',
        capabilities: ['file-read', 'file-write'],
        compatibility: ['general', 'node'],
        source: 'official-mcp-registry',
        install: {
          kind: 'skill.sh',
          target: '@mcp/filesystem',
          args: []
        },
        adoptionSignal: 50,
        maintenanceSignal: 65,
        provenanceSignal: 90
      })
    ]);
  });

  it('maps MCP wrapper entries with remotes and streamable-http transport', () => {
    const registry = RegistrySchema.parse({
      id: 'official-mcp-registry',
      kind: 'mcp',
      sourceType: 'public-index',
      adapter: 'mcp-registry-v0.1',
      enabled: true,
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        server: {
          name: 'agency.lona/trading',
          description: 'Trading MCP',
          remotes: [{ type: 'streamable-http', url: 'https://mcp.lona.agency/mcp' }],
          websiteUrl: 'https://lona.agency'
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            publishedAt: '2026-02-24T00:07:27.525636Z'
          }
        }
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'mcp:agency.lona/trading',
        kind: 'mcp',
        provider: 'mcp',
        transport: 'http',
        authModel: 'custom',
        install: expect.objectContaining({
          kind: 'manual',
          url: 'https://lona.agency'
        })
      })
    ]);
  });

  it('maps OpenAI curated skills from GitHub directory entries', () => {
    const registry = RegistrySchema.parse({
      id: 'openai-skills-curated',
      kind: 'skill',
      sourceType: 'vendor-feed',
      adapter: 'openai-skills-github-v1',
      enabled: true,
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        name: 'gh-fix-ci',
        path: 'skills/.curated/gh-fix-ci',
        type: 'dir',
        html_url: 'https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci'
      },
      {
        name: 'README.md',
        path: 'skills/.curated/README.md',
        type: 'file'
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill:gh-fix-ci',
        kind: 'skill',
        provider: 'openai',
        install: expect.objectContaining({
          kind: 'manual'
        })
      })
    ]);
  });

  it('maps claude plugin entries', () => {
    const registry = RegistrySchema.parse({
      id: 'official-claude-plugins',
      kind: 'claude-plugin',
      sourceType: 'vendor-feed',
      adapter: 'claude-plugins-v0.1',
      enabled: true,
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        slug: 'workspace-ops',
        title: 'Workspace Ops',
        description: 'Manage docs and tasks',
        tools: ['search', 'tickets']
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'claude-plugin:workspace-ops',
        kind: 'claude-plugin',
        provider: 'anthropic'
      })
    ]);
  });

  it('maps Claude plugin entries scraped from plugins page HTML', () => {
    const registry = RegistrySchema.parse({
      id: 'official-claude-plugins',
      kind: 'claude-plugin',
      sourceType: 'vendor-feed',
      adapter: 'claude-plugins-scrape-v1',
      enabled: true,
      entries: []
    });

    const html = '<a href="/plugins/playwright"><span>Playwright</span></a>';
    const result = adaptRegistryEntries(registry, [html]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'claude-plugin:playwright',
        kind: 'claude-plugin',
        provider: 'anthropic',
        metadata: expect.objectContaining({
          catalogType: 'plugin',
          sourceConfidence: 'scraped'
        })
      })
    ]);
  });

  it('maps copilot extension entries', () => {
    const registry = RegistrySchema.parse({
      id: 'official-copilot-extensions',
      kind: 'copilot-extension',
      sourceType: 'vendor-feed',
      adapter: 'copilot-extensions-v0.1',
      enabled: true,
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        slug: 'repo-security',
        title: 'Repo Security',
        description: 'Security insights',
        tools: ['security']
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'copilot-extension:repo-security',
        kind: 'copilot-extension',
        provider: 'github',
        install: expect.objectContaining({ kind: 'gh-cli' })
      })
    ]);
  });

  it('maps GitHub marketplace plugin entries', () => {
    const registry = RegistrySchema.parse({
      id: 'github-copilot-plugins-official',
      kind: 'copilot-extension',
      sourceType: 'vendor-feed',
      adapter: 'copilot-plugin-marketplace-v1',
      enabled: true,
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        name: 'Actions Copilot',
        description: 'Workflow and CI/CD assistant',
        source: 'https://github.com/github/actions-copilot-extension',
        version: '1.2.3',
        skills: [{ name: 'workflow', commands: ['deploy'] }]
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'copilot-extension:actions-copilot',
        kind: 'copilot-extension',
        provider: 'github',
        metadata: expect.objectContaining({
          catalogType: 'plugin',
          sourceConfidence: 'official'
        })
      })
    ]);
  });

  it('maps Claude connector entries scraped from connectors page HTML', () => {
    const registry = RegistrySchema.parse({
      id: 'anthropic-claude-connectors-scrape',
      kind: 'claude-connector',
      sourceType: 'vendor-feed',
      adapter: 'claude-connectors-scrape-v1',
      enabled: true,
      entries: []
    });

    const html = '<a href="/connectors/asana"><span>Asana</span></a>';
    const result = adaptRegistryEntries(registry, [html]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'claude-connector:asana',
        kind: 'claude-connector',
        provider: 'anthropic',
        metadata: expect.objectContaining({
          catalogType: 'connector',
          sourceConfidence: 'scraped'
        })
      })
    ]);
  });

  it('maps GitHub marketplace skill entries', () => {
    const registry = RegistrySchema.parse({
      id: 'github-neon-ai-rules',
      kind: 'skill',
      sourceType: 'vendor-feed',
      adapter: 'claude-code-marketplace-v1',
      enabled: true,
      remote: {
        url: 'https://raw.githubusercontent.com/neondatabase-labs/ai-rules/main/.claude-plugin/marketplace.json',
        format: 'catalog-json',
        entryPath: 'plugins'
      },
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        name: 'neon-plugin',
        description: 'Neon database development skills including authentication and Drizzle ORM.',
        version: '1.1.0',
        keywords: ['neon', 'postgres', 'database', 'auth'],
        source: './neon-plugin'
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill:neon-plugin',
        kind: 'skill',
        provider: 'github',
        compatibility: expect.arrayContaining(['database', 'general']),
        install: expect.objectContaining({
          kind: 'manual',
          url: 'https://github.com/neondatabase-labs/ai-rules/tree/main/neon-plugin'
        }),
        metadata: expect.objectContaining({
          catalogType: 'skill',
          sourceConfidence: 'official'
        })
      })
    ]);
  });

  it('expands bundled skill marketplace entries into individual skills', () => {
    const registry = RegistrySchema.parse({
      id: 'anthropic-skills',
      kind: 'skill',
      sourceType: 'vendor-feed',
      adapter: 'claude-code-marketplace-v1',
      enabled: true,
      remote: {
        url: 'https://raw.githubusercontent.com/anthropics/skills/main/.claude-plugin/marketplace.json',
        format: 'catalog-json',
        entryPath: 'plugins',
        provider: 'anthropic'
      },
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        name: 'document-skills',
        description: 'Collection of document processing suite.',
        source: './',
        skills: ['./skills/xlsx', './skills/docx']
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill:docx',
        kind: 'skill',
        provider: 'anthropic',
        metadata: expect.objectContaining({
          bundledSkillPath: 'skills/docx',
          marketplacePlugin: 'document-skills'
        })
      }),
      expect.objectContaining({
        id: 'skill:xlsx',
        kind: 'skill',
        provider: 'anthropic',
        metadata: expect.objectContaining({
          bundledSkillPath: 'skills/xlsx',
          marketplacePlugin: 'document-skills'
        })
      })
    ]);
  });

  it('maps GitHub marketplace Claude plugin entries', () => {
    const registry = RegistrySchema.parse({
      id: 'github-pleaseai-claude-code-plugins',
      kind: 'claude-plugin',
      sourceType: 'community-list',
      adapter: 'claude-code-marketplace-v1',
      enabled: true,
      remote: {
        url: 'https://raw.githubusercontent.com/pleaseai/claude-code-plugins/main/.claude-plugin/marketplace.json',
        format: 'catalog-json',
        entryPath: 'plugins'
      },
      entries: []
    });

    const result = adaptRegistryEntries(registry, [
      {
        name: 'chrome-devtools-mcp',
        description: 'Control and inspect a live Chrome browser through MCP.',
        category: 'browser',
        keywords: ['chrome', 'devtools', 'browser', 'debugging'],
        source: {
          source: 'github',
          repo: 'ChromeDevTools/chrome-devtools-mcp'
        }
      }
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'claude-plugin:chrome-devtools-mcp',
        kind: 'claude-plugin',
        provider: 'github',
        capabilities: expect.arrayContaining(['browser-control']),
        install: expect.objectContaining({
          kind: 'manual',
          url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp'
        }),
        metadata: expect.objectContaining({
          catalogType: 'plugin',
          sourceConfidence: 'vetted-curated'
        })
      })
    ]);
  });
});
