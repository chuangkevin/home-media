import { useEffect, useState, useRef, useMemo } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import type { LyricsLine } from '../../types/lyrics.types';
import type { Track } from '../../types/track.types';
import { extractDominantColor } from '../../utils/extractColor';
import { toTraditional } from '../../utils/chineseConvert';
import apiService from '../../services/api.service';

// Mood → accent color
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

type LyricsEffect = 'karaoke' | 'scale' | 'typewriter' | 'neon' | 'wave' | 'focus';

const EFFECT_LABELS: Record<LyricsEffect, string> = {
  karaoke: '逐字填色',
  scale: '逐字放大',
  typewriter: '打字機',
  neon: '霓虹燈',
  wave: '漸層波浪',
  focus: '模糊聚焦',
};

const EFFECTS: LyricsEffect[] = ['karaoke', 'scale', 'typewriter', 'neon', 'wave', 'focus'];

interface MorrorLyricsProps {
  lines: LyricsLine[];
  currentLineIndex: number;
  track: Track;
  timeOffset: number;
}

// Split text into characters for per-char animation
function CharByChar({ text, duration, accentColor, effect }: {
  text: string;
  duration: number;
  accentColor: string;
  effect: LyricsEffect;
}) {
  const chars = text.split('');
  const charDelay = duration / Math.max(chars.length, 1);

  return (
    <Box component="span" sx={{ display: 'inline' }}>
      {chars.map((char, i) => {
        const delay = i * charDelay;

        if (effect === 'karaoke') {
          return (
            <Box
              component="span"
              key={i}
              sx={{
                display: 'inline',
                color: 'rgba(255,255,255,0.35)',
                animation: `charFill ${charDelay * 1.2}s ease ${delay}s forwards`,
                '@keyframes charFill': {
                  '0%': { color: 'rgba(255,255,255,0.35)' },
                  '100%': { color: accentColor },
                },
              }}
            >
              {char}
            </Box>
          );
        }

        if (effect === 'scale') {
          return (
            <Box
              component="span"
              key={i}
              sx={{
                display: 'inline-block',
                color: 'rgba(255,255,255,0.35)',
                transform: 'scale(1)',
                animation: `charScale ${charDelay * 1.5}s ease ${delay}s forwards`,
                '@keyframes charScale': {
                  '0%': { color: 'rgba(255,255,255,0.35)', transform: 'scale(1)' },
                  '50%': { color: accentColor, transform: 'scale(1.3)' },
                  '100%': { color: accentColor, transform: 'scale(1)', textShadow: `0 0 12px ${accentColor}80` },
                },
              }}
            >
              {char === ' ' ? '\u00A0' : char}
            </Box>
          );
        }

        if (effect === 'typewriter') {
          return (
            <Box
              component="span"
              key={i}
              sx={{
                display: 'inline',
                opacity: 0,
                animation: `charType 0.05s ease ${delay}s forwards`,
                color: accentColor,
                '@keyframes charType': {
                  '0%': { opacity: 0 },
                  '100%': { opacity: 1 },
                },
              }}
            >
              {char}
            </Box>
          );
        }

        if (effect === 'wave') {
          const hueShift = (i / chars.length) * 60; // 60 degree range
          return (
            <Box
              component="span"
              key={i}
              sx={{
                display: 'inline',
                color: 'rgba(255,255,255,0.35)',
                animation: `charWave ${charDelay * 1.2}s ease ${delay}s forwards`,
                '@keyframes charWave': {
                  '0%': { color: 'rgba(255,255,255,0.35)' },
                  '100%': { color: `hsl(${parseInt(accentColor.slice(1), 16) % 360 + hueShift}, 80%, 65%)` },
                },
              }}
            >
              {char}
            </Box>
          );
        }

        // Default: just show the char
        return <span key={i}>{char}</span>;
      })}
    </Box>
  );
}

