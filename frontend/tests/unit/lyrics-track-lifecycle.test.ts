import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../../src/store';
import { setCurrentTrack, setPendingTrack, confirmPendingTrack, clearPlaybackSession, setPlaylist, playNext, playNow } from '../../src/store/playerSlice';
import { setCurrentLyrics, setTimeOffset, setTrackTimeOffset, setTrackLyricsStatus } from '../../src/store/lyricsSlice';

// Explicit regression fixtures; never shipped as application song data.
const track = (videoId: string) => ({ id: videoId, videoId, title: `Regression fixture ${videoId}`, channel: 'Test fixture', thumbnail: '', duration: 180 });
const lyrics = (videoId: string) => ({ videoId, source: 'lrclib' as const, isSynced: true, lines: [{ time: 0, text: `Fixture lyrics ${videoId}` }] });
for (const path of ['direct play', 'next', 'crossfade / continuous radio confirmation']) {
  test(`${path}: retain playing lyrics while pending, clear on confirmation, reject late old lyrics`, () => {
    store.dispatch(clearPlaybackSession());
    store.dispatch(setPlaylist([track('fixture-A'), track('fixture-B')]));
    store.dispatch(setCurrentTrack(track('fixture-A')));
    store.dispatch(setCurrentLyrics(lyrics('fixture-A')));
    if (path === 'next') store.dispatch(playNext());
    else if (path === 'direct play') store.dispatch(playNow(track('fixture-B')));
    else store.dispatch(setPendingTrack(track('fixture-B')));
    store.dispatch(setTimeOffset(4));
    assert.equal(store.getState().lyrics.currentLyrics?.videoId, 'fixture-A');
    store.dispatch(confirmPendingTrack());
    assert.equal(store.getState().player.currentTrack?.videoId, 'fixture-B');
    assert.equal(store.getState().lyrics.currentLyrics, null, 'confirmed song must not display previous song lyrics');
    store.dispatch(setCurrentLyrics(lyrics('fixture-B')));
    store.dispatch(setCurrentLyrics(lyrics('fixture-A')));
    assert.equal(store.getState().lyrics.currentLyrics?.videoId, 'fixture-B', 'late old request must not overwrite current lyrics');
    assert.equal(store.getState().lyrics.timeOffset, 0, 'confirmation resets old song offset');
    store.dispatch(setTrackTimeOffset({ videoId: 'fixture-A', timeOffset: 19 }));
    store.dispatch(setTrackLyricsStatus({ videoId: 'fixture-A', isLoading: false, error: 'Fixture stale error' }));
    assert.equal(store.getState().lyrics.timeOffset, 0);
    assert.equal(store.getState().lyrics.error, null);
    assert.equal(store.getState().lyrics.isLoading, true, 'old completion must not dismiss new song loading');
  });
}
