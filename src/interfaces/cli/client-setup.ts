import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export type ClientKind = 'cursor' | 'gemini';
export type ScopeKind = 'user' | 'project';

const PLUGSCOUT_MCP_VALUE = { command: 'npx', args: ['plugscout', 'mcp'] };

export function getConfigPath(client: ClientKind, scope: ScopeKind): string {
  if (client === 'cursor') {
    if (scope === 'project') {
      return path.join(process.cwd(), '.cursor', 'mcp.json');
    }
    return path.join(os.homedir(), '.cursor', 'mcp.json');
  }
  return path.join(os.homedir(), '.gemini', 'settings.json');
}

export async function getClientMcpConfigStatus(
  client: ClientKind,
  scope: ScopeKind
): Promise<{ configured: boolean; configPath: string }> {
  const configPath = getConfigPath(client, scope);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = config.mcpServers as Record<string, unknown> | undefined;
    const configured = !!(mcpServers?.plugscout);
    return { configured, configPath };
  } catch {
    return { configured: false, configPath };
  }
}

export async function writeClientMcpConfig(options: {
  client: ClientKind;
  scope: ScopeKind;
  force?: boolean;
}): Promise<{ status: 'written' | 'already-configured'; configPath: string }> {
  const { client, force = false } = options;
  const scope = client === 'gemini' ? 'user' : options.scope;
  const configPath = getConfigPath(client, scope);

  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // file doesn't exist yet — start empty
  }

  const mcpServers = (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  const current = mcpServers.plugscout;

  if (current !== undefined) {
    const isSame = JSON.stringify(current) === JSON.stringify(PLUGSCOUT_MCP_VALUE);
    if (isSame) {
      return { status: 'already-configured', configPath };
    }
    if (!force) {
      throw new Error(
        `plugscout already exists in ${configPath} with a different value. Use --force to overwrite.`
      );
    }
  }

  const updated: Record<string, unknown> = {
    ...existing,
    mcpServers: { ...mcpServers, plugscout: PLUGSCOUT_MCP_VALUE }
  };

  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${configPath}.plugscout.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, configPath);

  return { status: 'written', configPath };
}
