import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import * as repository from '../../src/catalog/repository.js';
import { syncCatalogs } from '../../src/catalog/sync.js';
import { getSyncStatePath } from '../../src/catalog/sync-state.js';
import { loadRegistries } from '../../src/config/runtime.js';
import { installWithSkillSh } from '../../src/install/skillsh.js';
import { recommend } from '../../src/recommendation/engine.js';
import { detectProjectSignals } from '../../src/recommendation/project-analysis.js';
import { loadRequirementsProfile } from '../../src/recommendation/requirements.js';
import type { CatalogKind, Recommendation } from '../../src/lib/validation/contracts.js';

const TOOLKIT_HOME = path.resolve(
  path.join(os.tmpdir(), `toolkit-functionality-claims-${process.pid}-${Math.random().toString(16).slice(2)}`)
);
type FileSnapshot = { exists: boolean; content: string };
const snapshots = new Map<string, FileSnapshot>();

const REQUIRED_KINDS: CatalogKind[] = ['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension'];
const PROJECT_FIXTURE = 'tests/fixtures/project-node';
const REQUIREMENTS_FIXTURE = 'tests/fixtures/requirements.yml';

let previousToolkitHome: string | undefined;
let previousOffline: string | undefined;
let previousToday: string | undefined;
let previousDryRun: string | undefined;

async function snapshotFile(filePath: string): Promise<void> {
  if (snapshots.has(filePath)) {
    return;
  }

  try {
    const content = await fs.readFile(filePath, 'utf8');
    snapshots.set(filePath, { exists: true, content });
  } catch (error) {
    const maybeFsError = error as NodeJS.ErrnoException;
    if (maybeFsError.code === 'ENOENT') {
      snapshots.set(filePath, { exists: false, content: '' });
      return;
    }
    throw error;
  }
}

async function restoreFile(filePath: string): Promise<void> {
  const snapshot = snapshots.get(filePath);
  if (!snapshot) {
    return;
  }

  if (!snapshot.exists) {
    await fs.rm(filePath, { force: true });
    return;
  }

  await fs.writeFile(filePath, snapshot.content, 'utf8');
}

function getSnapshotPaths(): string[] {
  return [
    repository.getWhitelistPath(),
    repository.getQuarantinePath(),
    repository.getItemsPath(),
    repository.getSkillsPath(),
    repository.getMcpsPath(),
    getSyncStatePath()
  ];
}

function getPerTestRestorePaths(): string[] {
  return [repository.getWhitelistPath(), repository.getQuarantinePath()];
}

async function rank(kind?: CatalogKind): Promise<Recommendation[]> {
  const [projectSignals, requirements] = await Promise.all([
    detectProjectSignals(PROJECT_FIXTURE),
    loadRequirementsProfile(REQUIREMENTS_FIXTURE)
  ]);

  return recommend({ projectSignals, requirements, kinds: kind ? [kind] : undefined });
}

beforeAll(async () => {
  previousToolkitHome = process.env.TOOLKIT_HOME;
  process.env.TOOLKIT_HOME = TOOLKIT_HOME;
  await Promise.all(getSnapshotPaths().map((filePath) => snapshotFile(filePath)));

  previousOffline = process.env.SKILLS_MCPS_SYNC_OFFLINE;
  previousToday = process.env.SKILLS_MCPS_SYNC_TODAY;
  previousDryRun = process.env.SKILLS_MCPS_INSTALL_DRY_RUN;

  const effectiveToday = previousToday || new Date().toISOString().slice(0, 10);
  process.env.SKILLS_MCPS_SYNC_OFFLINE = '1';
  process.env.SKILLS_MCPS_SYNC_TODAY = effectiveToday;
  process.env.SKILLS_MCPS_INSTALL_DRY_RUN = '1';

  await syncCatalogs(effectiveToday);
});

afterEach(async () => {
  await Promise.all(getPerTestRestorePaths().map((filePath) => restoreFile(filePath)));
});

