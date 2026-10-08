import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const fixture = vi.hoisted(() => ({ handlers: new Map<string, any>(), fallback: [] as any[], extract: vi.fn(), search: vi.fn(), ai: vi.fn() }));
vi.mock('express', () => ({ Router: () => ({ get: (path: string, fn: any) => { fixture.handlers.set(path, fn); } }) }));
vi.mock('../config/database', () => ({ getDatabase: () => ({ prepare: () => ({ get: () => undefined, all: () => fixture.fallback }) }) }));
vi.mock('../services/youtube.service', () => ({ default: { search: fixture.search } }));
vi.mock('../services/gemini.service', () => ({ extractTrackInfo: fixture.extract, getApiKey: () => null }));
vi.mock('../services/style-cache.service', () => ({ getUserProfile: async () => null }));
vi.mock('../utils/logger', () => ({ default: { error() {}, warn() {}, info() {} } }));
vi.mock('../ai/provider', () => ({ buildOpenCodeAdapters: () => [{ adapter: { generateContent: fixture.ai } }] }));
vi.mock('../ai/opencode-settings', () => ({ getOpenCodeTextModel: () => 'fixture-model' }));
import '../routes/genre-recommendations.routes';

function request() {
  const req: any = new EventEmitter(); req.params = { videoId: 'abc12345678' }; req.query = { title: 'fixture', artist: 'Fixture Artist', limit: '3' }; return req;
}
function response() {
  const res: any = new EventEmitter(); res.writableEnded = false; res.destroyed = false; res.statusCode = 200;
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; res.writableEnded = true; return res; }; return res;
}
beforeEach(() => { vi.useFakeTimers(); fixture.extract.mockReset(); fixture.search.mockReset(); fixture.ai.mockReset(); fixture.fallback = []; });
afterEach(() => { vi.useRealTimers(); });

describe('downstream similar-route cancellation', () => {
  it('stops after a disconnect during metadata extraction, including late completion', async () => {
    let finish!: (value: any) => void;
    fixture.extract.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const req = request(), res = response();
    const pending = fixture.handlers.get('/similar/:videoId')(req, res);
    res.destroyed = true; res.emit('close'); await pending;
    finish({ title: 'late', artist: 'late' }); await Promise.resolve();
    expect(fixture.search).not.toHaveBeenCalled(); expect(fixture.ai).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
    expect(fixture.extract.mock.calls[0][2].signal.aborted).toBe(true);
  });

  it('retains completed tracks if optional AI exceeds the request deadline and never starts a late search', async () => {
    fixture.extract.mockResolvedValue(null);
    fixture.search.mockResolvedValue([{ videoId: 'def12345678', title: 'other song', channel: 'Fixture Artist', duration: 180 }]);
    let finish!: (value: any) => void;
    fixture.ai.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const req = request(), res = response();
    const pending = fixture.handlers.get('/similar/:videoId')(req, res);
    await vi.advanceTimersByTimeAsync(12_000); await pending;
    expect(res.statusCode).toBe(200); expect(res.body.partial).toBe(true); expect(res.body.recommendations).toHaveLength(1);
    finish({ text: 'Late Artist - Late Song' }); await Promise.resolve();
    expect(fixture.search).toHaveBeenCalledTimes(1); expect(fixture.ai).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('returns 503 when artist, AI and fallback query searches fail fast and the database fallback is empty', async () => {
    fixture.extract.mockResolvedValue(null);
    fixture.search.mockRejectedValue(new Error('search source unavailable'));
    fixture.ai.mockRejectedValue(new Error('AI source unavailable'));
    const res = response(); await fixture.handlers.get('/similar/:videoId')(request(), res);
    expect(fixture.search).toHaveBeenCalledTimes(3); expect(fixture.ai).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(503); expect(res.body.error).toBeTruthy(); expect(res.body.recommendations).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a valid local fallback as a partial response after fast upstream failure', async () => {
    fixture.extract.mockResolvedValue(null);
    fixture.search.mockRejectedValue(new Error('search source unavailable'));
    fixture.ai.mockRejectedValue(new Error('AI source unavailable'));
    fixture.fallback = [{ video_id: 'def12345678', title: 'cached song', channel_name: 'artist', thumbnail: '', duration: 180 }];
    const res = response(); await fixture.handlers.get('/similar/:videoId')(request(), res);
    expect(res.statusCode).toBe(200); expect(res.body.partial).toBe(true); expect(res.body.recommendations[0].title).toBe('cached song');
  });

  it('preserves a successful empty result when retrieval attempts return no matches without error', async () => {
    fixture.extract.mockResolvedValue(null); fixture.search.mockResolvedValue([]); fixture.ai.mockResolvedValue({ text: '' });
    const res = response(); await fixture.handlers.get('/similar/:videoId')(request(), res);
    expect(res.statusCode).toBe(200); expect(res.body.recommendations).toEqual([]); expect(res.body.partial).not.toBe(true);
  });

  it('preserves an empty no-seed response without launching upstream work', async () => {
    const req = request(); req.query = {};
    const res = response(); await fixture.handlers.get('/similar/:videoId')(req, res);
    expect(res.statusCode).toBe(200); expect(res.body.recommendations).toEqual([]);
    expect(fixture.extract).not.toHaveBeenCalled(); expect(fixture.search).not.toHaveBeenCalled(); expect(fixture.ai).not.toHaveBeenCalled();
  });

  it('filters invalid and overlong cached fallback tracks instead of returning a fake success after failures', async () => {
    fixture.extract.mockResolvedValue(null); fixture.search.mockRejectedValue(new Error('failed')); fixture.ai.mockRejectedValue(new Error('failed'));
    fixture.fallback = [
      { video_id: 'def12345678', title: 'string duration', channel_name: 'artist', duration: '180' },
      { video_id: 'ghi12345678', title: 'overlong', channel_name: 'artist', duration: 601 },
    ];
    const res = response(); await fixture.handlers.get('/similar/:videoId')(request(), res);
    expect(res.statusCode).toBe(503); expect(res.body.recommendations).toBeUndefined();
  });

});
