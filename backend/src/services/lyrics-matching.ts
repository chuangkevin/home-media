import { Lyrics } from '../types/lyrics.types';
export interface SongMetadata { title: string; artist?: string; duration?: number; rawTitle?: string }
export interface LyricsCandidate { id: number; trackName: string; artistName: string; duration?: number; syncedLyrics?: string }
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const packaging = (s: string) => s.replace(/[([][^)\]]*(?:official|lyrics?|music video|audio|hd|hq|live|remix|cover|acoustic|instrumental|karaoke|remaster|sped up|slowed|radio edit|extended)[^)\]]*[)\]]/gi, '').trim();
// Preserve artist diacritics: ROSÉ and ROSÉ are equivalent; unrelated Rose is not proof.
const artistKey = (s: string) => s.replace(/\s*-\s*topic$|vevo$|\s+official$/gi, '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
const artistsMatch = (expected: string, candidate: string): boolean => {
  const a = artistKey(expected), b = artistKey(candidate);
  if (a === b) return true;
  const han = (value: string) => (value.match(/\p{Script=Han}+/gu) || []).join('');
  const aHan = han(a), bHan = han(b);
  // Bilingual stage names may write AstroBunny/Astro Bunny. Both the complete
  // Han name and the complete remaining name must agree, never a substring.
  return aHan.length >= 2 && aHan === bHan
    && a.replace(/\p{Script=Han}|\s/gu, '') === b.replace(/\p{Script=Han}|\s/gu, '');
};
const versions = (s: string) => [...new Set(s.toLowerCase().match(/\b(?:live|remix|cover|acoustic|instrumental|karaoke|remaster(?:ed)?|sped\s+up|slowed|radio\s+edit|extended)\b|現場|翻唱|伴奏/g) || [])].sort().join('|');
const versionDetails = (s: string) => (s.match(/[([][^)\]]+[)\]]/g) || []).filter(part => !!versions(part)).map(normalize).sort().join('|');
/** Conservative metadata evidence, NOT audio verification. Unknown artist fails closed. */
export function matchScore(expected: SongMetadata, candidate: LyricsCandidate): number | null {
 if (!expected.artist || !candidate.artistName || !artistsMatch(expected.artist, candidate.artistName)) return null;
 if (!expected.title || normalize(packaging(expected.title)) !== normalize(packaging(candidate.trackName))) return null;
 if (versions(expected.rawTitle || expected.title) !== versions(candidate.trackName)) return null;
 if (versionDetails(expected.rawTitle || expected.title) !== versionDetails(candidate.trackName)) return null;
 if (expected.duration && expected.duration > 0) {
  if (!candidate.duration || !Number.isFinite(candidate.duration) || Math.abs(expected.duration - candidate.duration) > 4) return null;
  return 100 - Math.abs(expected.duration - candidate.duration);
 }
 return 90;
}
export function selectCandidate<T extends LyricsCandidate>(expected: SongMetadata, candidates: T[]): T | null {
 return candidates.map(candidate => ({ candidate, score: matchScore(expected, candidate) }))
  .filter((r): r is { candidate: T; score: number } => r.score !== null)
  .sort((a,b) => b.score - a.score || Number(!!b.candidate.syncedLyrics) - Number(!!a.candidate.syncedLyrics) || a.candidate.id - b.candidate.id)[0]?.candidate || null;
}
export function canReuseLyrics(lyrics: Lyrics, expected: SongMetadata): boolean {
 if (lyrics.source === 'manual' || lyrics.provenance?.selection === 'user') return true;
 const p = lyrics.provenance;
 return !!p && p.selection === 'automatic' && (p.evidence === 'metadata' || p.evidence === 'publisher-caption') && matchScore(expected, { id: p.sourceId || 0, trackName: p.title || '', artistName: p.artist || '', duration: p.duration }) !== null;
}