export default function MorrorLyrics({ lines, currentLineIndex, track }: MorrorLyricsProps) {
  const [accentColor, setAccentColor] = useState(DEFAULT_COLOR);
  const [effect, setEffect] = useState<LyricsEffect>(() => {
    const saved = localStorage.getItem('morror-effect');
    return (saved as LyricsEffect) || 'karaoke';
  });
  const prevLineIndexRef = useRef(-1);
  const [animKey, setAnimKey] = useState(0);

  // Save effect choice
  useEffect(() => {
    localStorage.setItem('morror-effect', effect);
  }, [effect]);

  // Fetch mood color or extract from thumbnail
  useEffect(() => {
    let cancelled = false;
    async function loadColor() {
      try {
        const res = await apiService.getTrackStyle(track.videoId);
        if (!cancelled && res?.mood && moodColors[res.mood]) {
          setAccentColor(moodColors[res.mood]);
          return;
        }
      } catch { /* continue */ }

      if (track.thumbnail) {
        const color = await extractDominantColor(track.thumbnail, track.videoId);
        if (!cancelled && color) { setAccentColor(color); return; }
      }
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

  const lineDuration = useMemo(() => {
    if (currentLineIndex < 0 || currentLineIndex >= lines.length) return DEFAULT_LINE_DURATION;
    const cur = lines[currentLineIndex].time;
    const next = currentLineIndex + 1 < lines.length ? lines[currentLineIndex + 1].time : cur + DEFAULT_LINE_DURATION;
    return Math.max(0.5, Math.min(next - cur, 15));
  }, [currentLineIndex, lines]);

  const prevLine = currentLineIndex > 0 ? lines[currentLineIndex - 1] : null;
  const currentLine = currentLineIndex >= 0 && currentLineIndex < lines.length ? lines[currentLineIndex] : null;
  const nextLine = currentLineIndex + 1 < lines.length ? lines[currentLineIndex + 1] : null;

  const cycleEffect = (dir: 1 | -1) => {
    const idx = EFFECTS.indexOf(effect);
    const next = (idx + dir + EFFECTS.length) % EFFECTS.length;
    setEffect(EFFECTS[next]);
  };

  // Render current line based on effect
  const renderCurrentLine = () => {
    if (!currentLine) return '\u00A0';
    const text = toTraditional(currentLine.text);

    // Per-character effects
    if (effect === 'karaoke' || effect === 'scale' || effect === 'typewriter' || effect === 'wave') {
      return <CharByChar text={text} duration={lineDuration} accentColor={accentColor} effect={effect} />;
    }

    // Neon: whole line glow pulse
    if (effect === 'neon') {
      return (
        <Box component="span" sx={{
          color: accentColor,
          animation: `neonPulse 1.5s ease-in-out infinite`,
          '@keyframes neonPulse': {
            '0%, 100%': { textShadow: `0 0 10px ${accentColor}60, 0 0 20px ${accentColor}40, 0 0 40px ${accentColor}20` },
            '50%': { textShadow: `0 0 20px ${accentColor}90, 0 0 40px ${accentColor}60, 0 0 80px ${accentColor}30` },
          },
        }}>
          {text}
        </Box>
      );
    }

    // Focus: current line is clear, already handled by wrapper
    return text;
  };

  // Focus effect: blur prev/next more
  const isFocusMode = effect === 'focus';

  return (
    <Box sx={{
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
      backgroundColor: '#000', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Background: blurred thumbnail */}
      {track.thumbnail && (
        <Box component="img" src={track.thumbnail} sx={{
          position: 'absolute', top: '-10%', left: '-10%', width: '120%', height: '120%',
          objectFit: 'cover', filter: 'blur(40px)', opacity: 0.3, pointerEvents: 'none',
        }} />
      )}

      {/* Dark overlay */}
      <Box sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

      {/* Effect selector - top right */}
      <Box sx={{
        position: 'absolute', top: 8, right: 8, zIndex: 3,
        display: 'flex', alignItems: 'center', gap: 0.5,
        backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 2, px: 0.5, py: 0.25,
      }}>
        <IconButton size="small" onClick={() => cycleEffect(-1)} sx={{ color: 'rgba(255,255,255,0.7)', p: 0.5 }}>
          <NavigateBeforeIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', minWidth: 60, textAlign: 'center', fontSize: '0.7rem' }}>
          {EFFECT_LABELS[effect]}
        </Typography>
        <IconButton size="small" onClick={() => cycleEffect(1)} sx={{ color: 'rgba(255,255,255,0.7)', p: 0.5 }}>
          <NavigateNextIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Lyrics content */}
      <Box sx={{
        position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: { xs: 3, sm: 4, md: 5 }, px: { xs: 3, sm: 5, md: 8 },
        maxWidth: 900, width: '100%', textAlign: 'center',
      }}>
        {/* Previous line */}
        <Typography sx={{
          fontSize: { xs: '1rem', sm: '1.2rem', md: '1.4rem' },
          color: 'rgba(255,255,255,0.3)', fontWeight: 300, lineHeight: 1.4,
          minHeight: { xs: '1.5rem', sm: '1.8rem' },
          transition: 'all 0.5s ease',
          filter: isFocusMode ? 'blur(3px)' : 'none',
        }}>
          {prevLine ? toTraditional(prevLine.text) : '\u00A0'}
        </Typography>

        {/* Current line */}
        <Box key={animKey} sx={{
          fontSize: { xs: '1.8rem', sm: '2.4rem', md: '3rem' },
          fontWeight: 700, lineHeight: 1.3,
          minHeight: { xs: '2.5rem', sm: '3.2rem' },
          filter: isFocusMode ? 'none' : `drop-shadow(0 0 20px ${accentColor}40)`,
          transition: 'filter 0.5s ease',
          // Focus mode: scale up slightly
          ...(isFocusMode && {
            color: accentColor,
            transform: 'scale(1.05)',
            textShadow: `0 0 30px ${accentColor}50`,
          }),
        }}>
          {renderCurrentLine()}
        </Box>

        {/* Next line */}
        <Typography sx={{
          fontSize: { xs: '1.1rem', sm: '1.3rem', md: '1.5rem' },
          color: 'rgba(255,255,255,0.5)', fontWeight: 400, lineHeight: 1.4,
          minHeight: { xs: '1.6rem', sm: '2rem' },
          transition: 'all 0.5s ease',
          filter: isFocusMode ? 'blur(2px)' : 'none',
        }}>
          {nextLine ? toTraditional(nextLine.text) : '\u00A0'}
        </Typography>
      </Box>

      {/* Bottom glow */}
      <Box sx={{
        position: 'absolute', bottom: 0, left: '10%', right: '10%', height: '30%',
        background: `radial-gradient(ellipse at bottom, ${accentColor}15, transparent 70%)`,
        pointerEvents: 'none',
      }} />
    </Box>
  );
}
