import { describe, expect, it } from 'vitest';
import { colorForUser } from './colors';

describe('colorForUser', () => {
  it('is deterministic', () => {
    expect(colorForUser('user-1')).toBe(colorForUser('user-1'));
  });
  it('returns a hex colour', () => {
    expect(colorForUser('abc')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
