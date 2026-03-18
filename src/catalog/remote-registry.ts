import { logger } from '../lib/logger.js';
import type { Registry, RemoteRegistryConfig } from '../lib/validation/contracts.js';

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

interface FetchLike {
  (input: string, init?: RequestInit): Promise<FetchLikeResponse>;
}

export interface ResolvedRegistryEntries {
  entries: unknown[];
  source: 'remote' | 'local';
}

const SAFE_REMOTE_HOSTS = [
  'claude.com',
  'www.anthropic.com',
  'raw.githubusercontent.com',
  'github.com',
  'registry.modelcontextprotocol.io'
];

export async function resolveRegistryEntries(
  registry: Registry,
  options: { updatedSince?: string } = {},
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<ResolvedRegistryEntries> {
  if (process.env.SKILLS_MCPS_SYNC_OFFLINE === '1') {
    return { entries: registry.entries, source: 'local' };
  }

  if (!registry.remote) {
    return { entries: registry.entries, source: 'local' };
  }

  if (registry.remote.authEnv) {
    const token = process.env[registry.remote.authEnv];
    if (!token && registry.entries.length > 0) {
      logger.info(
        `Remote registry ${registry.id} requires ${registry.remote.authEnv}; using ${registry.entries.length} local fallback entries`
      );
      return { entries: registry.entries, source: 'local' };
    }
  }

  try {
    const parsed = await fetchRemoteRegistryEntries(registry, options, fetchImpl);

    if (parsed.length === 0 && registry.entries.length > 0) {
      const level = options.updatedSince ? 'info' : 'warn';
      const reason = options.updatedSince ? 'returned no updates' : 'returned no entries';
      logger[level](
        `Remote registry ${registry.id} ${reason}; using ${registry.entries.length} local fallback entries`
      );
      return { entries: registry.entries, source: 'local' };
    }

    return { entries: parsed, source: 'remote' };
  } catch (error) {
    if (registry.remote.fallbackToLocal && registry.entries.length > 0) {
      logger.warn(
        `Remote registry ${registry.id} fetch failed (${summarizeError(error)}); using ${registry.entries.length} local fallback entries`
      );
      return { entries: registry.entries, source: 'local' };
    }

    throw error;
  }
}

export async function fetchRemoteRegistryEntries(
  registry: Registry,
  options: { updatedSince?: string } = {},
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<unknown[]> {
  if (!registry.remote) {
    throw new Error(`Registry ${registry.id} has no remote definition`);
  }

  validateRemoteHost(registry);

  const allEntries: unknown[] = [];
  let cursor: string | undefined;

  do {
    const payload = await fetchRemoteRegistryPayload(registry, fetchImpl, {
      cursor,
      updatedSince: options.updatedSince
    });
    const parsed = extractEntries(payload, registry.remote.format, registry.remote.entryPath, registry.kind);
    allEntries.push(...parsed);
    cursor = resolveNextCursor(payload, registry.remote.pagination?.nextCursorPath);
  } while (cursor && registry.remote.pagination);

  return allEntries;
}

async function fetchRemoteRegistryPayload(
  registry: Registry,
  fetchImpl: FetchLike,
  params: { cursor?: string; updatedSince?: string }
): Promise<unknown> {
  const remote = registry.remote;
  if (!remote) {
    throw new Error(`Registry ${registry.id} has no remote definition`);
  }

  const headers: Record<string, string> = {
    Accept: remote.format === 'html' ? 'text/html' : 'application/json'
  };

  if (remote.authEnv) {
    const token = process.env[remote.authEnv];
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutMs = remote.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = buildRemoteUrl(remote, params);
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Remote registry ${registry.id} request failed with ${response.status} ${response.statusText}`
      );
    }

    if (remote.format === 'html') {
      if (!response.text) {
        throw new Error(`Remote registry ${registry.id} expected text() response handler`);
      }
      return response.text();
    }

    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function extractEntries(
  payload: unknown,
  format: RemoteRegistryConfig['format'],
  entryPath: string | undefined,
  kind: Registry['kind']
): unknown[] {
  if (format === 'json-array') {
    if (!Array.isArray(payload)) {
      throw new Error('Expected remote payload to be an array');
    }
    return payload;
  }

  if (format === 'html') {
    if (typeof payload !== 'string') {
      throw new Error('Expected remote payload to be a string for html format');
    }
    return [payload];
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Expected remote payload to be an object for catalog-json format');
  }

  const base = payload as Record<string, unknown>;
  const defaultKey = defaultCatalogKeyByKind(kind);
  const resolved = entryPath ? resolveByPath(base, entryPath) : base[defaultKey];

  if (!Array.isArray(resolved)) {
    throw new Error(`Expected resolved catalog entries to be an array at path: ${entryPath ?? defaultKey}`);
  }

  return resolved;
}

function defaultCatalogKeyByKind(kind: Registry['kind']): string {
  if (kind === 'mcp') {
    return 'mcps';
  }
  if (kind === 'claude-plugin') {
    return 'plugins';
  }
  if (kind === 'claude-connector') {
    return 'connectors';
  }
  if (kind === 'copilot-extension') {
    return 'extensions';
  }
  return 'skills';
}

function resolveByPath(value: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter((segment) => segment.length > 0);
  let current: unknown = value;

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function resolveNextCursor(payload: unknown, path = 'next_cursor'): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }

  const resolved = resolveByPath(payload as Record<string, unknown>, path);
  return typeof resolved === 'string' && resolved.trim().length > 0 ? resolved : undefined;
}

function buildRemoteUrl(
  remote: RemoteRegistryConfig,
  params: { cursor?: string; updatedSince?: string }
): string {
  const url = new URL(remote.url);

  if (remote.supportsUpdatedSince && params.updatedSince) {
    url.searchParams.set(remote.updatedSinceParam, params.updatedSince);
  }

  if (remote.pagination?.limitParam && remote.pagination.limit) {
    url.searchParams.set(remote.pagination.limitParam, String(remote.pagination.limit));
  }

  if (remote.pagination && params.cursor) {
    url.searchParams.set(remote.pagination.cursorParam, params.cursor);
  }

  return url.toString();
}

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'unknown error';
}

function validateRemoteHost(registry: Registry): void {
  if (!registry.remote || !requiresSafeHostAllowlist(registry.kind)) {
    return;
  }

  let url: URL;
  try {
    url = new URL(registry.remote.url);
  } catch {
    throw new Error(`Remote registry ${registry.id} has invalid URL: ${registry.remote.url}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Remote registry ${registry.id} rejected non-HTTPS endpoint: ${registry.remote.url}`);
  }

  const hostname = url.hostname.toLowerCase();
  const allowed = SAFE_REMOTE_HOSTS.includes(hostname);

  if (!allowed) {
    throw new Error(
      `Remote registry ${registry.id} host ${hostname} is not in safe host allowlist`
    );
  }
}

function requiresSafeHostAllowlist(kind: Registry['kind']): boolean {
  return kind === 'claude-plugin' || kind === 'claude-connector' || kind === 'copilot-extension' || kind === 'mcp';
}
