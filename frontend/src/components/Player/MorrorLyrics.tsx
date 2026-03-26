import { useEffect, useState, useRef, useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import type { LyricsLine } from '../../types/lyrics.types';
import type { Track } from '../../types/track.types';
import { extractDominantColor } from '../../utils/extractColor';
import { toTraditional } from '../../utils/chineseConvert';
import apiService from '../../services/api.service';

// Mood → accent color mapping
const moodColors: Record<string, string> = {
  energetic: '#ff4444',
  upbeat: '#ff8800',
  chill: '#4488ff',
  dreamy: '#aa66ff',
  melancholic: '#6688aa',
  romantic: '#ff66aa',
  dark: '#8844aa',
  aggressive: '#ff2222',
};

const DEFAULT_COLOR = '#4488ff';
const DEFAULT_LINE_DURATION = 4;

interface MorrorLyricsProps {
  lines: LyricsLine[];
  currentLineIndex: number;
  track: Track;
  timeOffset: number;
}

export default function MorrorLyrics({ lines, currentLineIndex, track }: MorrorLyricsProps) {
  const [accentColor, setAccentColor] = useState(DEFAULT_COLOR);
  const prevLineIndexRef = useRef(-1);
  const [animKey, setAnimKey] = useState(0);

  // Fetch mood color or extract from thumbnail
  useEffect(() => {
    let cancelled = false;

    async function loadColor() {
      // 1. Try mood from style analysis
      try {
        const res = await apiService.getTrackStyle(track.videoId);
        if (!cancelled && res?.mood && moodColors[res.mood]) {
          setAccentColor(moodColors[res.mood]);
          return;
        }
      } catch {
        // No style data, continue
      }

      // 2. Try extract from thumbnail
      if (track.thumbnail) {
        const color = await extractDominantColor(track.thumbnail, track.videoId);
        if (!cancelled && color) {
          setAccentColor(color);
          return;
        }
      }

      // 3. Default
      if (!cancelled) setAccentColor(DEFAULT_COLOR);
    }

    loadColor();
    return () => { cancelled = true; };
  }, [track.videoId, track.thumbnail]);

  // Reset animation when line changes
  useEffect(() => {
    if (currentLineIndex !== prevLineIndexRef.current) {
      prevLineIndexRef.current = currentLineIndex;
      setAnimKey(k => k + 1);
    }
  }, [currentLineIndex]);

  // Compute line duration for karaoke fill
  const lineDuration = useMemo(() => {
    if (currentLineIndex < 0 || currentLineIndex >= lines.length) return DEFAULT_LINE_DURATION;
    const currentTime = lines[currentLineIndex].time;
    const nextTime = currentLineIndex + 1 < lines.length
      ? lines[currentLineIndex + 1].time
      : currentTime + DEFAULT_LINE_DURATION;
    return Math.max(0.5, Math.min(nextTime - currentTime, 15)); // Clamp 0.5-15s
  }, [currentLineIndex, lines]);

  const prevLine = currentLineIndex > 0 ? lines[currentLineIndex - 1] : null;
  const currentLine = currentLineIndex >= 0 && currentLineIndex < lines.length ? lines[currentLineIndex] : null;
  const nextLine = currentLineIndex + 1 < lines.length ? lines[currentLineIndex + 1] : null;

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        backgroundColor: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Background: blurred thumbnail */}
      {track.thumbnail && (
        <Box
          component="img"
          src={track.thumbnail}
          sx={{
            position: 'absolute',
            top: '-10%',
            left: '-10%',
            width: '120%',
            height: '120%',
            objectFit: 'cover',
            filter: 'blur(40px)',
            opacity: 0.3,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Dark overlay */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          pointerEvents: 'none',
        }}
      />

      {/* Lyrics content */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: { xs: 3, sm: 4, md: 5 },
          px: { xs: 3, sm: 5, md: 8 },
          maxWidth: 900,
          width: '100%',
          textAlign: 'center',
        }}
      >
        {/* Previous line */}
        <Typography
          sx={{
            fontSize: { xs: '1rem', sm: '1.2rem', md: '1.4rem' },
            color: 'rgba(255, 255, 255, 0.3)',
            fontWeight: 300,
            minHeight: { xs: '1.5rem', sm: '1.8rem' },
            transition: 'all 0.5s ease',
            lineHeight: 1.4,
          }}
        >
          {prevLine ? toTraditional(prevLine.text) : '\u00A0'}
        </Typography>

        {/* Current line — karaoke fill */}
        <Box
          key={animKey}
          sx={{
            fontSize: { xs: '1.8rem', sm: '2.4rem', md: '3rem' },
            fontWeight: 700,
            lineHeight: 1.3,
            minHeight: { xs: '2.5rem', sm: '3.2rem' },
            // Karaoke fill effect
            background: `linear-gradient(to right, ${accentColor} 50%, rgba(255, 255, 255, 0.4) 50%)`,
            backgroundSize: '200% 100%',
            backgroundPosition: '100% 0',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            animation: currentLine
              ? `morrorFill ${lineDuration}s linear forwards`
              : 'none',
            '@keyframes morrorFill': {
              '0%': { backgroundPosition: '100% 0' },
              '100%': { backgroundPosition: '0% 0' },
            },
            // Glow effect
            filter: `drop-shadow(0 0 20px ${accentColor}40)`,
            transition: 'filter 0.5s ease',
          }}
        >
          {currentLine ? toTraditional(currentLine.text) : '\u00A0'}
        </Box>

        {/* Next line */}
        <Typography
          sx={{
            fontSize: { xs: '1.1rem', sm: '1.3rem', md: '1.5rem' },
            color: 'rgba(255, 255, 255, 0.5)',
            fontWeight: 400,
            minHeight: { xs: '1.6rem', sm: '2rem' },
            transition: 'all 0.5s ease',
            lineHeight: 1.4,
          }}
        >
          {nextLine ? toTraditional(nextLine.text) : '\u00A0'}
        </Typography>
      </Box>

      {/* Subtle accent glow at bottom */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: '10%',
          right: '10%',
          height: '30%',
          background: `radial-gradient(ellipse at bottom, ${accentColor}15, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
    </Box>
  );
}
