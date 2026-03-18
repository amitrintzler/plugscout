import { describe, expect, it } from 'vitest';

import { runDoctorChecks } from '../../src/interfaces/cli/doctor.js';

describe('doctor', () => {
  it('returns environment checks', async () => {
    const checks = await runDoctorChecks('.');

    expect(checks.length).toBeGreaterThan(0);
    expect(new Set(checks.map((check) => check.name)).has('Node version')).toBe(true);
    expect(new Set(checks.map((check) => check.name)).has('Skills CLI')).toBe(true);
  });
});
