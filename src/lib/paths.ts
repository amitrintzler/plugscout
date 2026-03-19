import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '../..');

export function getPackageRoot(): string {
  return PACKAGE_ROOT;
}

export function getPackagePath(...segments: string[]): string {
  return path.resolve(PACKAGE_ROOT, ...segments);
}

export function getToolkitHome(): string {
  const root = process.env.PLUGSCOUT_HOME ?? process.env.TOOLKIT_HOME ?? path.join(os.homedir(), '.plugscout');
  return path.resolve(root);
}

export function getStatePath(...segments: string[]): string {
  return path.resolve(getToolkitHome(), ...segments);
}
