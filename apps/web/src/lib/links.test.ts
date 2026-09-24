import { describe, expect, it } from 'vitest';
import { roomIdFromInput, safeNext } from './links';

describe('roomIdFromInput', () => {
  it('extracts the id from an invite link', () => {
    expect(roomIdFromInput('https://codesync.dev/room/abc_123-x')).toBe('abc_123-x');
  });
  it('accepts a bare id', () => {
    expect(roomIdFromInput('  cm123  ')).toBe('cm123');
  });
  it('rejects garbage', () => {
    expect(roomIdFromInput('hello world')).toBeNull();
  });
});

describe('safeNext', () => {
  it('allows in-app paths', () => {
    expect(safeNext('/room/abc')).toBe('/room/abc');
  });
  it('blocks open redirects', () => {
    expect(safeNext('https://evil.com')).toBe('/dashboard');
    expect(safeNext('//evil.com')).toBe('/dashboard');
    expect(safeNext('/\\evil.com')).toBe('/dashboard');
    expect(safeNext(null)).toBe('/dashboard');
  });
});
