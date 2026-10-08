import type { Request, Response } from 'express';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { audioStreamMimeType } from './audio-progressive-response';

/** The first client reads online bytes independently of the optional disk cache.
 * Never pause the shared producer for a slow HTTP client: retain at most 256KiB
 * locally plus one 64KiB HTTP write, then disconnect only that stalled reader. */
export function streamLiveAudio(
  req: Request, res: Response, proc: ChildProcessWithoutNullStreams,
  options: { maxQueuedBytes?: number; drainTimeoutMs?: number; firstByteTimeoutMs?: number } = {},
): void {
  const maxQueuedBytes = options.maxQueuedBytes ?? 256 * 1024;
  const queue: Buffer[] = [];
  let queuedBytes = 0;
  let blocked = false;
  let ended = false;
  let closedSuccessfully = false;
  let hasData = false;
  let disposed = false;
  let drainTimer: NodeJS.Timeout | undefined;
  let firstByteTimer: NodeJS.Timeout | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (drainTimer) clearTimeout(drainTimer);
    if (firstByteTimer) clearTimeout(firstByteTimer);
    queue.length = 0;
    queuedBytes = 0;
    req.removeListener('aborted', onAbort);
    res.removeListener('close', dispose);
    res.removeListener('drain', onDrain);
    proc.stdout.removeListener('data', onData);
    proc.stdout.removeListener('end', onEnd);
    proc.stdout.removeListener('error', onError);
    proc.removeListener('error', onError);
    proc.removeListener('close', onClose);
  };
  const fail = (error: Error) => {
    if (disposed) return;
    dispose();
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) res.destroy(error);
    else res.status(503).json({ error: 'Audio stream temporarily unavailable', retryable: true });
  };
  const flush = () => {
    if (disposed || blocked) return;
    while (queue.length && !blocked) {
      const chunk = queue.shift()!;
      queuedBytes -= chunk.length;
      if (!res.headersSent) {
        res.status(200);
        res.setHeader('Content-Type', audioStreamMimeType(chunk));
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Accept-Ranges', 'none');
        res.setHeader('Cache-Control', 'no-store');
      }
      if (!res.write(chunk)) {
        blocked = true;
        drainTimer = setTimeout(() => fail(new Error('Audio client stalled')), options.drainTimeoutMs ?? 30000);
        drainTimer.unref();
      }
    }
    // stdout EOF alone says nothing about extraction success. A truncated body
    // must never receive a clean HTTP EOF before the process exit is known.
    if (!blocked && !queue.length && ended && closedSuccessfully) {
      dispose();
      res.end();
    }
  };
  const onDrain = () => {
    if (drainTimer) clearTimeout(drainTimer);
    blocked = false;
    flush();
  };
  const onData = (chunk: Buffer) => {
    if (chunk.length === 0) return;
    if (firstByteTimer) clearTimeout(firstByteTimer);
    hasData = true;
    for (let offset = 0; offset < chunk.length && !disposed; offset += 64 * 1024) {
      const size = Math.min(64 * 1024, chunk.length - offset);
      if (queuedBytes + size > maxQueuedBytes) {
        fail(new Error('Audio client exceeded its streaming buffer budget'));
        return;
      }
      queue.push(Buffer.from(chunk.subarray(offset, offset + size)));
      queuedBytes += size;
      flush();
    }
  };
  const onEnd = () => { ended = true; flush(); };
  const onError = (error: Error) => fail(error);
  const onClose = (code: number | null) => {
    if (code !== 0 || !hasData) fail(new Error('Audio producer failed or returned no data'));
    else { closedSuccessfully = true; flush(); }
  };
  const onAbort = () => fail(new Error('Audio reader cancelled'));
  req.once('aborted', onAbort);
  res.once('close', dispose);
  res.on('drain', onDrain);
  proc.stdout.on('data', onData);
  proc.stdout.once('end', onEnd);
  proc.stdout.once('error', onError);
  proc.once('error', onError);
  proc.once('close', onClose);
  firstByteTimer = setTimeout(() => fail(new Error('Audio first byte timed out')), options.firstByteTimeoutMs ?? 20000);
  firstByteTimer.unref();
}
