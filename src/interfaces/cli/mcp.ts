import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Writable } from 'node:stream';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  buildAssessment,
  isBlockedTier,
  loadCatalogItemById,
  loadSecurityPolicy,
  searchCatalog,
  syncCatalogs,
} from '../../api/index.js';
import { installWithSkillSh } from '../../install/skillsh.js';

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'plugscout', version: '0.3.4' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_catalog',
        description: 'Search the PlugScout catalog for plugins, MCP servers, and extensions.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term' },
            kind: { type: 'string', description: 'Filter by kind: skill, mcp, claude-plugin, claude-connector, copilot-extension' },
            provider: { type: 'string', description: 'Filter by provider' },
            limit: { type: 'number', description: 'Max results (default: 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_item',
        description: 'Get full details for a catalog item by ID.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Catalog item ID, e.g. mcp:filesystem' } },
          required: ['id'],
        },
      },
      {
        name: 'assess_item',
        description: 'Evaluate risk and policy for a catalog item before installing.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'install_item',
        description: 'Install a catalog item. Requires human confirmation in the terminal. Blocked items cannot be installed.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'sync_catalogs',
        description: 'Refresh catalog data from all configured registries.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (name === 'search_catalog') {
      const { query, kind, provider, limit = 20 } = args as { query: string; kind?: string; provider?: string; limit?: number };
      const VALID_KINDS = ['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension'] as const;
      type ValidKind = (typeof VALID_KINDS)[number];
      if (kind !== undefined && !VALID_KINDS.includes(kind as ValidKind)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'INVALID_KIND', valid: VALID_KINDS, received: kind }) }] };
      }
      const results = await searchCatalog(query, { kind: kind as ValidKind | undefined, provider, limit });
      return { content: [{ type: 'text', text: JSON.stringify(results) }] };
    }

    if (name === 'get_item') {
      const { id } = args as { id: string };
      const item = await loadCatalogItemById(id);
      if (!item) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND', id }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(item) }] };
    }

    if (name === 'assess_item') {
      const { id } = args as { id: string };
      const item = await loadCatalogItemById(id);
      if (!item) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'NOT_FOUND', id }) }] };
      }
      const policy = await loadSecurityPolicy();
      const assessment = buildAssessment(item, policy);
      const blocked = isBlockedTier(assessment.riskTier, policy);
      return { content: [{ type: 'text', text: JSON.stringify({ ...assessment, install_allowed: !blocked }) }] };
    }

    if (name === 'install_item') {
      const { id } = args as { id: string };
      const item = await loadCatalogItemById(id);
      if (!item) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', detail: 'NOT_FOUND' }) }] };
      }
      const policy = await loadSecurityPolicy();
      const assessment = buildAssessment(item, policy);
      const blocked = isBlockedTier(assessment.riskTier, policy);
      if (blocked) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'blocked', detail: `risk tier: ${assessment.riskTier}` }) }] };
      }

      if (process.platform === 'win32') {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'cancelled', detail: 'interactive confirmation not supported on Windows' }) }] };
      }

      const confirmed = await promptViaTty(item.id, assessment.riskTier, assessment.riskScore);
      if (!confirmed) {
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'cancelled' }) }] };
      }

      try {
        await installWithSkillSh({ id: item.id, overrideRisk: false, overrideReview: false, yes: true });
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'installed' }) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', detail: msg }) }] };
      }
    }

    if (name === 'sync_catalogs') {
      const result = await syncCatalogs();
      return { content: [{ type: 'text', text: JSON.stringify({ items_loaded: result.items.length, stale_registries: result.staleRegistries }) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

async function promptViaTty(id: string, riskTier: string, riskScore: number): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (value: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const tty = createWriteStream('/dev/tty');
    const ttyIn = createReadStream('/dev/tty');

    let input = '';
    const timeout = setTimeout(() => {
      ttyIn.destroy();
      tty.end();
      settle(false);
    }, 60_000);

    tty.write(`\nPlugScout install requested by AI assistant\n`);
    tty.write(`Item: ${id} (risk: ${riskTier}/${riskScore})\n`);
    tty.write(`Confirm? [y/N]: `);

    ttyIn.on('data', (chunk: Buffer) => {
      input += chunk.toString();
      if (input.includes('\n') || input.includes('\r')) {
        clearTimeout(timeout);
        ttyIn.destroy();
        tty.end();
        settle(input.trim().toLowerCase() === 'y');
      }
    });

    ttyIn.on('error', () => {
      clearTimeout(timeout);
      tty.end();
      settle(false);
    });
  });
}

export async function startMcpServer(
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout
): Promise<() => Promise<void>> {
  const server = createMcpServer();
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);
  return async () => server.close();
}

export async function handleMcp(_args: string[]): Promise<void> {
  await startMcpServer();
  // Keep process alive — MCP server runs until the client disconnects
  await new Promise<void>(() => {/* intentionally never resolves */});
}
