import test from 'node:test';
import assert from 'node:assert/strict';
import lyricsCache from '../../src/services/lyrics-cache.service';
import { audioCacheDatabase } from './helpers/fake-audio-cache-db';

// Synthetic fixtures only; no real application database or song data is used.
const fixture = (videoId: string, text = 'Synthetic test lyrics') => ({
  videoId, lines: [{ time: 0, text }], source: 'manual' as const, isSynced: true,
});
function setup(entries = new Map<string, any>()) {
  const { db } = audioCacheDatabase(entries);
  (lyricsCache as any).db = db;
  return entries;
}
const commit = () => new Promise(resolve => setTimeout(resolve, 10));

test('lyrics saved years ago remain readable without TTL deletion', async (t) => {
  // The fixture verifies stored records, not diagnostic console output.
  t.mock.method(console, 'log', () => {});
  const lyrics = fixture('synthetic-old');
  const entries = setup(new Map([[lyrics.videoId, { videoId: lyrics.videoId, lyrics, timestamp: 1 }]]));
  assert.deepEqual(await lyricsCache.get(lyrics.videoId), lyrics);
  await commit();
  assert.equal(entries.has(lyrics.videoId), true);
});

test('adding the 501st lyrics record does not evict permanent lyrics', async (t) => {
  // The fixture verifies stored records, not diagnostic console output.
  t.mock.method(console, 'log', () => {});
  const entries = setup(new Map(Array.from({ length: 500 }, (_, i) => {
    const videoId = `synthetic-${i}`;
    return [videoId, { videoId, lyrics: fixture(videoId), timestamp: i }];
  })));
  await lyricsCache.set('synthetic-new', fixture('synthetic-new'));
  await commit();
  assert.equal(entries.size, 501);
  assert.ok(entries.has('synthetic-0'));
});

test('manual edits explicitly replace lyrics; explicit deletion remains supported', async (t) => {
  // The fixture verifies stored records, not diagnostic console output.
  t.mock.method(console, 'log', () => {});
  const entries = setup();
  await lyricsCache.set('synthetic-edit', fixture('synthetic-edit', 'Original synthetic text'));
  await commit();
  const edited = fixture('synthetic-edit', 'Manually edited synthetic text');
  await lyricsCache.set('synthetic-edit', edited);
  await commit();
  assert.deepEqual(await lyricsCache.get('synthetic-edit'), edited);
  assert.equal(entries.size, 1);
  await lyricsCache.delete('synthetic-edit');
  await commit();
  assert.equal(await lyricsCache.get('synthetic-edit'), null);
});
