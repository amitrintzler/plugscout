import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

import { loadSecurityPolicy } from '../config/runtime.js';
import { loadCatalogItemById } from '../catalog/repository.js';
import { logger } from '../lib/logger.js';
import { writeJsonFile } from '../lib/json.js';
import { getStatePath } from '../lib/paths.js';
import { InstallAuditSchema, type CatalogItem, type InstallAudit } from '../lib/validation/contracts.js';
import { buildAssessment, isBlockedTier, isWarnTier } from '../security/assessment.js';
import { hasLegacySkillSh, resolveSkillsRuntime } from './dependencies.js';
import { assertRecentReview } from './review-state.js';

export interface InstallOptions {
  id: string;
  overrideRisk: boolean;
  overrideReview: boolean;
  yes: boolean;
}

export type InstallExecutionPlan = {
  binary: string;
  args: string[];
  label: string;
  installer: InstallAudit['installer'];
};

export async function installWithSkillSh(options: InstallOptions): Promise<InstallAudit> {
  const record = await loadCatalogItemById(options.id);
  if (!record) {
    throw new Error(`Catalog entry not found: ${options.id}`);
  }

  if (!options.overrideReview) {
    await assertRecentReview(options.id);
  }

  const policy = await loadSecurityPolicy();
  const assessment = buildAssessment(record, policy);

  if (isBlockedTier(assessment.riskTier, policy) && !options.overrideRisk) {
    await persistAudit({
      id: options.id,
      requestedAt: new Date().toISOString(),
      policyDecision: 'blocked',
      overrideUsed: false,
      installer: record.install.kind,
      exitCode: 1
    });

    throw new Error(
      `Blocked by security policy (${assessment.riskTier}, score=${assessment.riskScore}). Use --override-risk to force.`
    );
  }

  if (isWarnTier(assessment.riskTier, policy)) {
    logger.warn(`Security warning for ${options.id}: ${assessment.riskTier} (${assessment.riskScore})`);
  }

  const { exitCode, installer } = await executeInstall(record, options.yes);

  return persistAudit({
    id: options.id,
    requestedAt: new Date().toISOString(),
    policyDecision: options.overrideRisk ? 'override-allowed' : 'allowed',
    overrideUsed: options.overrideRisk,
    installer,
    exitCode
  });
}

async function executeInstall(
  item: CatalogItem,
  yes: boolean
): Promise<{ exitCode: number; installer: InstallAudit['installer'] }> {
  const install = item.install;
  if (install.kind === 'manual') {
    logger.info(`Manual install required: ${install.instructions}${install.url ? ` (${install.url})` : ''}`);
    return { exitCode: 0, installer: 'manual' };
  }

  if (install.kind === 'skill.sh') {
    const plan = resolvePreferredInstallPlan(item, yes);
    if (plan) {
      const exitCode = await executeCommand(plan.binary, plan.args, plan.label);
      return { exitCode, installer: plan.installer };
    }

    ensureLegacySkillShAvailable(item.id);
    const commandArgs = buildSkillShInstallArgs(install.target, install.args, yes);
    const exitCode = await executeCommand('skill.sh', commandArgs, 'skill.sh');
    return { exitCode, installer: 'skill.sh' };
  }

  ensureBinaryAvailable('gh', 'gh CLI is required for gh-cli installers. Install it and verify with: gh --version');
  const commandArgs = buildGhInstallArgs(install.target, install.args, yes);
  const exitCode = await executeCommand('gh', commandArgs, 'gh');
  return { exitCode, installer: 'gh-cli' };
}

export function buildSkillShInstallArgs(target: string, args: string[], yes: boolean): string[] {
  const commandArgs = ['install', target, ...args];
  if (yes) {
    commandArgs.push('--yes');
  }
  return commandArgs;
}

export function buildGhInstallArgs(target: string, args: string[], yes: boolean): string[] {
  const commandArgs = [...args];
  if (commandArgs.length === 0) {
    commandArgs.push(target);
  }
  if (yes) {
    commandArgs.push('--yes');
  }
  return commandArgs;
}

export function resolvePreferredInstallPlan(item: CatalogItem, yes: boolean): InstallExecutionPlan | null {
  if (item.install.kind !== 'skill.sh') {
    return null;
  }

  const modernSkillPlan = buildModernSkillsInstallArgs(item, yes);
  if (modernSkillPlan) {
    return modernSkillPlan;
  }

  const directMcpPlan = buildDirectMcpInstallArgs(item);
  if (directMcpPlan) {
    return directMcpPlan;
  }

  return null;
}

function buildModernSkillsInstallArgs(
  item: CatalogItem,
  yes: boolean
): InstallExecutionPlan | null {
  if (item.kind !== 'skill' || item.install.kind !== 'skill.sh') {
    return null;
  }

  const runtime = resolveSkillsRuntime();
  if (!runtime) {
    return null;
  }

  const metadata = item.metadata as Record<string, unknown>;
  const registryId =
    typeof metadata.sourceRegistryId === 'string'
      ? metadata.sourceRegistryId
      : typeof metadata.marketplaceRegistry === 'string'
        ? metadata.marketplaceRegistry
        : '';
  const githubUrl = typeof metadata.githubUrl === 'string' ? metadata.githubUrl : '';

  const repoUrl = resolveSkillsRepoUrl(registryId, githubUrl);
  if (!repoUrl) {
    return null;
  }

  const slug = resolveSkillSlug(item.id, metadata);
  if (!slug) {
    return null;
  }

  const args = runtime.prefixArgs.concat(['add', repoUrl, '--skill', slug, '--agent', '*']);
  if (yes) {
    args.push('--yes');
  }

  return {
    binary: runtime.binary,
    args,
    label: runtime.label,
    installer: 'skills'
  };
}

