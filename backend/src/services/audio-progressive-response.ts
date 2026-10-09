import type { Request, Response } from 'express';
import type { AudioProgressiveSpool, AudioSpoolReader } from './audio-progressive-spool';

const MAX_READERS = 32;
const MAX_READERS_PER_SPOOL = 8;
let readerCount = 0;
const readersBySpool = new WeakMap<AudioProgressiveSpool, number>();

function reserve(spool: AudioProgressiveSpool): () => void {
  const count = readersBySpool.get(spool) ?? 0;
  if (readerCount >= MAX_READERS || count >= MAX_READERS_PER_SPOOL) throw new Error('Audio readers busy');
  readerCount++;
  readersBySpool.set(spool, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    readerCount--;
    readersBySpool.set(spool, (readersBySpool.get(spool) ?? 1) - 1);
  };
}

export function progressiveAudioReaderCount(): number { return readerCount; }

function aborted(): Error {
  const error = new Error('Audio reader cancelled');
  error.name = 'AbortError';
  return error;
}

function waitForChange(
  spool: AudioProgressiveSpool, minimumBytes: number, signal: AbortSignal, timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(aborted());
    const check = () => {
      const state = spool.snapshot();
      if (state.failed) finish(new Error('Audio producer failed'));
      else if (state.bytes >= minimumBytes || state.done) finish();
    };
    const timer = setTimeout(() => finish(new Error('Audio reader timed out')), Math.max(1, timeoutMs));
    unsubscribe = spool.subscribe(check);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort(); else check();
  });
}

function waitForDrain(res: Response, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.removeListener('drain', onDrain);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onDrain = () => finish();
    const onAbort = () => finish(aborted());
    const timer = setTimeout(() => finish(new Error('Audio client stalled')), Math.max(1, timeoutMs));
    res.once('drain', onDrain);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export function audioStreamMimeType(prefix: Buffer): string {
  if (prefix.length >= 8 && prefix.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  if (prefix.length >= 4 && prefix.readUInt32BE(0) === 0x1a45dfa3) return 'audio/webm';
  if (prefix.toString('ascii', 0, 3) === 'ID3' || (prefix[0] === 0xff && (prefix[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  return 'application/octet-stream';
}

/** A later request can read the one producer's progressive bytes immediately.
 * Unknown-length Range requests are honestly ignored with 200, never fake 206.
 * Only a published final cache uses the normal complete-file Range path. */
export async function streamProgressiveAudio(
  req: Request, res: Response, spool: AudioProgressiveSpool,
  options: { firstByteTimeoutMs?: number; lifetimeMs?: number; drainTimeoutMs?: number; beforeFirstWrite?: () => void } = {},
): Promise<void> {
  let releaseBudget = () => {};
  let reader: AudioSpoolReader | undefined;
  const cancel = new AbortController();
  const onClose = () => { if (!res.writableEnded) cancel.abort(); };
  const onAbort = () => cancel.abort();
  req.once('aborted', onAbort);
  res.once('close', onClose);
  const deadline = Date.now() + (options.lifetimeMs ?? 300000);
  const lifetime = setTimeout(onAbort, options.lifetimeMs ?? 300000);
  try {
    releaseBudget = reserve(spool);
    const acquisition = spool.acquire();
    const stop = new Promise<never>((_resolve, reject) => {
      if (cancel.signal.aborted) reject(aborted());
      else cancel.signal.addEventListener('abort', () => reject(aborted()), { once: true });
    });
    try { reader = await Promise.race([acquisition, stop]); }
    catch (error) { void acquisition.then(late => late.release(), () => {}); throw error; }
    await waitForChange(spool, 8, cancel.signal, Math.min(options.firstByteTimeoutMs ?? 20000, deadline - Date.now()));
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (!cancel.signal.aborted) {
      const state = spool.snapshot();
      if (state.failed) throw new Error('Audio producer failed');
      if (position < state.bytes) {
        const length = Math.min(buffer.length, state.bytes - position);
        const count = await reader.read(buffer, length, position);
        if (cancel.signal.aborted) throw aborted();
        if (count === 0) throw new Error('Audio spool ended unexpectedly');
        // ServerResponse may retain an accepted buffer until the socket flushes.
        // Never overwrite a view that is still owned by the HTTP writer.
        const chunk = Buffer.from(buffer.subarray(0, count));
        if (!res.headersSent) {
          options.beforeFirstWrite?.();
          res.status(200);
          res.setHeader('Content-Type', audioStreamMimeType(chunk));
          res.setHeader('Transfer-Encoding', 'chunked');
          res.setHeader('Accept-Ranges', 'none');
          res.setHeader('Cache-Control', 'no-store');
        }
        position += count;
        if (!res.write(chunk)) await waitForDrain(res, cancel.signal, Math.min(options.drainTimeoutMs ?? 30000, deadline - Date.now()));
      } else if (state.done) {
        if (position === 0) throw new Error('Audio producer returned no data');
        res.end();
        break;
      } else {
        await waitForChange(spool, position + 1, cancel.signal, deadline - Date.now());
      }
    }
  } catch (error) {
    if (!res.destroyed && !res.writableEnded) {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Audio stream temporarily unavailable', retryable: true });
      } else {
        res.destroy(error instanceof Error ? error : new Error('Audio stream failed'));
      }
    }
  } finally {
    clearTimeout(lifetime);
    cancel.abort();
    req.removeListener('aborted', onAbort);
    res.removeListener('close', onClose);
    reader?.release();
    releaseBudget();
  }
}
