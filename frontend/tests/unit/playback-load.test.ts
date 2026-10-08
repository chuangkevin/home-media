import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioLoadError,
  createPlaybackLoadAttempt,
  fetchOptionalCacheSettings,
  readOptionalCache,
  waitForAudioReady,
} from "../../src/services/playback-load";

test("timeout diagnostics preserve sanitized media state before source cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const audio = new FakeAudio();
  Object.assign(audio, {
    networkState: 2,
    paused: true,
    error: null,
    currentSrc: "https://example.invalid/audio?credential=do-not-log",
    buffered: { length: 0 },
  });
  audio.readyState = 1;
  let now = 100;
  const ready = waitForAudioReady(
    audio.asElement(),
    new AbortController().signal,
    { now: () => now },
  );
  const rejected = assert.rejects(ready, (error: unknown) => {
    assert.ok(error instanceof AudioLoadError);
    assert.deepEqual(error.diagnostic, {
      reason: "timeout",
      elapsedMs: 30000,
      readyState: 1,
      networkState: 2,
      paused: true,
      mediaErrorCode: null,
      bufferedRanges: 0,
      sourceAssigned: true,
    });
    assert.equal(
      JSON.stringify(error.diagnostic).includes("credential"),
      false,
    );
    assert.equal(JSON.stringify(error.diagnostic).includes("https:"), false);
    return true;
  });
  now += 30000;
  t.mock.timers.tick(30000);
  audio.readyState = 0;
  await rejected;
});

test("media error diagnostics include only numeric code, not browser error message or URL", async () => {
  const audio = new FakeAudio();
  Object.assign(audio, {
    networkState: 3,
    paused: true,
    buffered: { length: 1 },
    error: { code: 3, message: "https://example.invalid/private-token" },
  });
  const ready = waitForAudioReady(
    audio.asElement(),
    new AbortController().signal,
    { now: () => 7 },
  );
  const rejected = assert.rejects(ready, (error: unknown) => {
    assert.ok(error instanceof AudioLoadError);
    assert.equal(error.diagnostic.reason, "media-error");
    assert.equal(error.diagnostic.mediaErrorCode, 3);
    assert.equal(error.diagnostic.elapsedMs, 0);
    assert.equal(JSON.stringify(error).includes("private-token"), false);
    return true;
  });
  audio.dispatchEvent(new Event("error"));
  await rejected;
});

class FakeAudio extends EventTarget {
  readyState = 0;
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
  ) {
    if (callback) {
      const entries = this.listeners.get(type) || new Set();
      entries.add(callback);
      this.listeners.set(type, entries);
    }
    super.addEventListener(type, callback);
  }
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
  ) {
    if (callback) this.listeners.get(type)?.delete(callback);
    super.removeEventListener(type, callback);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce(
      (sum, entries) => sum + entries.size,
      0,
    );
  }
  asElement() {
    return this as unknown as HTMLAudioElement;
  }
}

test("first selection fails on media error before any current track exists", async () => {
  const audio = new FakeAudio();
  const controller = new AbortController();
  const ready = waitForAudioReady(audio.asElement(), controller.signal);
  const rejected = assert.rejects(ready, /音訊載入失敗/);
  audio.dispatchEvent(new Event("error"));
  await rejected;
  assert.equal(audio.listenerCount, 0);
});

test("no metadata or media events reaches a terminal deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const audio = new FakeAudio();
  const ready = waitForAudioReady(
    audio.asElement(),
    new AbortController().signal,
  );
  const rejected = assert.rejects(ready, /逾時/);
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(audio.listenerCount, 0);
  t.mock.timers.tick(120000);
  assert.equal(
    audio.listenerCount,
    0,
    "there is no abandoned reload/retry timer",
  );
});

test("metadata alone does not clear loading and still times out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const audio = new FakeAudio();
  const ready = waitForAudioReady(
    audio.asElement(),
    new AbortController().signal,
  );
  const rejected = assert.rejects(ready, /逾時/);
  audio.readyState = 1;
  audio.dispatchEvent(new Event("loadedmetadata"));
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(audio.listenerCount, 0);
});

test("readiness settles exactly once and clears errors, listeners and timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const audio = new FakeAudio();
  const ready = waitForAudioReady(
    audio.asElement(),
    new AbortController().signal,
  );
  audio.readyState = 2;
  audio.dispatchEvent(new Event("loadeddata"));
  await ready;
  assert.equal(audio.listenerCount, 0);
  audio.dispatchEvent(new Event("error"));
  t.mock.timers.tick(60000);
  assert.equal(audio.listenerCount, 0);
});

test("old source readyState cannot confirm a newly assigned source", async () => {
  const audio = new FakeAudio();
  audio.readyState = 4;
  const controller = new AbortController();
  const ready = waitForAudioReady(audio.asElement(), controller.signal);
  let settled = false;
  void ready.then(
    () => {
      settled = true;
    },
    () => {},
  );
  await Promise.resolve();
  assert.equal(settled, false);
  const rejected = assert.rejects(ready, { name: "AbortError" });
  controller.abort();
  await rejected;
  assert.equal(audio.listenerCount, 0);
});

test("an explicitly inherited ready iOS session does not reload or wait for another event", async () => {
  const audio = new FakeAudio();
  audio.readyState = 2;
  await waitForAudioReady(audio.asElement(), new AbortController().signal, {
    reuseExistingSource: true,
  });
  assert.equal(audio.listenerCount, 0);
});

