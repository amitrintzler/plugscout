import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import * as repository from '../../src/catalog/repository.js';
import { syncCatalogs } from '../../src/catalog/sync.js';
import { getSyncStatePath } from '../../src/catalog/sync-state.js';
import { installWithSkillSh } from '../../src/install/skillsh.js';
import { detectProjectSignals } from '../../src/recommendation/project-analysis.js';
import { recommend } from '../../src/recommendation/engine.js';
import { loadRequirementsProfile } from '../../src/recommendation/requirements.js';
import { applyQuarantineFromReport, verifyWhitelist } from '../../src/security/whitelist.js';

const TOOLKIT_HOME = path.resolve(
  path.join(os.tmpdir(), `toolkit-cli-flow-${process.pid}-${Math.random().toString(16).slice(2)}`)
);
type FileSnapshot = { exists: boolean; content: string };
const snapshots = new Map<string, FileSnapshot>();
let previousToolkitHome: string | undefined;

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

beforeAll(async () => {
  previousToolkitHome = process.env.TOOLKIT_HOME;
  process.env.TOOLKIT_HOME = TOOLKIT_HOME;

  await Promise.all(getSnapshotPaths().map((filePath) => snapshotFile(filePath)));

  const prevOffline = process.env.SKILLS_MCPS_SYNC_OFFLINE;
  const prevToday = process.env.SKILLS_MCPS_SYNC_TODAY;
  const effectiveToday = prevToday || new Date().toISOString().slice(0, 10);
  process.env.SKILLS_MCPS_SYNC_OFFLINE = '1';
  process.env.SKILLS_MCPS_SYNC_TODAY = effectiveToday;
  await syncCatalogs(effectiveToday);

  if (prevOffline === undefined) {
    delete process.env.SKILLS_MCPS_SYNC_OFFLINE;
  } else {
    process.env.SKILLS_MCPS_SYNC_OFFLINE = prevOffline;
  }

  if (prevToday === undefined) {
    delete process.env.SKILLS_MCPS_SYNC_TODAY;
  } else {
    process.env.SKILLS_MCPS_SYNC_TODAY = prevToday;
  }
});

afterEach(async () => {
  await Promise.all(getPerTestRestorePaths().map((filePath) => restoreFile(filePath)));
});

afterAll(async () => {
  await Promise.all(getSnapshotPaths().map((filePath) => restoreFile(filePath)));

  if (previousToolkitHome === undefined) {
    delete process.env.TOOLKIT_HOME;
  } else {
    process.env.TOOLKIT_HOME = previousToolkitHome;
  }

  await fs.rm(TOOLKIT_HOME, { recursive: true, force: true });
});

describe('integration flow', () => {
  it('runs recommendation using project manifest + requirements file', async () => {
    const projectSignals = await detectProjectSignals('tests/fixtures/project-node');
    const requirements = await loadRequirementsProfile('tests/fixtures/requirements.yml');
    const ranked = await recommend({ projectSignals, requirements });

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.some((item) => item.id === 'skill:secure-prompting')).toBe(true);
    expect(ranked.some((item) => item.blocked)).toBe(true);
  });

  it('blocks install for high-risk item unless override is provided', async () => {
    process.env.SKILLS_MCPS_INSTALL_DRY_RUN = '1';

    await expect(
      installWithSkillSh({ id: 'mcp:remote-browser', overrideRisk: false, overrideReview: true, yes: true })
    ).rejects.toThrow('Blocked by security policy');

    const audit = await installWithSkillSh({ id: 'mcp:remote-browser', overrideRisk: true, overrideReview: true, yes: true });
    expect(audit.policyDecision).toBe('override-allowed');
  });

  it('quarantines failed whitelist entries from verification report', async () => {
    const { reportPath, report } = await verifyWhitelist();
    const outcome = await applyQuarantineFromReport(reportPath);
    const whitelist = await repository.loadWhitelist();

    expect(Array.isArray(report.staleRegistries)).toBe(true);
    expect(outcome.quarantined).toBeDefined();
    outcome.removedFromWhitelist.forEach((id) => expect(whitelist.has(id)).toBe(false));
  });

  it('filters recommendations by requested kinds', async () => {
    const projectSignals = await detectProjectSignals('tests/fixtures/project-node');
    const requirements = await loadRequirementsProfile('tests/fixtures/requirements.yml');
    const ranked = await recommend({ projectSignals, requirements, kinds: ['claude-plugin'] });

    expect(ranked.length).toBeGreaterThan(0);
    expect(new Set(ranked.map((item) => item.kind))).toEqual(new Set(['claude-plugin']));
  });
});
