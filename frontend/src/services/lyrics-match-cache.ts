import type { Lyrics, LyricsLine } from '../types/lyrics.types';
import type { Track } from '../types/track.types';

const knownDuration = (duration?: number): number => Number.isFinite(duration) && (duration ?? 0) > 0 ? duration! : 0;

/** Structural/time plausibility is necessary, never a claim that words were heard. */
export function isLyricsTimelinePlausible(lines: LyricsLine[], duration?: number): boolean {
  if (!Array.isArray(lines) || !lines.length) return false;
  const limit = knownDuration(duration);
  return lines.every((line, index) => typeof line.text === 'string'
    && Number.isFinite(line.time) && line.time >= 0
    && (!limit || line.time <= limit + 3)
    && (index === 0 || line.time >= lines[index - 1].time));
}

export function canReuseLyricsForTrack(lyrics: Lyrics, track: Track): boolean {
  if (lyrics.videoId !== track.videoId || !isLyricsTimelinePlausible(lyrics.lines, track.duration)) return false;
  // Explicit user choices are retained as choices, not advertised as audio verified.
  if (lyrics.source === 'manual' || lyrics.provenance?.selection === 'user') return true;
  const context = lyrics.matchContext;
  return lyrics.provenance?.selection === 'automatic'
    && (lyrics.provenance.evidence === 'metadata' || lyrics.provenance.evidence === 'publisher-caption')
    && context?.policy === 'metadata-v1'
    && context.title === track.title && context.artist === track.channel
    && context.duration === knownDuration(track.duration);
}

/** Record exactly the input validated by the server's candidate matcher. No TTL. */
export function withLyricsMatchContext(lyrics: Lyrics, track: Track): Lyrics {
  const automaticEvidence = lyrics.provenance?.selection === 'automatic'
    && (lyrics.provenance.evidence === 'metadata' || lyrics.provenance.evidence === 'publisher-caption');
  if (!automaticEvidence) return lyrics;
  return { ...lyrics, matchContext: {
    policy: 'metadata-v1', title: track.title, artist: track.channel,
    duration: knownDuration(track.duration),
  } };
}
