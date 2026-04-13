export function normalizeTrackTitle(title: string): string {
  let normalized = String(title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const noisyBracket = /^(official|music video|lyric video|lyrics?|audio|visualizer|mv|karaoke|sub\.? español|subtitles?|hd|4k|hq)$/i;
  normalized = normalized
    .replace(/\s*\(([^)]*)\)\s*$/g, (_m, inner) => noisyBracket.test(String(inner).trim()) ? '' : _m)
    .replace(/\s*\[([^\]]*)\]\s*$/g, (_m, inner) => noisyBracket.test(String(inner).trim()) ? '' : _m)
    .replace(/\s*【([^】]*)】\s*$/g, (_m, inner) => noisyBracket.test(String(inner).trim()) ? '' : _m)
    .replace(/\s*[-–—|:]?\s*(official|music video|lyric video|lyrics?|audio|visualizer|mv|karaoke|sub\.? español|subtitles?|hd|4k|hq)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

export function normalizeArtistName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*official$/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTrackIdentity(title: string, artist: string): string {
  const normalizedTitle = normalizeTrackTitle(title);
  const normalizedArtist = normalizeArtistName(artist);

  const dashMatch = normalizedTitle.match(/^(.+?)\s+-\s+(.+)$/);
  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[2].trim();
    if (normalizedArtist && (left === normalizedArtist || left.includes(normalizedArtist) || normalizedArtist.includes(left))) {
      return `${normalizedArtist}::${right}`;
    }
    if (normalizedArtist && (right === normalizedArtist || right.includes(normalizedArtist) || normalizedArtist.includes(right))) {
      return `${normalizedArtist}::${left}`;
    }
  }

  return `${normalizedArtist}::${normalizedTitle}`;
}
