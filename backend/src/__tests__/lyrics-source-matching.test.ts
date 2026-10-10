import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const netease = vi.hoisted(() => ({ search: vi.fn(), lyric: vi.fn() }));
vi.mock('../config/database', () => ({ db: { prepare: vi.fn() } }));
vi.mock('../services/gemini.service', () => ({ isConfigured: () => false }));
vi.mock('simple-netease-cloud-music', () => ({ default: class { search = netease.search; lyric = netease.lyric; } }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
import service from '../services/lyrics.service';
import { canReuseLyrics, matchScore } from '../services/lyrics-matching';
const s = service as any;
const candidate = (id: number, trackName = 'Hello', artistName = 'Adele', duration = 300, synced = true) => ({ id, trackName, artistName, duration, instrumental: false, syncedLyrics: synced ? '[00:01.00] Synthetic fixture' : undefined, plainLyrics: 'Synthetic fixture' });
beforeEach(() => { vi.spyOn(s, 'fetchWithSSLBypass').mockResolvedValue({ ok: true, json: async () => [] }); });
afterEach(() => vi.restoreAllMocks());
it('rejects same-title wrong artist', async () => {
 s.fetchWithSSLBypass.mockResolvedValue({ ok: true, json: async () => [candidate(1, 'Hello', 'Lionel Richie')] });
 expect(await s.fetchLRCLIB('v', 'Hello', 'Adele', 300)).toBeNull();
});
it('different synced song ranked first cannot displace matching plain lyrics', async () => {
 s.fetchWithSSLBypass.mockResolvedValue({ ok: true, json: async () => [candidate(1, 'Someone Like You'), candidate(2, 'Hello', 'Adele', 300, false)] });
 expect((await s.fetchLRCLIB('v', 'Hello', 'Adele', 300))?.isSynced).toBe(false);
});
it.each(['Live', 'Remix', 'Cover', 'Acoustic'])('rejects studio vs %s even with same artist and duration', async version => {
 s.fetchWithSSLBypass.mockResolvedValue({ ok: true, json: async () => [candidate(1, `Hello (${version})`)] });
 expect(await s.fetchLRCLIB('v', 'Hello', 'Adele', 300)).toBeNull();
});
it('preserves raw live-version evidence when title cleaner strips brackets', async () => {
 s.fetchWithSSLBypass.mockResolvedValue({ ok: true, json: async () => [candidate(1)] });
 expect(await s.fetchLRCLIB('v', 'Adele - Hello [Live]', 'Adele', 300)).toBeNull();
});
it('duration rejects corrupt first result and selects closest eligible candidate deterministically', async () => {
 s.fetchWithSSLBypass.mockResolvedValue({ ok: true, json: async () => [candidate(1, 'drinks or coffee', 'ROSÉ', 80), candidate(2, 'drinks or coffee', 'ROSÉ', 133), candidate(3, 'drinks or coffee', 'ROSÉ', 134)] });
 const lyrics = await s.fetchLRCLIB('v', 'ROSÉ - drinks or coffee (official audio)', 'ROSÉ', 134);
 expect(lyrics?.provenance?.sourceId).toBe(3);
});
it('unverified automatic cache must not bypass semantic matching, and is not deleted', async () => {
 const legacy = { videoId: 'v', source: 'lrclib', isSynced: true, lines: [{ time: 1, text: 'Wrong synthetic song' }] };
 vi.spyOn(s, 'getFromCache').mockReturnValue(legacy);
 vi.spyOn(s, 'getPreferences').mockReturnValue(null);
 for (const method of ['fetchLRCLIB', 'fetchNeteaseLyrics', 'fetchGeniusLyrics', 'fetchYouTubeCaptions']) vi.spyOn(s, method).mockResolvedValue(null);
 expect(await s._getLyricsImpl('v', 'Hello', 'Adele', 300)).toBeNull();
 expect(s.fetchLRCLIB).toHaveBeenCalled();
 });
 it('NetEase validates artist, version and millisecond duration before fetching lyrics', async () => {
 netease.search.mockResolvedValue({ result: { songs: [
 { id: 1, name: 'Hello', artists: [{ name: 'Wrong Artist' }], duration: 300000 },
 { id: 2, name: 'Hello (Live)', ar: [{ name: 'Adele' }], dt: 300000 },
 { id: 3, name: 'Hello', ar: [{ name: 'Adele' }], dt: 300000 },
 ] } });
 netease.lyric.mockResolvedValue({ lrc: { lyric: '[00:01.00] Synthetic fixture' } });
 expect((await s.fetchNeteaseLyrics('v', 'Hello', 'Adele', 300))?.provenance?.sourceId).toBe(3);
 expect(netease.lyric).toHaveBeenCalledWith('3');
 });
 it('metadata cache is reusable only for matching song, manual choice remains explicit', () => {
 const lyrics: any = { videoId: 'v', source: 'lrclib', lines: [], isSynced: true, provenance: { selection: 'automatic', evidence: 'metadata', title: 'Hello', artist: 'Adele', duration: 300 } };
 expect(canReuseLyrics(lyrics, { title: 'Hello', artist: 'Lionel Richie', duration: 300 })).toBe(false);
 expect(canReuseLyrics(lyrics, { title: 'Hello', artist: 'Adele', duration: 300 })).toBe(true);
 lyrics.provenance = { selection: 'user', evidence: 'user-selection' };
 expect(canReuseLyrics(lyrics, { title: 'Another Song', artist: 'Another Artist' })).toBe(true);
 });
 it('missing artist and substring-only artist/title cannot prove a song match', () => {
 expect(matchScore({ title: 'Hello' }, candidate(1))).toBeNull();
 expect(matchScore({ title: 'Hello', artist: 'Adele' }, candidate(1, 'Hello Again'))).toBeNull();
 expect(matchScore({ title: 'Hello', artist: 'Adele' }, candidate(1, 'Hello', 'Adele Tribute Band'))).toBeNull();
 expect(matchScore({ title: 'drinks or coffee', artist: 'ROSÉ' }, candidate(1, 'drinks or coffee', 'Rose'))).toBeNull();
 expect(matchScore({ title: 'drinks or coffee', artist: 'ROSÉ' }, candidate(1, 'drinks or coffee', 'ROSÉ'))).not.toBeNull();
 });
 it('bilingual artist whitespace is equivalent only when both complete names agree', () => {
 expect(matchScore({ title: 'Fixture Song', artist: '原子邦妮 AstroBunny', duration: 200 }, candidate(1, 'Fixture Song', '原子邦妮 Astro Bunny', 200))).not.toBeNull();
 expect(matchScore({ title: 'Fixture Song', artist: '原子邦妮 AstroBunny', duration: 200 }, candidate(1, 'Fixture Song', '原子邦妮 Other Band', 200))).toBeNull();
 expect(matchScore({ title: 'Fixture Song', artist: '原子邦妮 AstroBunny', duration: 200 }, candidate(1, 'Fixture Song', '另一樂團 AstroBunny', 200))).toBeNull();
 });
 it('accepts matching live version but rejects distinct named remixes', () => {
 expect(matchScore({ title: 'Hello', rawTitle: 'Adele - Hello [Live]', artist: 'Adele' }, candidate(1, 'Hello (Live)'))).not.toBeNull();
 expect(matchScore({ title: 'Hello (Club Remix)', artist: 'Adele' }, candidate(1, 'Hello (Dance Remix)'))).toBeNull();
 });
