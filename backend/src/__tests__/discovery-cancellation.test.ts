import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ generate: vi.fn(), adapter: vi.fn(), adapters: [] as any[] }));
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: fixture.generate }; } } }));
vi.mock('../config/database', () => ({ getDatabase: () => ({ prepare: () => ({ get: () => ({ value: 'fixture-key-not-a-secret-12345' }) }) }) }));
vi.mock('../utils/logger', () => ({ default: { error() {}, warn() {}, info() {} } }));
vi.mock('../ai/provider', () => ({ buildOpenCodeAdapters: () => fixture.adapters }));
vi.mock('../ai/opencode-settings', () => ({ getOpenCodeTextModel: () => 'fixture-model' }));
import { extractTrackInfo, generateDiscoveryQueries, invalidateKeyCache } from '../services/gemini.service';

beforeEach(() => { fixture.generate.mockReset(); fixture.adapter.mockReset(); fixture.adapters = []; invalidateKeyCache(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('AI request cancellation fences', () => {
  it('passes the signal into Gemini discovery and suppresses retries after abort', async () => {
    const controller = new AbortController();
    fixture.generate.mockImplementation((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = generateDiscoveryQueries({}, [], { signal: controller.signal, timeoutMs: 50 });
    controller.abort(); expect(await pending).toEqual([]);
    expect(fixture.generate).toHaveBeenCalledTimes(1);
    expect(fixture.generate.mock.calls[0][1]).toEqual({ signal: controller.signal, timeout: 50 });
  });

  it('passes the signal into metadata extraction and suppresses retries after abort', async () => {
    const controller = new AbortController();
    fixture.generate.mockImplementation((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = extractTrackInfo('fixture', 'artist', { signal: controller.signal, timeoutMs: 50 });
    controller.abort(); expect(await pending).toBeNull(); expect(fixture.generate).toHaveBeenCalledTimes(1);
  });

  it('fences an uncancellable OpenCode completion and starts no later provider', async () => {
    const controller = new AbortController();
    let finish!: (value: any) => void;
    fixture.adapter.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fixture.adapters = [{ adapter: { generateContent: fixture.adapter } }, { adapter: { generateContent: fixture.adapter } }];
    const pending = generateDiscoveryQueries({}, [], { signal: controller.signal });
    controller.abort(); expect(await pending).toEqual([]);
    finish({ text: '["late query"]' }); await Promise.resolve();
    expect(fixture.adapter).toHaveBeenCalledTimes(1); expect(fixture.generate).not.toHaveBeenCalled();
  });
});
