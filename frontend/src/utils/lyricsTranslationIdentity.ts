import type { Lyrics } from '../types/lyrics.types';

export interface LyricsTranslationBroadcast {
  videoId: string;
  translations: string[];
  sourceLines?: string[];
  targetLanguage?: string;
}

export function isMatchingLyricsTranslation(current: Lyrics | null, event: LyricsTranslationBroadcast): boolean {
  if (!current || current.videoId !== event.videoId || event.targetLanguage !== 'zh-TW') return false;
  if (!Array.isArray(event.sourceLines) || event.sourceLines.length !== current.lines.length) return false;
  if (!Array.isArray(event.translations) || event.translations.length !== current.lines.length) return false;
  return event.sourceLines.every((text, index) => text === current.lines[index].text)
    && event.translations.every(text => typeof text === 'string');
}
