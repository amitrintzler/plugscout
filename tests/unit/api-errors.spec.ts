import { describe, expect, it } from 'vitest';
import { PlugScoutError } from '../../src/api/errors.js';

describe('PlugScoutError', () => {
  it('sets name, code, and message', () => {
    const err = new PlugScoutError('NOT_FOUND', 'item not found');
    expect(err.name).toBe('PlugScoutError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('item not found');
    expect(err instanceof Error).toBe(true);
  });

  it('stores optional cause', () => {
    const cause = new Error('original');
    const err = new PlugScoutError('WRAPPED', 'wrapped error', cause);
    expect(err.cause).toBe(cause);
  });
});
