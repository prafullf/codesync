import { Writable } from 'node:stream';

export const TRUNCATION_NOTICE = '\n[output truncated]';

/**
 * Collects at most `limit` bytes and silently discards the rest, so a
 * `while True: print("x")` can't exhaust the worker's memory.
 */
export class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    if (this.size >= this.limit) {
      this.truncated = true;
      return;
    }
    const room = this.limit - this.size;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (part.length < chunk.length) this.truncated = true;
    this.chunks.push(part);
    this.size += part.length;
  }

  writable(): Writable {
    return new Writable({
      write: (chunk: Buffer, _enc, cb) => {
        this.push(chunk);
        cb();
      },
    });
  }

  toString(): string {
    // A cut may land mid-way through a multi-byte character; toString replaces it safely.
    const text = Buffer.concat(this.chunks).toString('utf8');
    return this.truncated ? text + TRUNCATION_NOTICE : text;
  }
}
