import fs from 'node:fs/promises';

import semver from 'semver';

import { readJsonFile, writeJsonFile } from '../../lib/json.js';
import { getPackagePath, getStatePath } from '../../lib/paths.js';

const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

const RELEASE_REPO = 'amitrintzler/skills-and-mcps';
export const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
export const RELEASE_DOWNLOAD_URL = `https://github.com/${RELEASE_REPO}/releases/latest`;

interface PackageMeta {
  version?: string;
}

interface UpdateCheckState {
  lastCheckedAt?: string;
  latestVersion?: string;
  lastNotifiedVersion?: string;
  source?: 'github-releases';
}

type ReleaseLookupResult =
  | { status: 'ok'; latestVersion: string }
  | { status: 'no-release' }
  | { status: 'error' };

export type UpdateCheckResult =
  | { status: 'update-available'; currentVersion: string; latestVersion: string }
  | { status: 'up-to-date'; currentVersion: string; latestVersion: string }
  | { status: 'no-release'; currentVersion: string }
  | { status: 'error'; currentVersion: string };

export function getUpdateCheckStatePath(): string {
  return getStatePath('data/system/update-check.json');
}

export function normalizeReleaseVersion(tag: string): string | null {
  const clean = tag.trim().replace(/^v/i, '');
  const strict = semver.valid(clean);
  if (strict) {
    return strict;
  }

  const coerced = semver.coerce(clean);
  return coerced ? coerced.version : null;
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const normalizedCurrent = normalizeReleaseVersion(current);
  const normalizedCandidate = normalizeReleaseVersion(candidate);

  if (!normalizedCurrent || !normalizedCandidate) {
    return false;
  }

  return semver.gt(normalizedCandidate, normalizedCurrent);
}

export function isCacheFresh(lastCheckedAt?: string, now = new Date()): boolean {
  if (!lastCheckedAt) {
    return false;
  }

  const parsed = Date.parse(lastCheckedAt);
  if (!Number.isFinite(parsed)) {
    return false;
  }

  return now.getTime() - parsed < UPDATE_CHECK_TTL_MS;
}

export function isUpdateCheckDisabled(options: { disableAutoCheck?: boolean }): boolean {
  if (options.disableAutoCheck) {
    return true;
  }

  if (process.env.PLUGSCOUT_DISABLE_UPDATE_CHECK === '1' || process.env.TOOLKIT_DISABLE_UPDATE_CHECK === '1') {
    return true;
  }

  if (process.env.CI) {
    return true;
  }

  return !process.stdout.isTTY;
}

export async function maybeNotifyAboutUpdate(options: { disableAutoCheck?: boolean } = {}): Promise<void> {
  if (isUpdateCheckDisabled(options)) {
    return;
  }

  const currentVersion = await loadCurrentVersion();
  let state = await loadUpdateCheckState();

  if (!isCacheFresh(state.lastCheckedAt) || !state.latestVersion) {
    const fetched = await lookupLatestReleaseVersion();
    state = {
      ...state,
      lastCheckedAt: new Date().toISOString(),
      source: 'github-releases'
    };

    if (fetched.status === 'ok') {
      state.latestVersion = fetched.latestVersion;
    }

    if (fetched.status === 'no-release') {
      delete state.latestVersion;
    }

    await saveUpdateCheckState(state);

    if (fetched.status !== 'ok') {
      return;
    }
  }

  if (!state.latestVersion || !isVersionNewer(state.latestVersion, currentVersion)) {
    return;
  }

  if (state.lastNotifiedVersion === state.latestVersion) {
    return;
  }

  console.log(`New PlugScout version available: v${currentVersion} -> v${state.latestVersion}`);
  console.log(`Download: ${RELEASE_DOWNLOAD_URL}`);

  await saveUpdateCheckState({
    ...state,
    source: 'github-releases',
    lastNotifiedVersion: state.latestVersion
  });
}

export async function checkForUpdateNow(): Promise<UpdateCheckResult> {
  const currentVersion = await loadCurrentVersion();
  const result = await lookupLatestReleaseVersion();

  if (result.status === 'error') {
    return { status: 'error', currentVersion };
  }

  if (result.status === 'no-release') {
    await saveUpdateCheckState({
      ...(await loadUpdateCheckState()),
      source: 'github-releases',
      lastCheckedAt: new Date().toISOString(),
      latestVersion: undefined
    });

    return { status: 'no-release', currentVersion };
  }

  await saveUpdateCheckState({
    ...(await loadUpdateCheckState()),
    source: 'github-releases',
    lastCheckedAt: new Date().toISOString(),
    latestVersion: result.latestVersion
  });

  if (isVersionNewer(result.latestVersion, currentVersion)) {
    return { status: 'update-available', currentVersion, latestVersion: result.latestVersion };
  }

  return { status: 'up-to-date', currentVersion, latestVersion: result.latestVersion };
}

async function lookupLatestReleaseVersion(): Promise<ReleaseLookupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(RELEASE_API_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'plugscout-cli'
      }
    });

    if (response.status === 404) {
      return { status: 'no-release' };
    }

    if (!response.ok) {
      return { status: 'error' };
    }

    const payload = (await response.json()) as { tag_name?: string };
    const normalized = normalizeReleaseVersion(payload.tag_name ?? '');
    if (!normalized) {
      return { status: 'error' };
    }

    return { status: 'ok', latestVersion: normalized };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCurrentVersion(): Promise<string> {
  try {
    const raw = await fs.readFile(getPackagePath('package.json'), 'utf8');
    const parsed = JSON.parse(raw) as PackageMeta;
    const normalized = normalizeReleaseVersion(parsed.version ?? '');
    return normalized ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function loadUpdateCheckState(): Promise<UpdateCheckState> {
  const filePath = getUpdateCheckStatePath();

  try {
    const raw = await readJsonFile<unknown>(filePath);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const typed = raw as Record<string, unknown>;
    return {
      lastCheckedAt: typeof typed.lastCheckedAt === 'string' ? typed.lastCheckedAt : undefined,
      latestVersion: typeof typed.latestVersion === 'string' ? typed.latestVersion : undefined,
      lastNotifiedVersion: typeof typed.lastNotifiedVersion === 'string' ? typed.lastNotifiedVersion : undefined,
      source: typed.source === 'github-releases' ? 'github-releases' : undefined
    };
  } catch {
    return {};
  }
}

async function saveUpdateCheckState(state: UpdateCheckState): Promise<void> {
  await writeJsonFile(getUpdateCheckStatePath(), state);
}
