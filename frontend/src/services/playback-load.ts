/** One selection owns its asynchronous work, including A -> B -> A retries. */
export function createPlaybackLoadAttempt(isLatest: () => boolean) {
  const controller = new AbortController();
  let confirmed = false;
  let disposed = false;
  return {
    controller,
    get confirmed() {
      return confirmed;
    },
    isCurrent: () => isLatest() && (!disposed || confirmed),
    confirm: () => {
      confirmed = true;
    },
    dispose: () => {
      disposed = true;
      controller.abort();
    },
  };
}

/** Optional storage/configuration must never hold the audio loading path open. */
export function readOptionalCache<T>(
  read: () => Promise<T | null>,
  signal: AbortSignal,
  options: { timeoutMs?: number; bypass?: boolean } = {},
): Promise<T | null> {
  if (options.bypass) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), options.timeoutMs ?? 1500);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      finish(null);
      return;
    }
    Promise.resolve()
      .then(read)
      .then(finish, () => finish(null));
  });
}

export async function fetchOptionalCacheSettings(
  timeoutMs = 2000,
): Promise<Record<string, number> | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch("/api/settings", { signal: controller.signal }).then(
        async (response) => (response.ok ? await response.json() : null),
      ),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface AudioLoadDiagnostic {
  reason: "media-error" | "timeout";
  elapsedMs: number;
  readyState: number;
  networkState: number | null;
  paused: boolean | null;
  mediaErrorCode: number | null;
  bufferedRanges: number;
  sourceAssigned: boolean;
}

export class AudioLoadError extends Error {
  constructor(
    message: string,
    readonly diagnostic: AudioLoadDiagnostic,
  ) {
    super(message);
    this.name = "AudioLoadError";
  }
}

/** Attach before assigning src/load(). Each attempt owns and removes its listeners. */
export function waitForAudioReady(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  options: {
    timeoutMs?: number;
    reuseExistingSource?: boolean;
    now?: () => number;
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const loadError = (reason: AudioLoadDiagnostic["reason"]) =>
    new AudioLoadError(
      reason === "timeout"
        ? "音訊載入逾時，請再試一次。"
        : "音訊載入失敗，請檢查連線後重試。",
      {
        reason,
        elapsedMs: Math.max(0, now() - startedAt),
        readyState: audio.readyState,
        networkState: Number.isFinite(audio.networkState)
          ? audio.networkState
          : null,
        paused: typeof audio.paused === "boolean" ? audio.paused : null,
        mediaErrorCode: audio.error?.code ?? null,
        bufferedRanges: audio.buffered?.length ?? 0,
        sourceAssigned: Boolean(
          audio.currentSrc || audio.getAttribute?.("src"),
        ),
      },
    );
  return new Promise((resolve, reject) => {
    let settled = false;
    const readyEvents = ["canplay", "canplaythrough", "loadeddata"];
    const cleanup = () => {
      clearTimeout(timer);
      readyEvents.forEach((event) => audio.removeEventListener(event, onReady));
      audio.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => {
      if (audio.readyState >= 2) finish();
    };
    const onError = () => finish(loadError("media-error"));
    const onAbort = () => {
      const error = new Error("Playback request cancelled");
      error.name = "AbortError";
      finish(error);
    };
    const timer = setTimeout(() => {
      if (audio.readyState >= 2) finish();
      else finish(loadError("timeout"));
    }, options.timeoutMs ?? 30000);
    readyEvents.forEach((event) => audio.addEventListener(event, onReady));
    audio.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    // Do not inspect readyState here: it can still describe the previous source.
    else if (options.reuseExistingSource) onReady();
  });
}
