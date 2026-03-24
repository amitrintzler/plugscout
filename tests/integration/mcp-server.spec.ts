import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/interfaces/cli/mcp.js';

describe('MCP server tools', () => {
  it('lists expected tools', async () => {
    const { client, cleanup } = await createTestClient();
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('search_catalog');
      expect(names).toContain('get_item');
      expect(names).toContain('assess_item');
      expect(names).toContain('install_item');
      expect(names).toContain('sync_catalogs');
    } finally {
      await cleanup();
    }
  });

  it('search_catalog returns an array', async () => {
    const { client, cleanup } = await createTestClient();
    try {
      const result = await client.callTool({ name: 'search_catalog', arguments: { query: 'filesystem' } });
      expect(Array.isArray(JSON.parse((result.content as [{ text: string }])[0].text))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('get_item returns NOT_FOUND error for unknown id', async () => {
    const { client, cleanup } = await createTestClient();
    try {
      const result = await client.callTool({ name: 'get_item', arguments: { id: 'mcp:does-not-exist-zzz' } });
      const text = (result.content as [{ text: string }])[0].text;
      expect(text).toContain('NOT_FOUND');
    } finally {
      await cleanup();
    }
  });
});

async function createTestClient() {
  const server = createMcpServer();
  const client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} });

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}
