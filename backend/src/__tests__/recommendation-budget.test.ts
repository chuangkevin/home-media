import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const fixture = vi.hoisted(() => ({ channels: [] as any[], cache: new Map<string, any>(), fetch: vi.fn(), search: vi.fn(), axios: vi.fn() }));
vi.mock('../config/database', () => ({ db: { prepare: (sql: string) => ({
  all: () => [],
  get: (channel: string) => sql.includes('recommendations_cache') ? fixture.cache.get(channel) : undefined,
  run: () => ({ changes: 0 }),
}) } }));
vi.mock('../services/history.service', () => ({ default: { getWatchedChannels: () => fixture.channels } }));
vi.mock('../services/youtube.service', () => ({ default: { getChannelVideos: fixture.fetch, search: fixture.search } }));
vi.mock('../utils/logger', () => ({ default: { info() {}, warn() {}, error() {} } }));
vi.mock('../services/gemini.service', () => ({ generateDiscoveryQueries: vi.fn(async () => []) }));
vi.mock('../services/style-cache.service', () => ({ getUserProfile: vi.fn(async () => null) }));
vi.mock('axios', () => ({ default: { get: fixture.axios } }));

import { RecommendationService } from '../services/recommendation.service';
import recommendationService from '../services/recommendation.service';
import { RecommendationController } from '../controllers/recommendation.controller';
import { createRecommendationBudget, createRecommendationLimit, RecommendationUnavailableError, recommendationRequestBudget, waitWithinBudget } from '../services/recommendation-budget';

