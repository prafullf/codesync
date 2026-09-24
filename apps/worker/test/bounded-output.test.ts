import { describe, expect, it } from 'vitest';
import { BoundedOutput, TRUNCATION_NOTICE } from '../src/sandbox/bounded-output';

describe('BoundedOutput', () => {
  it('keeps output under the limit untouched', () => {
    const out = new BoundedOutput(10);
    out.push(Buffer.from('hello'));
    expect(out.toString()).toBe('hello');
    expect(out.truncated).toBe(false);
  });

  it('truncates at the byte limit and appends a notice', () => {
    const out = new BoundedOutput(8);
    out.push(Buffer.from('hello '));
    out.push(Buffer.from('world'));
    out.push(Buffer.from('more'));
    expect(out.toString()).toBe('hello wo' + TRUNCATION_NOTICE);
    expect(out.truncated).toBe(true);
  });

  it('marks exactly-full output as truncated only if more arrives', () => {
    const out = new BoundedOutput(5);
    out.push(Buffer.from('12345'));
    expect(out.truncated).toBe(false);
    out.push(Buffer.from('6'));
    expect(out.truncated).toBe(true);
  });
});
