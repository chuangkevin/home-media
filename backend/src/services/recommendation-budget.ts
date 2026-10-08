import { Request, Response } from 'express';

export const RECOMMENDATION_BUDGET_MS = 12_000;

export class RecommendationUnavailableError extends Error {
  readonly statusCode = 503;
}

export interface RecommendationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RecommendationBudget {
  signal: AbortSignal;
  remainingMs(): number;
  check(): void;
  abort(reason?: Error): void;
  dispose(): void;
}

/** One deadline includes queueing, upstream work and all fallback attempts. */
export function createRecommendationBudget(timeoutMs = RECOMMENDATION_BUDGET_MS, parent?: AbortSignal): RecommendationBudget {
  const controller = new AbortController();
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const cancel = () => controller.abort(parent?.reason ?? new Error('Recommendation request cancelled'));
  const timer = setTimeout(() => controller.abort(
    new RecommendationUnavailableError('Recommendation deadline exceeded; please retry')
  ), Math.max(0, timeoutMs));
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  return {
    signal: controller.signal,
    remainingMs: () => Math.max(0, deadline - Date.now()),
    check() {
      if (Date.now() >= deadline && !controller.signal.aborted) controller.abort(
        new RecommendationUnavailableError('Recommendation deadline exceeded; please retry')
      );
      if (controller.signal.aborted) throw controller.signal.reason;
    },
    abort: (reason?: Error) => controller.abort(reason),
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
    },
  };
}

export function recommendationRequestBudget(req: Request, res: Response, timeoutMs = RECOMMENDATION_BUDGET_MS): RecommendationBudget {
  const budget = createRecommendationBudget(timeoutMs);
  const cancel = () => { if (!res.writableEnded) budget.abort(new Error('Recommendation client disconnected')); };
  req.once('aborted', cancel);
  res.once('close', cancel);
  return {
    ...budget,
    dispose() {
      // Stop optional work as soon as the response owner is finished.
      budget.abort(new Error('Recommendation request finished'));
      budget.dispose();
      req.removeListener('aborted', cancel);
      res.removeListener('close', cancel);
    },
  };
}

export function waitWithinBudget<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

/** Cancel queued work immediately, but keep active capacity until work settles. */
export function createRecommendationLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const drain = () => {
    while (active < concurrency && queue.length > 0) queue.shift()!();
  };
  return <T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
    const cancel = () => {
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      signal.removeEventListener('abort', cancel);
      reject(signal.reason);
    };
    const start = () => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) { reject(signal.reason); return; }
      active++;
      // Never race active children against cancellation here: their owners wait
      // for OS close before this promise settles and releases the semaphore.
      Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; drain(); });
    };
    if (signal.aborted) { reject(signal.reason); return; }
    signal.addEventListener('abort', cancel, { once: true });
    queue.push(start);
    drain();
  });
}

export const recommendationFetchLimit = createRecommendationLimit(5);
