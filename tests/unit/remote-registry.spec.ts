import { describe, expect, it } from 'vitest';

import { extractEntries, resolveRegistryEntries } from '../../src/catalog/remote-registry.js';
import { RegistrySchema } from '../../src/lib/validation/contracts.js';

describe('resolveRegistryEntries', () => {
  it('uses remote entries for json-array format', async () => {
    const registry = RegistrySchema.parse({
      id: 'remote-array',
      kind: 'skill',
      sourceType: 'public-index',
      enabled: true,
      entries: [],
      remote: {
        url: 'https://example.test/skills.json',
        format: 'json-array',
        supportsUpdatedSince: true,
        updatedSinceParam: 'updated_since',
        timeoutMs: 500,
        fallbackToLocal: true
      }
    });

    const result = await resolveRegistryEntries(
      registry,
      { updatedSince: '2026-01-01T00:00:00.000Z' },
      async (url) => {
      expect(url).toContain('updated_since=2026-01-01T00%3A00%3A00.000Z');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return [{ id: 'skill:a' }];
        }
      };
      }
    );

    expect(result.entries).toEqual([{ id: 'skill:a' }]);
    expect(result.source).toBe('remote');
  });

  it('extracts entries from catalog-json path', async () => {
    const registry = RegistrySchema.parse({
      id: 'remote-object',
      kind: 'mcp',
      sourceType: 'public-index',
      enabled: true,
      entries: [],
      remote: {
        url: 'https://registry.modelcontextprotocol.io/v0.1/servers',
        format: 'catalog-json',
        entryPath: 'payload.items',
        pagination: {
          mode: 'cursor',
          cursorParam: 'cursor',
          nextCursorPath: 'meta.nextCursor'
        },
        timeoutMs: 500,
        fallbackToLocal: true
      }
    });

    const calls: string[] = [];
    const result = await resolveRegistryEntries(registry, {}, async (url) => {
        calls.push(url);
        if (url.includes('cursor=')) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            async json() {
              return { payload: { items: [{ id: 'mcp:b' }] }, meta: {} };
            }
          };
        }

        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          async json() {
            return { payload: { items: [{ id: 'mcp:a' }] }, meta: { nextCursor: 'abc' } };
          }
        };
      });

    expect(result.entries).toEqual([{ id: 'mcp:a' }, { id: 'mcp:b' }]);
    expect(result.source).toBe('remote');
    expect(calls.length).toBe(2);
  });

  it('falls back to local entries when remote fails and fallback is enabled', async () => {
    const registry = RegistrySchema.parse({
      id: 'remote-fallback',
      kind: 'skill',
      sourceType: 'community-list',
      enabled: true,
      entries: [{ id: 'skill:local' }],
      remote: {
        url: 'https://example.test/down.json',
        format: 'json-array',
        timeoutMs: 500,
        fallbackToLocal: true
      }
    });

    const result = await resolveRegistryEntries(registry, {}, async () => {
      throw new Error('Network unavailable');
    });

    expect(result.entries).toEqual([{ id: 'skill:local' }]);
    expect(result.source).toBe('local');
  });

  it('resolves default key for plugin kinds in catalog-json format', () => {
    const parsed = extractEntries(
      { plugins: [{ id: 'claude-plugin:a' }] },
      'catalog-json',
      undefined,
      'claude-plugin'
    );
    expect(parsed).toEqual([{ id: 'claude-plugin:a' }]);
  });

  it('resolves default key for connector kinds in catalog-json format', () => {
    const parsed = extractEntries(
      { connectors: [{ id: 'claude-connector:a' }] },
      'catalog-json',
      undefined,
      'claude-connector'
    );
    expect(parsed).toEqual([{ id: 'claude-connector:a' }]);
  });

  it('supports html remote payload extraction', () => {
    const parsed = extractEntries('<html><body>ok</body></html>', 'html', undefined, 'claude-plugin');
    expect(parsed).toEqual(['<html><body>ok</body></html>']);
  });

  it('rejects non-allowlisted hosts for plugin and mcp registries', async () => {
    const registry = RegistrySchema.parse({
      id: 'unsafe-plugin-host',
      kind: 'copilot-extension',
      sourceType: 'vendor-feed',
      enabled: true,
      entries: [],
      remote: {
        url: 'https://api.github.com/copilot/extensions/catalog',
        format: 'catalog-json',
        entryPath: 'extensions',
        timeoutMs: 500,
        fallbackToLocal: false
      }
    });

    await expect(resolveRegistryEntries(registry)).rejects.toThrow('not in safe host allowlist');
  });
});