test("cancelled A cannot receive B readiness; retrying the same video creates fresh listeners", async () => {
  const audio = new FakeAudio();
  const first = new AbortController();
  const firstReady = waitForAudioReady(audio.asElement(), first.signal);
  const rejected = assert.rejects(firstReady, { name: "AbortError" });
  first.abort();
  await rejected;
  assert.equal(audio.listenerCount, 0);
  const retry = waitForAudioReady(
    audio.asElement(),
    new AbortController().signal,
  );
  audio.readyState = 2;
  audio.dispatchEvent(new Event("canplay"));
  await retry;
  assert.equal(audio.listenerCount, 0);
});

test("request generations reject old A after A -> B -> A, while a confirmed request survives pending cleanup", () => {
  let generation = 1;
  const a1 = createPlaybackLoadAttempt(() => generation === 1);
  a1.confirm();
  a1.dispose(); // confirmPendingTrack clears pendingTrack and runs effect cleanup.
  assert.equal(a1.isCurrent(), true);
  generation = 2;
  const b = createPlaybackLoadAttempt(() => generation === 2);
  assert.equal(a1.isCurrent(), false);
  b.dispose();
  assert.equal(b.isCurrent(), false);
  generation = 3;
  const a2 = createPlaybackLoadAttempt(() => generation === 3);
  assert.equal(a1.isCurrent(), false);
  assert.equal(b.isCurrent(), false);
  assert.equal(a2.isCurrent(), true);
  generation += 1; // component unmount invalidates even committed background work.
  assert.equal(a2.isCurrent(), false);
});

test("late cache-status recovery cannot mutate a new generation of the same song", async () => {
  let generation = 1;
  const old = createPlaybackLoadAttempt(() => generation === 1);
  let finish!: () => void;
  const status = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let sourceWrites = 0;
  const recovery = status.then(() => {
    if (old.isCurrent()) sourceWrites += 1;
  });
  generation = 3; // A -> B -> A: video ID alone would match again.
  finish();
  await recovery;
  assert.equal(sourceWrites, 0);
});

test("IndexedDB read rejection and synchronous exception are optional cache misses", async () => {
  const signal = new AbortController().signal;
  assert.equal(
    await readOptionalCache(
      () => Promise.reject(new Error("IDB unavailable")),
      signal,
    ),
    null,
  );
  assert.equal(
    await readOptionalCache(() => {
      throw new Error("IDB disabled");
    }, signal),
    null,
  );
});

test("explicit retry bypasses a previously failed cached blob without deleting it", async () => {
  let reads = 0;
  const result = await readOptionalCache(
    async () => {
      reads += 1;
      return "corrupt blob";
    },
    new AbortController().signal,
    { bypass: true },
  );
  assert.equal(result, null);
  assert.equal(reads, 0);
});

test("a blocked cache read falls back after 1.5 seconds and ignores late completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: string) => void;
  const stored = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const result = readOptionalCache(() => stored, new AbortController().signal);
  await Promise.resolve();
  t.mock.timers.tick(1500);
  assert.equal(await result, null);
  finish("late A cache");
  assert.equal(await result, null);
});

test("cache hits work normally and cancelling a blocked read completes immediately", async () => {
  const controller = new AbortController();
  assert.equal(
    await readOptionalCache(() => Promise.resolve("blob"), controller.signal),
    "blob",
  );
  const blocked = readOptionalCache(
    () => new Promise(() => {}),
    controller.signal,
  );
  controller.abort();
  assert.equal(await blocked, null);
});

test("settings request is bounded and aborts even if fetch ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", (_url: unknown, options: RequestInit) => {
    signal = options.signal as AbortSignal;
    return new Promise(() => {});
  });
  const settings = fetchOptionalCacheSettings();
  t.mock.timers.tick(2000);
  assert.equal(await settings, null);
  assert.equal(signal?.aborted, true);
});

test("settings HTTP/network failures keep defaults; successful settings are returned", async (t) => {
  const request = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("", { status: 503 }),
  );
  assert.equal(await fetchOptionalCacheSettings(), null);
  request.mock.mockImplementation(async () => {
    throw new Error("offline");
  });
  assert.equal(await fetchOptionalCacheSettings(), null);
  request.mock.mockImplementation(
    async () => new Response(JSON.stringify({ audio_cache_ttl_days: 12 })),
  );
  assert.deepEqual(await fetchOptionalCacheSettings(), {
    audio_cache_ttl_days: 12,
  });
});

test("actual AudioCacheService opens IndexedDB and serves a blob while settings never respond", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const blob = new Blob(["audio"]);
  const db = {
    version: 1,
    objectStoreNames: { contains: () => true },
    transaction: () => ({
      objectStore: () => ({
        get: () => {
          const request: any = {
            result: { blob, timestamp: Date.now(), size: blob.size },
          };
          queueMicrotask(() => request.onsuccess());
          return request;
        },
      }),
    }),
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        const request: any = { result: db };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
  const { default: audioCacheService } =
    await import("../../src/services/audio-cache.service");
  assert.equal(await audioCacheService.get("cached-song"), blob);
  t.mock.timers.tick(2000); // settle the optional configuration request too.
});
