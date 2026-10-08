import { ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import { AudioProgressiveSpool } from './audio-progressive-spool';

/** One producer owns one temporary file. Only a complete, successful producer
 * may publish it; cancellation can never touch another producer's file. */
export function createAudioCacheWriter(
  proc: ChildProcessWithoutNullStreams,
  cachePath: string,
  remux: (filePath: string, signal: AbortSignal) => Promise<void>,
  options: { keepStreamingOnError?: boolean; onProgress?: (bytes: number) => void; maxBytes?: number } = {},
): { completion: Promise<string | null>; cancel: () => void; spool: AudioProgressiveSpool } {
  const tempPath = `${cachePath}.${randomUUID()}.tmp`;
  const writer = fs.createWriteStream(tempPath, { flags: 'wx' });
  const spool = new AudioProgressiveSpool(writer, tempPath);
  const abort = new AbortController();
  let failed = false;
  let bytes = 0;
  let flushedBytes = 0;
  let spoolFailed = false;
  let processClosed = false;
  let writerFinished = false;
  const notifySpool = () => spool.update({
    bytes: flushedBytes, done: processClosed && writerFinished, failed: spoolFailed,
  });
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
  const fail = (error: Error, forceStop = false, failedLiveBytes = true) => {
    if (failed) return;
    failed = true;
    spoolFailed = failedLiveBytes;
    notifySpool();
    abort.abort();
    writer.destroy();
    // A failed optional disk cache must not leave live playback paused forever.
    proc.stdout.resume();
    if (forceStop || !options.keepStreamingOnError) stopProcess();
    rejectReady(error);
  };
  writer.on('error', error => fail(error));
  writer.on('drain', () => { if (!failed) proc.stdout.resume(); });
  writer.on('finish', () => { writerFinished = true; notifySpool(); checkReady(); });
  proc.stdout.on('data', (chunk: Buffer) => {
    if (failed) return;
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? 128 * 1024 * 1024)) {
      fail(new Error('Audio producer exceeded its body budget'), true);
      return;
    }
    if (!writer.write(chunk, error => {
      if (error || spoolFailed) return;
      flushedBytes += chunk.length;
      notifySpool();
    })) proc.stdout.pause();
    options.onProgress?.(bytes);
  });
  proc.stdout.on('end', () => { if (!failed) writer.end(); });
  proc.stdout.on('error', error => fail(error, true));
  proc.on('error', error => fail(error));
  proc.on('close', code => {
    processClosed = true;
    if (killTimer) clearTimeout(killTimer);
    if (code !== 0 || bytes === 0) fail(new Error('Audio producer failed or returned no data'));
    else { notifySpool(); checkReady(); }
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
      fail(new Error('Audio cache finalization failed'), false, false);
      return null;
    } finally {
      await writerClosed;
      spool.finish();
      try { fs.unlinkSync(tempPath); } catch {}
    }
  })();
  return { completion, cancel: () => fail(new Error('Audio cache cancelled'), true), spool };
}
