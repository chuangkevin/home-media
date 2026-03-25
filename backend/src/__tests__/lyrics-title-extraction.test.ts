import { describe, it, expect } from 'vitest';

/**
 * Test the title extraction logic used in lyrics search.
 * Since cleanSongTitle is a private method on LyricsService,
 * we replicate the extraction logic here for unit testing.
 */

function cleanArtistName(artist: string): string {
  return artist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*vevo$/i, '')
    .replace(/\s*official$/i, '')
    .trim();
}

function cleanSongTitle(title: string, channelName?: string): string {
  // 0. Unicode normalization
  let normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC');

  normalized = normalized
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Chinese brackets
  const chineseBracketMatch = normalized.match(/[【《]([^【】《》]+)[】》]/);
  if (chineseBracketMatch) {
    return chineseBracketMatch[1].trim();
  }

  // 2. Remove common suffixes
  let cleaned = normalized
    .replace(/\s*[\(\[【《].*?(official|mv|music video|lyric|lyrics|audio|hd|hq|4k|1080p|官方|完整版|高音質|歌詞).*?[\)\]】》]/gi, '')
    .replace(/\s*-\s*(official|mv|music video|lyric|lyrics|audio).*$/gi, '')
    .replace(/\s*(official|mv|music video|lyrics?|lyric video)$/gi, '')
    .replace(/[✨🎵🎶💕❤️🔥⭐️🌟💫]/g, '')
    .trim();

  // 3a. Channel-name-based artist/title split
  if (channelName) {
    const cleanChannel = cleanArtistName(channelName);
    const dashSplitMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dashSplitMatch) {
      const beforeDash = dashSplitMatch[1].trim();
      const afterDash = dashSplitMatch[2].trim();

      const normalizedBefore = beforeDash.toLowerCase();
      const normalizedChannel = cleanChannel.toLowerCase();

      if (normalizedBefore === normalizedChannel ||
          normalizedChannel.includes(normalizedBefore) ||
          normalizedBefore.includes(normalizedChannel)) {
        return afterDash;
      }

      const normalizedAfter = afterDash.toLowerCase();
      if (normalizedAfter === normalizedChannel ||
          normalizedChannel.includes(normalizedAfter) ||
          normalizedAfter.includes(normalizedChannel)) {
        return beforeDash;
      }
    }
  }

  // 3b. Fallback dash extraction
  const dashMatch = cleaned.match(/[-–—]\s*(.+?)$/);
  if (dashMatch && dashMatch[1].length > 2 && !dashMatch[1].match(/official|mv|music|video|audio|lyrics/i)) {
    return dashMatch[1].trim();
  }

  // 4. Chinese fragment extraction
  const words = cleaned.split(/\s+/);
  if (words.length >= 3) {
    const chinesePartMatch = cleaned.match(/[\u4e00-\u9fff]+[\u4e00-\u9fff\s]*/);
    if (chinesePartMatch && chinesePartMatch[0].length > 4) {
      return chinesePartMatch[0].trim();
    }
  }

  return cleaned;
}

describe('cleanSongTitle', () => {
  describe('Artist - Song format with channel name hint', () => {
    it('should extract song title when artist matches channel', () => {
      expect(cleanSongTitle('Michael Jackson - Billie Jean', 'Michael Jackson')).toBe('Billie Jean');
    });

    it('should extract song title when channel has "- Topic" suffix', () => {
      expect(cleanSongTitle('Adele - Hello', 'Adele - Topic')).toBe('Hello');
    });

    it('should extract song title when channel has "VEVO" suffix', () => {
      expect(cleanSongTitle('Taylor Swift - Shake It Off', 'TaylorSwiftVEVO')).toBe('Shake It Off');
    });

    it('should handle multiple dashes - keep everything after artist split', () => {
      expect(cleanSongTitle('The Weeknd - Save Your Tears - Remix', 'The Weeknd')).toBe('Save Your Tears - Remix');
    });

    it('should handle reversed format "Song - Artist"', () => {
      expect(cleanSongTitle('Bohemian Rhapsody - Queen', 'Queen')).toBe('Bohemian Rhapsody');
    });

    it('should not split when channel name does not match either side', () => {
      const result = cleanSongTitle('Best Pop Songs 2024 - Top Hits', 'Music Compilation');
      // Falls through to fallback dash extraction
      expect(result).toBe('Top Hits');
    });
  });

  describe('Chinese bracket extraction', () => {
    it('should extract title from 【】 brackets', () => {
      expect(cleanSongTitle('周杰倫 Jay Chou【告白氣球】Official MV')).toBe('告白氣球');
    });

    it('should extract title from 《》 brackets', () => {
      expect(cleanSongTitle('五月天《倔強》')).toBe('倔強');
    });
  });

  describe('Suffix removal', () => {
    it('should remove (Official Video) suffix', () => {
      expect(cleanSongTitle('Hello (Official Video)', 'Adele')).toBe('Hello');
    });

    it('should remove [MV] suffix', () => {
      expect(cleanSongTitle('Song Name [MV]')).toBe('Song Name');
    });

    it('should remove trailing "Official MV"', () => {
      // "Artist - Song (Official MV)" → after suffix removal → "Artist - Song"
      expect(cleanSongTitle('Adele - Hello (Official MV)', 'Adele')).toBe('Hello');
    });
  });

  describe('Fallback dash extraction (no channel name)', () => {
    it('should extract after dash when no channel provided', () => {
      expect(cleanSongTitle('Artist Name - Song Title')).toBe('Song Title');
    });

    it('should not extract if after-dash part is too short', () => {
      expect(cleanSongTitle('Something - AB')).toBe('Something - AB');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      expect(cleanSongTitle('')).toBe('');
    });

    it('should handle title with no special format', () => {
      expect(cleanSongTitle('Just A Normal Title')).toBe('Just A Normal Title');
    });

    it('should handle emoji in title', () => {
      expect(cleanSongTitle('🎵 Artist - Song Title 🎶', 'Artist')).toBe('Song Title');
    });
  });
});

describe('cleanArtistName', () => {
  it('should remove "- Topic" suffix', () => {
    expect(cleanArtistName('Jay Chou - Topic')).toBe('Jay Chou');
  });

  it('should remove "VEVO" suffix', () => {
    expect(cleanArtistName('TaylorSwiftVEVO')).toBe('TaylorSwift');
  });

  it('should remove "Official" suffix', () => {
    expect(cleanArtistName('Adele Official')).toBe('Adele');
  });

  it('should handle clean name', () => {
    expect(cleanArtistName('Michael Jackson')).toBe('Michael Jackson');
  });
});
