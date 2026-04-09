import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography } from '@mui/material';
import type { RootState } from '../../store';
import type { LyricsLine } from '../../types/lyrics.types';

interface VideoLyricsOverlayProps {
  translations: string[]; // index-aligned with lyrics lines
}

export default function VideoLyricsOverlay({ translations }: VideoLyricsOverlayProps) {
  const { currentTime } = useSelector((state: RootState) => state.player);
  const { currentLyrics, timeOffset } = useSelector((state: RootState) => state.lyrics);

  const lines: LyricsLine[] = currentLyrics?.lines || [];
  const isSynced = currentLyrics?.isSynced ?? false;

  const currentLineIndex = useMemo(() => {
    if (!isSynced || lines.length === 0) return -1;
    const adjustedTime = currentTime + (timeOffset || 0);
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= adjustedTime) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [currentTime, timeOffset, lines, isSynced]);

  if (!isSynced || currentLineIndex < 0) return null;

  const currentLine = lines[currentLineIndex];
  if (!currentLine?.text?.trim()) return null;

  const translatedText = translations[currentLineIndex];

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        right: 16,
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <Typography
        sx={{
          color: '#fff',
          fontSize: '1.1rem',
          fontWeight: 600,
          textShadow: '0 0 8px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.8)',
          lineHeight: 1.4,
          px: 1,
        }}
      >
        {currentLine.text}
      </Typography>
      {translatedText && translatedText !== currentLine.text && (
        <Typography
          sx={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: '0.85rem',
            fontWeight: 400,
            textShadow: '0 0 6px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.7)',
            lineHeight: 1.3,
            mt: 0.3,
            px: 1,
          }}
        >
          {translatedText}
        </Typography>
      )}
    </Box>
  );
}
