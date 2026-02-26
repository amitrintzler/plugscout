import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkForUpdateNow,
  getUpdateCheckStatePath,
  isCacheFresh,
  isUpdateCheckDisabled,
  isVersionNewer,
  maybeNotifyAboutUpdate,
  normalizeReleaseVersion
} from '../../src/interfaces/cli/update-check.js';

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  } as Response;
}

describe('update check', () => {
  let toolkitHome: string;
  let previousToolkitHome: string | undefined;
  let previousDisable: string | undefined;
  let previousCi: string | undefined;
  let previousTTY: unknown;

  beforeEach(async () => {
    toolkitHome = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkit-update-check-'));
    previousToolkitHome = process.env.TOOLKIT_HOME;
    previousDisable = process.env.TOOLKIT_DISABLE_UPDATE_CHECK;
    previousCi = process.env.CI;
    previousTTY = (process.stdout as { isTTY?: unknown }).isTTY;

    process.env.TOOLKIT_HOME = toolkitHome;
    delete process.env.TOOLKIT_DISABLE_UPDATE_CHECK;
    delete process.env.CI;
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: true
    });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: previousTTY
    });

    if (previousToolkitHome === undefined) {
      delete process.env.TOOLKIT_HOME;
    } else {
      process.env.TOOLKIT_HOME = previousToolkitHome;
    }

    if (previousDisable === undefined) {
      delete process.env.TOOLKIT_DISABLE_UPDATE_CHECK;
    } else {
      process.env.TOOLKIT_DISABLE_UPDATE_CHECK = previousDisable;
    }

    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }

    await fs.rm(toolkitHome, { recursive: true, force: true });
  });

  it('normalizes release tags and version strings', () => {
    expect(normalizeReleaseVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeReleaseVersion('1.2.3')).toBe('1.2.3');
    expect(normalizeReleaseVersion('release-2.4.1')).toBe('2.4.1');
    expect(normalizeReleaseVersion('invalid')).toBeNull();
  });

  it('compares semantic versions correctly', () => {
    expect(isVersionNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isVersionNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isVersionNewer('0.9.9', '1.0.0')).toBe(false);
  });

  it('evaluates cache freshness within a 24h window', () => {
    const now = new Date('2026-02-26T12:00:00.000Z');
    expect(isCacheFresh('2026-02-26T11:30:00.000Z', now)).toBe(true);
    expect(isCacheFresh('2026-02-25T09:00:00.000Z', now)).toBe(false);
    expect(isCacheFresh(undefined, now)).toBe(false);
  });

  it('honors disable conditions', () => {
    expect(isUpdateCheckDisabled({ disableAutoCheck: true })).toBe(true);

    process.env.TOOLKIT_DISABLE_UPDATE_CHECK = '1';
    expect(isUpdateCheckDisabled({ disableAutoCheck: false })).toBe(true);

    delete process.env.TOOLKIT_DISABLE_UPDATE_CHECK;
    process.env.CI = 'true';
    expect(isUpdateCheckDisabled({ disableAutoCheck: false })).toBe(true);

    delete process.env.CI;
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false
    });
    expect(isUpdateCheckDisabled({ disableAutoCheck: false })).toBe(true);
  });

  it('returns no-release when GitHub has no published release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, {})));

    const result = await checkForUpdateNow();
    expect(result.status).toBe('no-release');

    const cacheRaw = await fs.readFile(getUpdateCheckStatePath(), 'utf8');
    expect(cacheRaw).toContain('lastCheckedAt');
  });

  it('returns update-available when newer release exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v9.9.9' })));

    const result = await checkForUpdateNow();
    expect(result.status).toBe('update-available');
    if (result.status === 'update-available') {
      expect(result.latestVersion).toBe('9.9.9');
    }
  });

  it('returns up-to-date when release matches current version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v0.3.0' })));

    const result = await checkForUpdateNow();
    expect(result.status).toBe('up-to-date');
  });

  it('keeps auto-check silent on network errors', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(maybeNotifyAboutUpdate()).resolves.toBeUndefined();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('notifies only once for the same discovered version', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(200, { tag_name: 'v9.9.9' })));

    await maybeNotifyAboutUpdate();
    const firstCallCount = logSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await maybeNotifyAboutUpdate();
    expect(logSpy.mock.calls.length).toBe(firstCallCount);
  });
});
