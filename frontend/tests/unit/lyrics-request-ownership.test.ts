import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { store } from '../../src/store';
import { setCurrentTrack, setPendingTrack, confirmPendingTrack, clearPlaybackSession } from '../../src/store/playerSlice';
import { setCurrentLyrics, setTimeOffset, setTrackTimeOffset, setTrackLyricsStatus } from '../../src/store/lyricsSlice';

// Regression-only synthetic fixtures. Execute actual production effect/callback bodies,
// replacing only browser hooks, clocks and IO boundaries (same harness as follower tests).
const fixtureTrack = (videoId: string) => ({ id: videoId, videoId, title: `Fixture ${videoId}`, channel: 'Regression fixture', thumbnail: '', duration: 180 });
const fixtureLyrics = (videoId: string) => ({ videoId, source: 'lrclib' as const, isSynced: true, lines: [{ time: 0, text: `Fixture ${videoId}` }] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function actualCallback(file: string, match: (call: ts.CallExpression) => boolean, context: Record<string, any>) {
  const source = ts.createSourceFile(file, readFileSync(path.resolve(process.env.LYRICS_REGRESSION_SOURCE_ROOT ?? process.cwd(), file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && match(node)) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, 'actual production callback must exist');
  const code = ts.transpileModule(`const callback = ${callback.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(...Object.keys(context), `${code}; return callback;`)(...Object.values(context));
}
const sheet = 'src/components/Player/FullscreenLyrics.tsx';
const silentConsole = { log() {}, warn() {}, error() {} };
function reset() { store.dispatch(clearPlaybackSession()); store.dispatch(setCurrentTrack(fixtureTrack('fixture-A'))); }

test('actual preference effect: late backend offset cannot overwrite confirmed new song', async () => {
  reset();
  const response = deferred<{ timeOffset: number }>();
  const activeTrackVideoIdRef = { current: 'fixture-A' };
  const effect = actualCallback(sheet, call => call.expression.getText() === 'useEffect' && call.arguments[0]?.getText().includes('const loadPreference = async'), {
    track: fixtureTrack('fixture-A'), open: true, dispatch: store.dispatch,
    setTimeOffset, setTrackTimeOffset, activeTrackVideoIdRef,
    apiService: { getLyricsPreferences: () => response.promise, updateLyricsPreferences() {} },
    lyricsCacheService: { setTimeOffset() {}, getPreference: async () => null }, console: silentConsole,
  });
  effect();
  store.dispatch(setCurrentTrack(fixtureTrack('fixture-B')));
  store.dispatch(setTimeOffset(2));
  activeTrackVideoIdRef.current = 'fixture-B';
  response.resolve({ timeOffset: 19 }); await flush();
  assert.equal(store.getState().lyrics.timeOffset, 2, 'old preference must not overwrite B offset');
});

test('actual preference effect: cleanup rejects an old A request after A → B → A', async () => {
  reset();
  const response = deferred<{ timeOffset: number }>();
  const effect = actualCallback(sheet, call => call.expression.getText() === 'useEffect' && call.arguments[0]?.getText().includes('const loadPreference = async'), {
    track: fixtureTrack('fixture-A'), open: true, dispatch: store.dispatch,
    setTimeOffset, setTrackTimeOffset, activeTrackVideoIdRef: { current: 'fixture-A' },
    apiService: { getLyricsPreferences: () => response.promise, updateLyricsPreferences() {} },
    lyricsCacheService: { setTimeOffset() {}, getPreference: async () => null }, console: silentConsole,
  });
  const cleanup = effect(); assert.equal(typeof cleanup, 'function'); cleanup();
  store.dispatch(setTimeOffset(3)); response.resolve({ timeOffset: 19 }); await flush();
  assert.equal(store.getState().lyrics.timeOffset, 3);
});

function translationFixture() {
  const currentLyrics = fixtureLyrics('fixture-A');
  const response = deferred<any>();
  const callbacks: Array<() => void> = [];
  const updates: any[] = [];
  let requests = 0;
  const context = {
    currentLyrics, track: fixtureTrack('fixture-A'), translationGenRef: { current: 1 },
    activeTrackVideoIdRef: { current: 'fixture-A' }, activeLyricsRef: { current: currentLyrics },
    retryCountRef: { current: 0 }, translationRetryTimeoutRef: { current: null },
    setIsTranslating: (value: any) => updates.push(['loading', value]),
    setTranslationError: (value: any) => updates.push(['error', value]),
    setTranslations: (value: any) => updates.push(['translation', value]),
    apiService: { translateLyrics: () => { requests++; return response.promise; } },
    setTimeout: (cb: () => void, delay: number) => { if (delay !== 12000) callbacks.push(cb); return 1; },
    console: silentConsole, doTranslate: undefined as any,
  };
  const translate = actualCallback(sheet, call => call.expression.getText() === 'useCallback' && call.arguments[0]?.getText().includes('const translateRequest ='), context);
  // Recursive callback resolves through a forwarding closure, not a copied implementation.
  context.doTranslate = translate;
  const recursiveContext = { ...context, doTranslate: (gen: number) => recursive(gen) };
  const recursive = actualCallback(sheet, call => call.expression.getText() === 'useCallback' && call.arguments[0]?.getText().includes('const translateRequest ='), recursiveContext);
  return { context, response, callbacks, updates, translate: recursive, requests: () => requests };
}

test('actual translation callback: result arriving before next effect cannot overwrite new song', async () => {
  const f = translationFixture(); f.translate(1); f.updates.length = 0;
  f.context.activeTrackVideoIdRef.current = 'fixture-B';
  f.context.activeLyricsRef.current = fixtureLyrics('fixture-B');
  f.response.resolve({ translations: ['Fixture translation A'] }); await flush();
  assert.deepEqual(f.updates, [], 'track/lyrics identity must guard completion, not only effect generation');
});

test('actual translation retry: old empty-result timer cannot issue requests or alter B loading', async () => {
  const f = translationFixture(); f.translate(1);
  f.response.resolve({ translations: [''] }); await flush(); assert.equal(f.callbacks.length, 1);
  f.context.activeTrackVideoIdRef.current = 'fixture-B'; f.context.translationGenRef.current++;
  f.updates.length = 0; f.callbacks[0](); await flush();
  assert.equal(f.requests(), 1, 'old retry must not request A again'); assert.deepEqual(f.updates, []);
});

test('actual Socket lyrics source handler rechecks ownership after IndexedDB write', async () => {
  reset();
  const cacheWrite = deferred<void>();
  let sourceChanged!: (data: any) => Promise<void>;
  const effect = actualCallback('src/hooks/useLyricsSync.ts', call => call.expression.getText() === 'useEffect' && call.arguments[0]?.getText().includes('const handleSourceChanged ='), {
    videoId: 'fixture-A', currentTrack: fixtureTrack('fixture-A'), dispatch: store.dispatch,
    activeVideoIdRef: { current: 'fixture-A' }, isRemoteUpdateRef: { current: false },
    onTranslationReceivedRef: { current: undefined }, setCurrentLyrics, setTrackTimeOffset,
    apiService: { getLyrics: async () => fixtureLyrics('fixture-A') },
    lyricsCacheService: { set: () => cacheWrite.promise }, console: silentConsole,
    socketService: {
      onLyricsOffsetChanged() {}, onLyricsTranslationReady() {},
      onLyricsSourceChanged(callback: any) { sourceChanged = callback; },
      offLyricsOffsetChanged() {}, offLyricsTranslationReady() {}, offLyricsSourceChanged() {},
    },
  });
  const cleanup = effect();
  const request = sourceChanged({ videoId: 'fixture-A', source: 'lrclib', sourceId: 123, deviceId: 'fixture-device' });
  await flush();
  cleanup(); store.dispatch(setCurrentTrack(fixtureTrack('fixture-B')));
  store.dispatch(setCurrentTrack(fixtureTrack('fixture-A')));
  store.dispatch(setCurrentLyrics({ ...fixtureLyrics('fixture-A'), lines: [{ time: 0, text: 'Fixture newer source' }] }));
  cacheWrite.resolve(); await request;
  assert.equal(store.getState().lyrics.currentLyrics?.lines[0].text, 'Fixture newer source', 'stale cached source write must not cross A → B → A lifecycle');
});

test('actual AudioPlayer confirmed-song effect loads radio/crossfade changes and ignores stale completions', async () => {
  reset();
  const response = deferred<any>();
  const effect = actualCallback('src/components/Player/AudioPlayer.tsx', call => call.expression.getText() === 'useEffect' && call.arguments[0]?.getText().includes('loadLyricsWithPreferences(track)'), {
    embedded: false, currentTrack: fixtureTrack('fixture-A'), reduxStore: store, dispatch: store.dispatch,
    setCurrentLyrics, setTrackLyricsStatus, loadLyricsWithPreferences: () => response.promise,
    skipSegmentsRef: { current: [] }, lyricsCacheService: { set: async () => {} },
  });
  const cleanup = effect();
  store.dispatch(setPendingTrack(fixtureTrack('fixture-B')));
  response.resolve(fixtureLyrics('fixture-A')); await flush();
  assert.equal(store.getState().lyrics.currentLyrics?.videoId, 'fixture-A', 'pending B must retain/load currently playing A');
  store.dispatch(confirmPendingTrack()); cleanup();
  assert.equal(store.getState().lyrics.currentLyrics, null);
  const nextResponse = deferred<any>();
  const next = actualCallback('src/components/Player/AudioPlayer.tsx', call => call.expression.getText() === 'useEffect' && call.arguments[0]?.getText().includes('loadLyricsWithPreferences(track)'), {
    embedded: false, currentTrack: fixtureTrack('fixture-B'), reduxStore: store, dispatch: store.dispatch,
    setCurrentLyrics, setTrackLyricsStatus, loadLyricsWithPreferences: () => nextResponse.promise,
    skipSegmentsRef: { current: [] }, lyricsCacheService: { set: async () => {} },
  });
  const nextCleanup = next(); store.dispatch(setCurrentTrack(fixtureTrack('fixture-C')));
  nextResponse.resolve(fixtureLyrics('fixture-B')); await flush(); nextCleanup();
  assert.equal(store.getState().lyrics.currentLyrics, null); assert.equal(store.getState().lyrics.isLoading, true);
});
