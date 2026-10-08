import assert from "node:assert/strict";
import test from "node:test";
import audioCacheService from "../../src/services/audio-cache.service";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
type Request = { signal: AbortSignal; resolve: (response: Response) => void };
function transport(t: any) {
  const requests: Request[] = [];
  const cacheWrites: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    (_url: unknown, options: RequestInit) =>
      new Promise<Response>((resolve) => {
        // Deliberately ignore abort so late completions exercise service ownership.
        requests.push({ signal: options.signal as AbortSignal, resolve });
      }),
  );
  t.mock.method(audioCacheService, "set", async (videoId: string) => {
    cacheWrites.push(videoId);
    return true;
  });
  return { requests, cacheWrites };
}

test("cancelled playback download cannot delete or abort a newer same-video retry", async (t) => {
  const { requests, cacheWrites } = transport(t);
  const firstOwner = new AbortController();
  const first = audioCacheService.fetchAndCache(
    "retry-same",
    "/audio",
    undefined,
    { signal: firstOwner.signal },
  );
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  await flush();
  firstOwner.abort();
  assert.equal(requests[0].signal.aborted, true);

  const secondOwner = new AbortController();
  const second = audioCacheService.fetchAndCache(
    "retry-same",
    "/audio",
    undefined,
    { signal: secondOwner.signal },
  );
  await flush();
  requests[0].resolve(new Response("old bytes"));
  await firstRejected;
  const borrowed = audioCacheService.fetchAndCache("retry-same", "/audio");
  await flush();
  assert.equal(
    requests.length,
    2,
    "old finally must not erase the new deduplication entry",
  );
  assert.equal(requests[1].signal.aborted, false);
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  const borrowedRejected = assert.rejects(borrowed, { name: "AbortError" });
  secondOwner.abort();
  assert.equal(
    requests[1].signal.aborted,
    true,
    "new cancellation handle survives old completion",
  );
  requests[1].resolve(new Response("new but cancelled bytes"));
  await Promise.all([secondRejected, borrowedRejected]);
  assert.deepEqual(cacheWrites, []);
});

test("borrowing an existing same-video download does not grant cancellation ownership", async (t) => {
  const { requests, cacheWrites } = transport(t);
  const owned = audioCacheService.fetchAndCache("borrowed", "/audio");
  await flush();
  const borrower = new AbortController();
  const borrowed = audioCacheService.fetchAndCache(
    "borrowed",
    "/audio",
    undefined,
    { signal: borrower.signal },
  );
  borrower.abort();
  assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve(new Response("valid audio"));
  assert.deepEqual(await Promise.all([owned, borrowed]), ["/audio", "/audio"]);
  assert.deepEqual(cacheWrites, ["borrowed"]);
});

test("aborting a completed owner cannot abort a later download for the same video", async (t) => {
  const { requests } = transport(t);
  const oldOwner = new AbortController();
  const old = audioCacheService.fetchAndCache(
    "completed-owner",
    "/audio",
    undefined,
    { signal: oldOwner.signal },
  );
  await flush();
  requests[0].resolve(new Response("first audio"));
  await old;
  const newer = audioCacheService.fetchAndCache("completed-owner", "/audio");
  await flush();
  oldOwner.abort();
  assert.equal(requests[1].signal.aborted, false);
  requests[1].resolve(new Response("second audio"));
  await newer;
});

test("a pre-aborted owner never starts a network download", async (t) => {
  const { requests } = transport(t);
  const owner = new AbortController();
  owner.abort();
  await assert.rejects(
    audioCacheService.fetchAndCache("pre-aborted", "/audio", undefined, {
      signal: owner.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(requests.length, 0);
});

test("a cancelled low-priority waiter releases its slot without making a request", async (t) => {
  const { requests } = transport(t);
  const first = audioCacheService.fetchAndCache(
    "slot-holder",
    "/audio",
    undefined,
    { priority: "low" },
  );
  await flush();
  const waitingOwner = new AbortController();
  const waiting = audioCacheService.fetchAndCache(
    "slot-cancelled",
    "/audio",
    undefined,
    { priority: "low", signal: waitingOwner.signal },
  );
  const rejected = assert.rejects(waiting, { name: "AbortError" });
  await flush();
  waitingOwner.abort();
  requests[0].resolve(new Response("first audio"));
  await first;
  await rejected;
  assert.equal(requests.length, 1);
});
