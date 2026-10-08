import type { Request, Response } from 'express';

export const AUDIO_PROBE_REJOIN_GRACE_MS = 250;

/** One producer keeps its path until both child close and writer cleanup.
 * HTTP readers and an explicit preload claim keep it alive; incidental cache
 * writing alone does not own a cancelled playback indefinitely. */
export class AudioStreamOwner {
  readonly completion: Promise<void>;
  private resolveCompletion!: () => void;
  private consumers = new Map<symbol, { release: () => void; closed: () => boolean }>();
  private listeners = new Set<() => void>();
  private cacheClaim = false;
  private cacheSettled = false;
  private producerClosed = false;
  private completed = false;
  private retired = false;
  private idleSince: number | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private cancelProducer: () => void = () => {};

  constructor(private readonly graceMs = AUDIO_PROBE_REJOIN_GRACE_MS) {
    this.completion = new Promise(resolve => { this.resolveCompletion = resolve; });
  }
  get cancelling(): boolean { return this.retired; }
  get finished(): boolean { return this.completed; }

  setCancellation(cancel: () => void): void { this.cancelProducer = cancel; }

  acquireHTTP(req: Request, res: Response): (() => void) | null {
    if (this.completed || this.retired || req.aborted || res.destroyed || res.writableEnded) return null;
    const key = Symbol('audio consumer');
    const release = () => {
      if (!this.consumers.delete(key)) return;
      req.removeListener('aborted', release);
      res.removeListener('finish', release);
      res.removeListener('close', release);
      this.scheduleIdle();
    };
    this.consumers.set(key, { release, closed: () => req.aborted || res.destroyed });
    this.clearIdle();
    req.once('aborted', release);
    res.once('finish', release);
    res.once('close', release);
    return release;
  }

  retainCacheUntilCompletion(): boolean {
    if (this.completed || this.retired || this.cacheSettled) return false;
    this.cacheClaim = true;
    this.clearIdle();
    return true;
  }

  cacheCompleted(): void {
    this.cacheSettled = true;
    this.cacheClaim = false;
    this.scheduleIdle();
  }

  childClosed(): void {
    this.producerClosed = true;
    // A normal completed stream should finish its atomic cache publication.
    // Under capacity pressure an idle finalizer may still be cancelled safely.
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  isIdle(): boolean {
    this.consumers.forEach(consumer => { if (consumer.closed()) consumer.release(); });
    return !this.completed && !this.cacheClaim && this.consumers.size === 0;
  }

  idleDelayMs(): number {
    if (!this.isIdle() || this.retired) return 0;
    if (this.idleSince === null) this.idleSince = Date.now();
    return Math.max(0, this.graceMs - (Date.now() - this.idleSince));
  }

  reclaim(): boolean {
    if (this.retired || !this.isIdle() || this.idleDelayMs() > 0) return false;
    // Retire before cancellation can synchronously notify a waiting reader.
    this.retired = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.cancelProducer();
    return true;
  }

  onComplete(listener: () => void): () => void {
    if (this.completed) { void Promise.resolve().then(listener); return () => {}; }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.clearIdle();
    this.consumers.forEach(consumer => consumer.release());
    this.listeners.forEach(listener => listener());
    this.listeners.clear();
    this.resolveCompletion();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.idleSince = null;
  }

  private scheduleIdle(): void {
    if (this.completed || this.retired || this.cacheClaim || this.consumers.size > 0) return;
    if (this.idleSince === null) this.idleSince = Date.now();
    if (this.producerClosed || this.idleTimer) return;
    const timer = setTimeout(() => {
      if (this.idleTimer !== timer) return;
      this.idleTimer = undefined;
      // Timers can fire just before the wall-clock grace has elapsed. Keep
      // the same idle deadline and schedule its remaining delay in that case.
      if (!this.reclaim()) this.scheduleIdle();
    }, this.idleDelayMs());
    this.idleTimer = timer;
  }
}

/** A bounded, cancellable wait removes every subscription before settlement. */
export function waitForAudioOwners(
  req: Request, res: Response, owners: AudioStreamOwner[], timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const unsubscribe: Array<() => void> = [];
    let timer: NodeJS.Timeout;
    const finish = (alive: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe.forEach(remove => remove());
      req.removeListener('aborted', onAbort);
      res.removeListener('close', onAbort);
      resolve(alive);
    };
    const onAbort = () => finish(false);
    req.once('aborted', onAbort);
    res.once('close', onAbort);
    timer = setTimeout(() => finish(true), Math.max(1, timeoutMs));
    for (const owner of owners) unsubscribe.push(owner.onComplete(() => finish(true)));
    if (req.aborted || res.destroyed) onAbort();
  });
}

// Shared path fence: explicit precache jobs join a foreground owner instead of
// creating a second writer for the same final cache path.
export const audioStreamOwners = new Map<string, AudioStreamOwner>();

export function waitForAudioRetirement(
  req: Request, res: Response, completion: Promise<unknown>, timeoutMs: number,
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeListener('aborted', abort);
      res.removeListener('close', abort);
      resolve(completed);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    req.once('aborted', abort);
    res.once('close', abort);
    completion.then(() => finish(true), () => finish(false));
    if (req.aborted || res.destroyed) abort();
  });
}
