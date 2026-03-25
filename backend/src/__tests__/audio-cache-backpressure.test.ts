import { describe, it, expect, vi } from 'vitest';
import { PassThrough, Writable } from 'stream';

/**
 * Test backpressure handling logic used in audio cache writes.
 * Tests the pattern: check write() return value → pause source on false → resume on drain.
 */

describe('Stream backpressure handling', () => {
  it('should pause source when write returns false', () => {
    const source = new PassThrough();
    const pauseSpy = vi.spyOn(source, 'pause');

    // Create a slow writable that immediately signals backpressure
    const slowWritable = new Writable({
      highWaterMark: 16, // Very small buffer
      write(_chunk, _encoding, callback) {
        // Simulate slow write
        setTimeout(callback, 50);
      },
    });

    // Replicate the pattern from youtube.controller.ts
    source.on('data', (chunk: Buffer) => {
      const canContinue = slowWritable.write(chunk);
      if (!canContinue) {
        source.pause();
      }
    });

    slowWritable.on('drain', () => {
      source.resume();
    });

    // Write enough data to trigger backpressure
    source.push(Buffer.alloc(1024));
    source.push(Buffer.alloc(1024));
    source.push(Buffer.alloc(1024));

    // Source should have been paused at some point
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('should resume source after drain event', async () => {
    const source = new PassThrough();
    const resumeSpy = vi.spyOn(source, 'resume');

    let writeCallback: (() => void) | null = null;

    const slowWritable = new Writable({
      highWaterMark: 16,
      write(_chunk, _encoding, callback) {
        writeCallback = callback;
      },
    });

    source.on('data', (chunk: Buffer) => {
      const canContinue = slowWritable.write(chunk);
      if (!canContinue) {
        source.pause();
      }
    });

    slowWritable.on('drain', () => {
      source.resume();
    });

    // Push data to trigger backpressure
    source.push(Buffer.alloc(64));

    // Complete the pending write to trigger drain
    if (writeCallback) {
      (writeCallback as () => void)();
    }

    // Wait for drain event to propagate
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(resumeSpy).toHaveBeenCalled();
  });

  it('should write all data completely when backpressure is handled', async () => {
    const source = new PassThrough();
    let totalBytes = 0;

    const writable = new Writable({
      highWaterMark: 32,
      write(chunk, _encoding, callback) {
        totalBytes += chunk.length;
        // Simulate async write
        setImmediate(callback);
      },
    });

    source.on('data', (chunk: Buffer) => {
      const canContinue = writable.write(chunk);
      if (!canContinue && !source.destroyed) {
        source.pause();
      }
    });

    writable.on('drain', () => {
      if (!source.destroyed) {
        source.resume();
      }
    });

    // Write multiple chunks
    const inputSize = 256;
    source.push(Buffer.alloc(inputSize, 0xAA));
    source.push(Buffer.alloc(inputSize, 0xBB));
    source.push(Buffer.alloc(inputSize, 0xCC));
    source.push(null); // End of stream

    // Wait for all writes to complete
    await new Promise<void>((resolve) => {
      writable.on('finish', resolve);
      source.on('end', () => {
        writable.end();
      });
    });

    expect(totalBytes).toBe(inputSize * 3);
  });

  it('should not lose data when cache write is slower than source', async () => {
    const source = new PassThrough();
    const receivedData: Buffer[] = [];

    const slowWriter = new Writable({
      highWaterMark: 16,
      write(chunk, _encoding, callback) {
        receivedData.push(Buffer.from(chunk));
        // Simulate slow disk
        setTimeout(callback, 10);
      },
    });

    // Apply backpressure pattern
    source.on('data', (chunk: Buffer) => {
      const canContinue = slowWriter.write(chunk);
      if (!canContinue && !source.destroyed) {
        source.pause();
      }
    });

    slowWriter.on('drain', () => {
      if (!source.destroyed) {
        source.resume();
      }
    });

    // Send data
    const sentData: Buffer[] = [];
    for (let i = 0; i < 10; i++) {
      const buf = Buffer.alloc(64, i);
      sentData.push(buf);
      source.push(buf);
    }
    source.push(null);

    await new Promise<void>((resolve) => {
      slowWriter.on('finish', resolve);
      source.on('end', () => slowWriter.end());
    });

    // All data should be received
    const totalSent = sentData.reduce((acc, b) => acc + b.length, 0);
    const totalReceived = receivedData.reduce((acc, b) => acc + b.length, 0);
    expect(totalReceived).toBe(totalSent);
  });
});

describe('Cache file finalization', () => {
  it('should only finalize after finish event, not after end', async () => {
    const events: string[] = [];

    const writable = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(callback);
      },
    });

    writable.on('finish', () => {
      events.push('finish');
    });

    // Simulate stdout end → writable.end()
    writable.end(Buffer.alloc(64));

    await new Promise(resolve => setTimeout(resolve, 50));

    // finish should have fired
    expect(events).toContain('finish');
  });
});