afterAll(async () => {
  await Promise.all(getSnapshotPaths().map((filePath) => restoreFile(filePath)));

  if (previousOffline === undefined) {
    delete process.env.SKILLS_MCPS_SYNC_OFFLINE;
  } else {
    process.env.SKILLS_MCPS_SYNC_OFFLINE = previousOffline;
  }

  if (previousToday === undefined) {
    delete process.env.SKILLS_MCPS_SYNC_TODAY;
  } else {
    process.env.SKILLS_MCPS_SYNC_TODAY = previousToday;
  }

  if (previousDryRun === undefined) {
    delete process.env.SKILLS_MCPS_INSTALL_DRY_RUN;
  } else {
    process.env.SKILLS_MCPS_INSTALL_DRY_RUN = previousDryRun;
  }

  if (previousToolkitHome === undefined) {
    delete process.env.TOOLKIT_HOME;
  } else {
    process.env.TOOLKIT_HOME = previousToolkitHome;
  }

  await fs.rm(TOOLKIT_HOME, { recursive: true, force: true });
});

describe('functionality claims', () => {
  it('discovers all catalog kinds and supports filtering by kind', async () => {
    const registries = await loadRegistries();
    const availableKinds = new Set(registries.map((registry) => registry.kind));

    REQUIRED_KINDS.forEach((kind) => {
      expect(availableKinds.has(kind)).toBe(true);
    });

    const items = await repository.loadCatalogItems();
    REQUIRED_KINDS.forEach((kind) => {
      expect(items.some((item) => item.kind === kind)).toBe(true);
    });

    for (const kind of REQUIRED_KINDS) {
      const ranked = await rank(kind);
      expect(ranked.length).toBeGreaterThan(0);
      expect(new Set(ranked.map((entry) => entry.kind))).toEqual(new Set([kind]));
    }
  });

  it('returns trust-first ranking output with score breakdown', async () => {
    const ranked = await rank();
    expect(ranked.length).toBeGreaterThan(0);

    const top = ranked[0];
    expect(top).toHaveProperty('rankScore');
    expect(top).toHaveProperty('riskScore');
    expect(top).toHaveProperty('blocked');
    expect(top).toHaveProperty('scoreBreakdown');

    const reconstructed =
      top.scoreBreakdown.fitScore +
      top.scoreBreakdown.trustScore +
      top.scoreBreakdown.freshnessBonus -
      top.scoreBreakdown.securityPenalty -
      top.scoreBreakdown.blockedPenalty;

    const clamped = Math.max(0, Math.min(100, reconstructed));
    expect(Math.abs(top.rankScore - clamped)).toBeLessThanOrEqual(1);
  });

  it('blocks high-risk install unless override is provided', async () => {
    await expect(
      installWithSkillSh({ id: 'mcp:remote-browser', overrideRisk: false, overrideReview: true, yes: true })
    ).rejects.toThrow('Blocked by security policy');

    const audit = await installWithSkillSh({ id: 'mcp:remote-browser', overrideRisk: true, overrideReview: true, yes: true });
    expect(audit.policyDecision).toBe('override-allowed');
  });

  it('marks quarantined entries as blocked in recommendations', async () => {
    const baseline = await rank();
    const safeEntry = baseline.find((entry) => !entry.blocked);
    expect(safeEntry).toBeDefined();

    const quarantineSpy = vi.spyOn(repository, 'loadQuarantine').mockResolvedValue([
      {
        id: safeEntry!.id,
        reason: 'contract-test quarantine coverage',
        quarantinedAt: new Date().toISOString()
      }
    ]);

    try {
      const after = await rank();
      const quarantinedEntry = after.find((entry) => entry.id === safeEntry!.id);
      expect(quarantinedEntry).toBeDefined();
      expect(quarantinedEntry!.blocked).toBe(true);
      expect(quarantinedEntry!.blockReason).toContain('Quarantined by whitelist verification');
    } finally {
      quarantineSpy.mockRestore();
    }
  });
});
