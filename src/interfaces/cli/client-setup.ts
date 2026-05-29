import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export type ClientKind = 'cursor' | 'gemini' | 'claude-desktop' | 'windsurf' | 'opencode' | 'zed';
export type ScopeKind = 'user' | 'project';

interface ClientDef {
  label: string;
  supportsProjectScope: boolean;
  getConfigPath(scope: ScopeKind): string;
  containerPath: string[];
  entryValue: unknown;
}

const PLUGSCOUT_MCP_STDIO = { command: 'npx', args: ['plugscout', 'mcp'] };
const PLUGSCOUT_MCP_ZED = { command: { path: 'npx', args: ['plugscout', 'mcp'] } };

function claudeDesktopConfigPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? os.homedir(), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'claude-desktop', 'claude_desktop_config.json');
}

function openCodeConfigPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? os.homedir(), 'opencode', 'config.json');
  }
  return path.join(os.homedir(), '.config', 'opencode', 'config.json');
}

export const CLIENT_DEFS: Record<ClientKind, ClientDef> = {
  cursor: {
    label: 'Cursor IDE',
    supportsProjectScope: true,
    getConfigPath(scope) {
      return scope === 'project'
        ? path.join(process.cwd(), '.cursor', 'mcp.json')
        : path.join(os.homedir(), '.cursor', 'mcp.json');
    },
    containerPath: ['mcpServers'],
    entryValue: PLUGSCOUT_MCP_STDIO,
  },
  gemini: {
    label: 'Gemini CLI',
    supportsProjectScope: false,
    getConfigPath() {
      return path.join(os.homedir(), '.gemini', 'settings.json');
    },
    containerPath: ['mcpServers'],
    entryValue: PLUGSCOUT_MCP_STDIO,
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    supportsProjectScope: false,
    getConfigPath() {
      return claudeDesktopConfigPath();
    },
    containerPath: ['mcpServers'],
    entryValue: PLUGSCOUT_MCP_STDIO,
  },
  windsurf: {
    label: 'Windsurf',
    supportsProjectScope: false,
    getConfigPath() {
      return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
    },
    containerPath: ['mcpServers'],
    entryValue: PLUGSCOUT_MCP_STDIO,
  },
  opencode: {
    label: 'OpenCode',
    supportsProjectScope: false,
    getConfigPath() {
      return openCodeConfigPath();
    },
    containerPath: ['mcp'],
    entryValue: PLUGSCOUT_MCP_STDIO,
  },
  zed: {
    label: 'Zed',
    supportsProjectScope: false,
    getConfigPath() {
      return path.join(os.homedir(), '.config', 'zed', 'settings.json');
    },
    containerPath: ['context_servers'],
    entryValue: PLUGSCOUT_MCP_ZED,
  },
};

export const VALID_CLIENT_KINDS = Object.keys(CLIENT_DEFS) as ClientKind[];

export function getConfigPath(client: ClientKind, scope: ScopeKind): string {
  return CLIENT_DEFS[client].getConfigPath(scope);
}

function navigateContainer(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let current = obj;
  for (const key of keys) {
    const next = current[key];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  return current;
}

export async function getClientMcpConfigStatus(
  client: ClientKind,
  scope: ScopeKind
): Promise<{ configured: boolean; configPath: string }> {
  const def = CLIENT_DEFS[client];
  const configPath = def.getConfigPath(scope);
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    let container: Record<string, unknown> = config;
    for (const key of def.containerPath) {
      const next = container[key];
      if (next === undefined || typeof next !== 'object' || next === null || Array.isArray(next)) {
        return { configured: false, configPath };
      }
      container = next as Record<string, unknown>;
    }
    return { configured: !!container['plugscout'], configPath };
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
  const def = CLIENT_DEFS[client];
  const scope = def.supportsProjectScope ? options.scope : 'user';
  const configPath = def.getConfigPath(scope);

  let existing: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // file doesn't exist yet — start empty
  }

  const container = navigateContainer(existing, def.containerPath);
  const current = container['plugscout'];

  if (current !== undefined) {
    const isSame = JSON.stringify(current) === JSON.stringify(def.entryValue);
    if (isSame) return { status: 'already-configured', configPath };
    if (!force) {
      throw new Error(
        `plugscout already exists in ${configPath} with a different value. Use --force to overwrite.`
      );
    }
  }

  container['plugscout'] = def.entryValue;

  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${configPath}.plugscout.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, configPath);

  return { status: 'written', configPath };
}