function buildDirectMcpInstallArgs(item: CatalogItem): InstallExecutionPlan | null {
  if (item.kind !== 'mcp' || item.install.kind !== 'skill.sh') {
    return null;
  }

  const target = item.install.target;
  if (isDockerTarget(target)) {
    return {
      binary: 'docker',
      args: ['pull', target],
      label: 'docker',
      installer: 'docker'
    };
  }

  if (isNodePackageTarget(item, target)) {
    return {
      binary: 'npm',
      args: ['install', '-g', target],
      label: 'npm',
      installer: 'npm'
    };
  }

  return null;
}

function resolveSkillsRepoUrl(registryId: string, githubUrl: string): string | null {
  if (registryId === 'openai-skills-curated' || githubUrl.includes('github.com/openai/skills')) {
    return 'https://github.com/openai/skills';
  }

  if (registryId === 'anthropic-skills' || githubUrl.includes('github.com/anthropics/skills')) {
    return 'https://github.com/anthropics/skills';
  }

  return null;
}

function resolveSkillSlug(id: string, metadata: Record<string, unknown>): string | null {
  const prefixed = id.startsWith('skill:') ? id.slice('skill:'.length) : id;
  if (prefixed.length > 0) {
    return prefixed;
  }

  const githubPath = typeof metadata.githubPath === 'string' ? metadata.githubPath : '';
  if (githubPath.length > 0) {
    return githubPath.split('/').at(-1) ?? null;
  }

  const bundledSkillPath = typeof metadata.bundledSkillPath === 'string' ? metadata.bundledSkillPath : '';
  if (bundledSkillPath.length > 0) {
    return bundledSkillPath.split('/').at(-1) ?? null;
  }

  return null;
}

function isDockerTarget(target: string): boolean {
  return /^(docker\.io\/|ghcr\.io\/)/.test(target) || (/^[\w.-]+\/[\w./-]+:[\w.-]+$/.test(target) && target.includes('/'));
}

function isNodePackageTarget(item: CatalogItem, target: string): boolean {
  if (!/^(@[a-z0-9_.-]+\/[a-z0-9_.-]+|[a-z0-9][a-z0-9._-]*)$/i.test(target)) {
    return false;
  }

  const metadata = item.metadata as Record<string, unknown>;
  const registryType = typeof metadata.packageRegistryType === 'string' ? metadata.packageRegistryType.toLowerCase() : '';
  const runtime = typeof metadata.packageRuntime === 'string' ? metadata.packageRuntime.toLowerCase() : '';
  if (registryType.includes('npm') || runtime.includes('node')) {
    return true;
  }

  return item.compatibility.includes('node');
}

async function executeCommand(binary: string, args: string[], label: string): Promise<number> {
  if (process.env.SKILLS_MCPS_INSTALL_DRY_RUN === '1') {
    logger.info(`Dry-run ${label} ${args.join(' ')}`);
    return 0;
  }

  if (binary === 'docker') {
    ensureBinaryAvailable('docker', 'Docker is required for container-backed MCP installs. Install Docker Desktop or a compatible docker runtime.');
  }
  if (binary === 'npm') {
    ensureBinaryAvailable('npm', 'npm is required for Node package installs. Install Node.js and verify with: npm --version');
  }
  if (binary === 'skills') {
    ensureBinaryAvailable('skills', 'skills CLI is required. Run `plugscout doctor --install-deps` to install it.');
  }

  return new Promise<number>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: 'inherit'
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to execute ${label}: ${error.message}`));
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

function ensureBinaryAvailable(binary: string, suggestion: string): void {
  if (process.env.SKILLS_MCPS_INSTALL_DRY_RUN === '1') {
    return;
  }
  const result = spawnSync('which', [binary], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${binary} is not available in PATH. ${suggestion}`);
  }
}

function ensureLegacySkillShAvailable(id: string): void {
  if (process.env.SKILLS_MCPS_INSTALL_DRY_RUN === '1') {
    return;
  }

  if (hasLegacySkillSh()) {
    return;
  }

  throw new Error(
    `skill.sh is not available in PATH. This item (${id}) still requires the legacy skill.sh installer. Run \`plugscout doctor --install-deps\` to bootstrap the modern skills CLI for supported skill installs, or install skill.sh manually for legacy skill.sh items.`
  );
}

async function persistAudit(record: InstallAudit): Promise<InstallAudit> {
  const parsed = InstallAuditSchema.parse(record);
  const stamp = parsed.requestedAt.replace(/[:.]/g, '-');
  const file = getStatePath(`data/security-reports/audits/${stamp}-${parsed.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  await writeJsonFile(file, parsed);
  return parsed;
}