const track = { id: 'abc12345678', videoId: 'abc12345678', title: 'Fixture Song', channel: 'fixture', duration: 180, thumbnail: 'fixture', uploadedAt: '' };
function response() {
  const res: any = new EventEmitter();
  res.destroyed = false; res.writableEnded = false; res.statusCode = 200;
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; res.writableEnded = true; return res; };
  return res;
}
function request(query: any = {}) {
  const req: any = new EventEmitter(); req.query = query; return req;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(1000);
  fixture.channels = Array.from({ length: 100 }, (_, i) => ({ channelName: `fixture-${i}`, watchCount: 1, lastWatchedAt: 1, channelThumbnail: '' }));
  fixture.cache.clear(); fixture.fetch.mockReset(); fixture.search.mockReset(); fixture.axios.mockReset();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('overall recommendation budget', () => {
  it('bounds 100 failing seeds to one deadline including queue waits', async () => {
    const optionsSeen: any[] = [];
    fixture.fetch.mockImplementation((_name, _limit, options) => {
      optionsSeen.push(options);
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('upstream unavailable')), options.timeoutMs);
        options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
      });
    });
    const subject = new RecommendationService(10_000, 12_000);
    const result = subject.getChannelRecommendations(0, 5).catch(error => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await result).toBeInstanceOf(RecommendationUnavailableError);
    expect(fixture.fetch.mock.calls.length).toBeLessThanOrEqual(10);
    expect(optionsSeen.every(options => options.signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps valid cached sections even when uncached sources all time out', async () => {
    fixture.cache.set('fixture-95', { videosJson: JSON.stringify([track]) });
    fixture.fetch.mockImplementation((_name, _limit, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const result = new RecommendationService(10_000, 50).getChannelRecommendations(0, 5);
    await vi.advanceTimersByTimeAsync(50);
    const page = await result;
    expect(page.recommendations).toHaveLength(1);
    expect(page.recommendations[0].channelName).toBe('fixture-95');
    expect(page.recommendations[0].videos[0].title).toBe('Fixture Song');
    expect(page.partial).toBe(true);
    expect(page.hasMore).toBe(true);
    expect(fixture.fetch).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects invalid cache data and reports all failed sources', async () => {
    fixture.channels = fixture.channels.slice(0, 1);
    fixture.cache.set('fixture-0', { videosJson: JSON.stringify([{ ...track, videoId: 'invalid' }]) });
    fixture.fetch.mockRejectedValue(new Error('failed'));
    await expect(new RecommendationService().getChannelRecommendations()).rejects.toBeInstanceOf(RecommendationUnavailableError);
  });

  it.each(['180', null, 0, -1, 601])('rejects a cached non-numeric or out-of-policy duration: %s', async duration => {
    fixture.channels = fixture.channels.slice(0, 1);
    fixture.cache.set('fixture-0', { videosJson: JSON.stringify([{ ...track, duration }]) });
    fixture.fetch.mockRejectedValue(new Error('failed'));
    await expect(new RecommendationService().getChannelRecommendations()).rejects.toBeInstanceOf(RecommendationUnavailableError);
  });

  it('accepts only finite numeric music durations within the existing 600s boundary', () => {
    const subject = new RecommendationService() as any;
    const normalized = subject.normalizeChannelVideos(['180', NaN, Infinity, 0, -1, 601, 180, 600].map(duration => ({ ...track, duration })));
    expect(normalized.map((value: any) => value.duration)).toEqual([180, 600]);
  });

  it('returns a legitimate empty page when there is no seed history', async () => {
    fixture.channels = [];
    await expect(new RecommendationService().getChannelRecommendations()).resolves.toEqual({ recommendations: [], hasMore: false });
    expect(fixture.fetch).not.toHaveBeenCalled();
  });

  it('does not start queued cancelled work or release an active slot before its owner settles', async () => {
    const limit = createRecommendationLimit(1);
    let closed!: () => void;
    const firstController = new AbortController();
    const first = limit(() => new Promise<void>(resolve => { closed = resolve; }), firstController.signal);
    await Promise.resolve();
    const cancelled = new AbortController();
    const secondWork = vi.fn(async () => undefined);
    const second = limit(secondWork, cancelled.signal).catch(error => error);
    cancelled.abort(new Error('cancelled'));
    expect((await second).message).toBe('cancelled');
    firstController.abort();
    const thirdWork = vi.fn(async () => undefined);
    const third = limit(thirdWork, new AbortController().signal);
    await Promise.resolve(); expect(thirdWork).not.toHaveBeenCalled();
    closed(); await first; await third;
    expect(secondWork).not.toHaveBeenCalled(); expect(thirdWork).toHaveBeenCalledOnce();
  });

  it('cleans request listeners and deadline timers on completion and aborts on disconnect', () => {
    const req = request(), res = response();
    const budget = recommendationRequestBudget(req, res);
    res.emit('close'); expect(budget.signal.aborted).toBe(true);
    budget.dispose();
    expect(req.listenerCount('aborted')).toBe(0); expect(res.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait forever for an optional provider and handles late rejection', async () => {
    const budget = createRecommendationBudget(50);
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, r) => { reject = r; });
    const result = waitWithinBudget(pending, budget.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBeInstanceOf(RecommendationUnavailableError);
    reject(new Error('late provider failure')); await Promise.resolve();
    budget.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('mixed recommendation response integrity', () => {
  it('retains a valid style section when channel sources fail', async () => {
    vi.spyOn(recommendationService, 'getChannelRecommendations').mockRejectedValue(new RecommendationUnavailableError('failed'));
    fixture.axios.mockResolvedValue({ data: { recommendations: [track] } });
    // Supply recent tracks only for the controller's query.
    const { db } = await import('../config/database');
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => ({ all: () => sql.includes('LIMIT 5') ? [{ ...track, channelName: 'fixture' }] : [], get: () => undefined, run: () => ({ changes: 0 }) }) as any);
    const res = response();
    await new RecommendationController().getMixedRecommendations(request(), res);
    expect(res.statusCode).toBe(200); expect(res.body.partial).toBe(true);
    expect(res.body.recommendations).toHaveLength(1); expect(res.body.recommendations[0].type).toBe('similar');
  });

  it('does not cache or fake an empty success when every source fails', async () => {
    const controller = new RecommendationController();
    await controller.refreshRecommendations(request(), response());
    vi.spyOn(recommendationService, 'getChannelRecommendations').mockRejectedValue(new RecommendationUnavailableError('failed'));
    const res = response(); await controller.getMixedRecommendations(request(), res);
    expect(res.statusCode).toBe(503); expect(res.body.error).toBe('failed');
    expect(res.body.recommendations).toBeUndefined();
  });

  it.each(['similar rejection', 'similar partial fallback', 'discovery timeout'])('marks a valid-channel response partial and retries its cache after 15s for %s', async failure => {
    const controller = new RecommendationController();
    await controller.refreshRecommendations(request(), response());
    const call = vi.spyOn(recommendationService, 'getChannelRecommendations').mockResolvedValue({
      recommendations: [{ channelName: 'fixture', channelThumbnail: '', watchCount: 1, videos: [track] }], hasMore: true, partial: false,
    });
    const { db } = await import('../config/database');
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => ({ all: () => sql.includes('LIMIT 5') ? [{ ...track, channelName: 'fixture' }] : [], get: () => undefined, run: () => ({ changes: 0 }) }) as any);
    fixture.axios.mockResolvedValue({ data: { recommendations: [] } });
    fixture.search.mockResolvedValue([]);
    if (failure === 'similar rejection') fixture.axios.mockRejectedValue(new Error('similar upstream failed'));
    else if (failure === 'similar partial fallback') fixture.axios.mockResolvedValue({ data: { recommendations: [], partial: true } });
    else fixture.search.mockImplementation((_query, _limit, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const first = response();
    const pending = controller.getMixedRecommendations(request(), first);
    if (failure === 'discovery timeout') await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(first.statusCode).toBe(200); expect(first.body.recommendations).toHaveLength(1); expect(first.body.partial).toBe(true);
    await vi.advanceTimersByTimeAsync(14_999);
    const cached = response(); await controller.getMixedRecommendations(request(), cached);
    expect(cached.body.partial).toBe(true); expect(call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const refreshed = response(); const retry = controller.getMixedRecommendations(request(), refreshed);
    if (failure === 'discovery timeout') await vi.advanceTimersByTimeAsync(5000);
    await retry;
    expect(call).toHaveBeenCalledTimes(2); expect(refreshed.body.partial).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the existing 600s music policy when validating mixed style tracks', async () => {
    const controller = new RecommendationController(); await controller.refreshRecommendations(request(), response());
    vi.spyOn(recommendationService, 'getChannelRecommendations').mockResolvedValue({ recommendations: [], hasMore: false });
    const { db } = await import('../config/database');
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => ({ all: () => sql.includes('LIMIT 5') ? [{ ...track, channelName: 'fixture' }] : [], get: () => undefined, run: () => ({ changes: 0 }) }) as any);
    fixture.axios.mockResolvedValue({ data: { recommendations: [{ ...track, duration: 601 }, { ...track, duration: '180' }, track] } });
    fixture.search.mockResolvedValue([]);
    const res = response(); await controller.getMixedRecommendations(request(), res);
    expect(res.statusCode).toBe(200); expect(res.body.recommendations[0].videos).toHaveLength(1);
    expect(res.body.recommendations[0].videos[0].duration).toBe(180);
  });

  it('keys the first-page cache by requested page size and include count', async () => {
    const controller = new RecommendationController();
    await controller.refreshRecommendations(request(), response());
    const call = vi.spyOn(recommendationService, 'getChannelRecommendations').mockImplementation(async (_page, size) => ({
      recommendations: Array.from({ length: size || 5 }, (_, i) => ({ channelName: `fixture-${i}`, channelThumbnail: '', watchCount: 1, videos: [track] })), hasMore: true,
    }));
    const first = response(); await controller.getMixedRecommendations(request({ pageSize: '1', includeCount: '1' }), first);
    const second = response(); await controller.getMixedRecommendations(request({ pageSize: '5', includeCount: '3' }), second);
    const cached = response(); await controller.getMixedRecommendations(request({ pageSize: '1', includeCount: '1' }), cached);
    expect(call).toHaveBeenCalledTimes(2); expect(first.body.count).toBe(1); expect(second.body.count).toBe(5); expect(cached.body.count).toBe(1);
  });

  it('cancels recommendation work on client disconnect without writing an error response', async () => {
    const controller = new RecommendationController();
    await controller.refreshRecommendations(request(), response());
    const call = vi.spyOn(recommendationService, 'getChannelRecommendations').mockImplementation((_page, _size, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
    const req = request(), res = response();
    const pending = controller.getMixedRecommendations(req, res);
    res.destroyed = true; res.emit('close'); await pending;
    expect(call.mock.calls[0][2]!.signal!.aborted).toBe(true); expect(res.body).toBeUndefined();
    expect(req.listenerCount('aborted')).toBe(0); expect(res.listenerCount('close')).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects malformed pagination before upstream work', async () => {
    const call = vi.spyOn(recommendationService, 'getChannelRecommendations');
    const res = response(); await new RecommendationController().getMixedRecommendations(request({ page: 'oops' }), res);
    expect(res.statusCode).toBe(400); expect(call).not.toHaveBeenCalled();
  });
});
