import { ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';

/** One producer owns one temporary file. Only a complete, successful producer
 * may publish it; cancellation can never touch another producer's file. */
export function createAudioCacheWriter(
  proc: ChildProcessWithoutNullStreams,
  cachePath: string,
  remux: (filePath: string, signal: AbortSignal) => Promise<void>,
  options: { keepStreamingOnError?: boolean; onProgress?: (bytes: number) => void } = {},
): { completion: Promise<string | null>; cancel: () => void } {
  const tempPath = `${cachePath}.${randomUUID()}.tmp`;
  const writer = fs.createWriteStream(tempPath, { flags: 'wx' });
  const abort = new AbortController();
  let failed = false;
  let bytes = 0;
  let processClosed = false;
  let writerFinished = false;
  let killTimer: NodeJS.Timeout | undefined;
  let deadline: NodeJS.Timeout;
  let ready: () => void;
  let rejectReady: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => { ready = resolve; rejectReady = reject; });
  const writerClosed = new Promise<void>(resolve => writer.once('close', resolve));
  const checkReady = () => {
    if (processClosed && writerFinished && !failed) ready();
  };
  const stopProcess = () => {
    if (processClosed) return;
    proc.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (!processClosed) proc.kill('SIGKILL');
    }, 2000);
    killTimer.unref();
  };
  const fail = (error: Error, forceStop = false) => {
    if (failed) return;
    failed = true;
    abort.abort();
    writer.destroy();
    // A failed optional disk cache must not leave live playback paused forever.
    proc.stdout.resume();
    if (forceStop || !options.keepStreamingOnError) stopProcess();
    rejectReady(error);
  };
  writer.on('error', error => fail(error));
  writer.on('drain', () => { if (!failed) proc.stdout.resume(); });
  writer.on('finish', () => { writerFinished = true; checkReady(); });
  proc.stdout.on('data', (chunk: Buffer) => {
    if (failed) return;
    bytes += chunk.length;
    if (!writer.write(chunk)) proc.stdout.pause();
    options.onProgress?.(bytes);
  });
  proc.stdout.on('end', () => { if (!failed) writer.end(); });
  proc.stdout.on('error', error => fail(error, true));
  proc.on('error', error => fail(error));
  proc.on('close', code => {
    processClosed = true;
    if (killTimer) clearTimeout(killTimer);
    if (code !== 0 || bytes === 0) fail(new Error('Audio producer failed or returned no data'));
    else checkReady();
  });
  // Also bounds silent/hung producers. Keep this deadline after a cache-only
  // write failure because live streaming may still be running.
  deadline = setTimeout(() => {
    if (!failed) fail(new Error('Audio producer timed out'), true);
    else stopProcess();
  }, 300000);
  deadline.unref();
  proc.once('close', () => clearTimeout(deadline));

  const completion = (async () => {
    try {
      await gate;
      await writerClosed;
      if (failed || fs.statSync(tempPath).size === 0) return null;
      await remux(tempPath, abort.signal);
      if (failed) return null;
      // Atomic replacement: never unlink an existing playable cache first.
      fs.renameSync(tempPath, cachePath);
      return cachePath;
    } catch {
      fail(new Error('Audio cache finalization failed'));
      return null;
    } finally {
      await writerClosed;
      try { fs.unlinkSync(tempPath); } catch {}
    }
  })();
  return { completion, cancel: () => fail(new Error('Audio cache cancelled'), true) };
}
