import { useEffect, useState, useRef, useMemo } from 'react';
import { Box, Typography, IconButton, Chip, CircularProgress } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { LyricsLine } from '../../types/lyrics.types';
import type { Track } from '../../types/track.types';
import { extractDominantColor } from '../../utils/extractColor';
import { toTraditional } from '../../utils/chineseConvert';
import apiService from '../../services/api.service';
import useAudioAnalyser from '../../hooks/useAudioAnalyser';

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
  onFullscreenChange?: (isFullscreen: boolean) => void;
  translations?: string[];
  translationError?: boolean;
  isTranslating?: boolean;
  onRetryTranslation?: () => void;
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
                color: 'var(--lyrics-dim-color, rgba(255,255,255,0.35))',
                animation: `charFill ${charDelay * 1.2}s ease ${delay}s forwards`,
                '@keyframes charFill': {
                  '0%': { color: 'var(--lyrics-dim-color, rgba(255,255,255,0.35))' },
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
                color: 'var(--lyrics-dim-color, rgba(255,255,255,0.35))',
                transform: 'scale(1)',
                animation: `charScale ${charDelay * 1.5}s ease ${delay}s forwards`,
                '@keyframes charScale': {
                  '0%': { color: 'var(--lyrics-dim-color, rgba(255,255,255,0.35))', transform: 'scale(1)' },
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
                color: 'var(--lyrics-dim-color, rgba(255,255,255,0.35))',
                animation: `charWave ${charDelay * 1.2}s ease ${delay}s forwards`,
                '@keyframes charWave': {
                  '0%': { color: 'var(--lyrics-dim-color, rgba(255,255,255,0.35))' },
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

// Audio-reactive canvas visualizer behind lyrics
function AudioVisualizerCanvas({ accentColor, subscribe }: {
  accentColor: string;
  subscribe: (cb: (data: any) => void) => () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef({ frequencyData: new Uint8Array(128), bassLevel: 0, averageFrequency: 0 });

  useEffect(() => {
    const unsub = subscribe((data) => { dataRef.current = data; });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let zeroFrames = 0;
    let useSimulated = false;
    const simData = new Uint8Array(128);
    let simTime = 0;

    // 生成模擬頻譜（sine wave + noise，看起來像真的）
    const generateSimulated = () => {
      simTime += 0.03;
      for (let i = 0; i < simData.length; i++) {
        const freq = i / simData.length; // 0~1 低到高頻
        // 低頻強、高頻弱（像真實音樂）
        const base = (1 - freq * 0.7) * 120;
        // 多層 sine 波疊加
        const wave1 = Math.sin(simTime * 2 + i * 0.15) * 40;
        const wave2 = Math.sin(simTime * 3.7 + i * 0.3) * 25;
        const wave3 = Math.sin(simTime * 1.3 + i * 0.05) * 30;
        // 隨機噪音增加有機感
        const noise = (Math.random() - 0.5) * 20;
        simData[i] = Math.max(0, Math.min(255, base + wave1 + wave2 + wave3 + noise));
      }
      return { frequencyData: simData, bassLevel: simData[2] };
    };

    const draw = () => {
      const { width, height } = canvas;
      let { frequencyData, bassLevel } = dataRef.current;
      ctx.clearRect(0, 0, width, height);

      const binCount = frequencyData.length;
      if (binCount === 0) { raf = requestAnimationFrame(draw); return; }

      // 檢查是否有有效數據（CORS 限制會導致全零）
      const hasData = frequencyData.some((v: number) => v > 2);
      if (!hasData) {
        zeroFrames++;
        if (zeroFrames > 30) useSimulated = true;
      } else {
        zeroFrames = 0;
        useSimulated = false;
      }

      // 用模擬數據替代（手機 CORS 導致 Web Audio 全零時）
      if (useSimulated) {
        const sim = generateSimulated();
        frequencyData = sim.frequencyData;
        bassLevel = sim.bassLevel;
      }

      // Parse accent color for alpha blending
      const r = parseInt(accentColor.slice(1, 3), 16) || 68;
      const g = parseInt(accentColor.slice(3, 5), 16) || 136;
      const b = parseInt(accentColor.slice(5, 7), 16) || 255;

      // --- Layer 1: Frequency bars (bottom, mirrored from center) ---
      const barW = width / binCount;
      for (let i = 0; i < binCount; i++) {
        const val = frequencyData[i] / 255;
        const barH = val * height * 0.4;
        const alpha = val * 0.35;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        // Mirror from bottom-center
        const x = i * barW;
        ctx.fillRect(x, height - barH, barW - 1, barH);
      }

      // --- Layer 2: Center waveform glow (reactive to bass) ---
      const glowRadius = 80 + (bassLevel / 255) * 120;
      const glowAlpha = 0.05 + (bassLevel / 255) * 0.15;
      const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, glowRadius);
      gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${glowAlpha})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // --- Layer 3: Floating particles on beat ---
      if (bassLevel > 180) {
        for (let p = 0; p < 3; p++) {
          const px = Math.random() * width;
          const py = height * 0.3 + Math.random() * height * 0.4;
          const pr = 1 + Math.random() * 2;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.3 + Math.random() * 0.4})`;
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(draw);
    };

    // Handle resize
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const w = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 300;
      const h = canvas.offsetHeight || canvas.parentElement?.offsetHeight || 150;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    // 延遲 resize 確保 layout 完成
    requestAnimationFrame(() => { resize(); });
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [accentColor]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 1,
      }}
    />
  );
}

export default function MorrorLyrics({ lines, currentLineIndex, track, onFullscreenChange, translations = [], translationError = false, isTranslating = false, onRetryTranslation }: MorrorLyricsProps) {
  const [accentColor, setAccentColor] = useState(DEFAULT_COLOR);
  const [effect, setEffect] = useState<LyricsEffect>(() => {
    const saved = localStorage.getItem('morror-effect');
    return (saved as LyricsEffect) || 'karaoke';
  });
  const prevLineIndexRef = useRef(-1);
  const [animKey, setAnimKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [effectsReady, setEffectsReady] = useState(false);
  const isIOSStandalonePWA = (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1))
    && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);

  const toggleFullscreen = () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    onFullscreenChange?.(next);
  };

  // Get audio element for Web Audio API analyser
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  useEffect(() => {
    const el = document.querySelector('audio') as HTMLAudioElement | null;
    if (el) setAudioEl(el);
  }, []);
  const { subscribe } = useAudioAnalyser(audioEl, {
    fftSize: 256,
    enabled: effectsReady && !document.hidden && !isIOSStandalonePWA,
  });

  // 沉浸模式先用靜態畫面，延後再掛重型效果，避免切換瞬間卡住主音訊。
  useEffect(() => {
    setEffectsReady(false);
    const timer = setTimeout(() => {
      requestAnimationFrame(() => setEffectsReady(true));
    }, isIOSStandalonePWA ? 280 : 120);
    return () => clearTimeout(timer);
  }, [track.videoId, isIOSStandalonePWA]);

  // Save effect choice
  useEffect(() => {
    localStorage.setItem('morror-effect', effect);
  }, [effect]);

  // Fetch mood color or extract from thumbnail
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
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
    timer = setTimeout(loadColor, isIOSStandalonePWA ? 200 : 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
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

  // 字幕風格：白字黑邊，任何背景都可讀
  const textColorDim = 'rgba(255,255,255,0.5)';
  const textColorMid = 'rgba(255,255,255,0.7)';
  // 粗黑色描邊（2px）+ 陰影 = 任何背景都清晰可讀
  const textStroke = '-2px -2px 0 rgba(0,0,0,0.8), 2px -2px 0 rgba(0,0,0,0.8), -2px 2px 0 rgba(0,0,0,0.8), 2px 2px 0 rgba(0,0,0,0.8), 0 -2px 0 rgba(0,0,0,0.8), 0 2px 0 rgba(0,0,0,0.8), -2px 0 0 rgba(0,0,0,0.8), 2px 0 0 rgba(0,0,0,0.8)';
  const textShadowStrong = `${textStroke}, 0 3px 12px rgba(0,0,0,0.9)`;
  const textShadowLight = `${textStroke}, 0 1px 6px rgba(0,0,0,0.6)`;

  // Focus effect: blur prev/next more
  const isFocusMode = effect === 'focus';

  return (
    <Box ref={containerRef} sx={{
      position: 'relative',
      width: '100%', height: '100%',
      overflow: 'hidden',
      backgroundColor: '#000', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Background: blurred thumbnail */}
      {track.thumbnail && (
        <Box component="img" src={track.thumbnail} sx={{
          position: 'absolute', top: '-10%', left: '-10%', width: '120%', height: '120%',
          objectFit: 'cover', filter: 'blur(30px) saturate(1.4)', opacity: 0.55, pointerEvents: 'none',
        }} />
      )}

      {/* Dark overlay - subtle to keep vibrancy */}
      <Box sx={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', pointerEvents: 'none' }} />

      {/* Audio-reactive visualizer canvas */}
      <AudioVisualizerCanvas accentColor={accentColor} subscribe={subscribe} />

      {/* Controls overlay - top right (safe area aware for iPhone notch) */}
      <Box sx={{
        position: 'absolute',
        top: 'max(12px, env(safe-area-inset-top, 12px))',
        right: 8, zIndex: 3,
        display: 'flex', alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 2, px: 0.5, py: 0.25,
      }}>
        <IconButton size="small" onClick={() => cycleEffect(-1)} sx={{ color: 'rgba(255,255,255,0.7)', p: 0.5 }}>
          <NavigateBeforeIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', minWidth: 56, textAlign: 'center', fontSize: '0.7rem' }}>
          {EFFECT_LABELS[effect]}
        </Typography>
        <IconButton size="small" onClick={() => cycleEffect(1)} sx={{ color: 'rgba(255,255,255,0.7)', p: 0.5 }}>
          <NavigateNextIcon fontSize="small" />
        </IconButton>
        <Box sx={{ width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.2)', mx: 0.5 }} />
        <IconButton size="small" onClick={toggleFullscreen} sx={{ color: 'rgba(255,255,255,0.7)', p: 0.5 }}>
          {isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
        </IconButton>
      </Box>

      {/* Lyrics content */}
      <Box sx={{
        position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: { xs: 3, sm: 4, md: 5 }, px: { xs: 3, sm: 5, md: 8 },
        maxWidth: 900, width: '100%', textAlign: 'center',
        '--lyrics-dim-color': textColorDim,
      } as any}>
        {/* Previous line */}
        <Typography sx={{
          fontSize: { xs: '1rem', sm: '1.2rem', md: '1.4rem' },
          color: textColorDim, fontWeight: 300, lineHeight: 1.4, textShadow: textShadowLight,
          minHeight: { xs: '1.5rem', sm: '1.8rem' },
          transition: 'all 0.5s ease',
          filter: isFocusMode ? 'blur(1.5px)' : 'none',
        }}>
          {prevLine ? toTraditional(prevLine.text) : '\u00A0'}
        </Typography>

        {/* Current line */}
        <Box key={animKey} sx={{
          fontSize: { xs: '1.8rem', sm: '2.4rem', md: '3rem' },
          fontWeight: 700, lineHeight: 1.3,
          minHeight: { xs: '2.5rem', sm: '3.2rem' },
          textShadow: textShadowStrong,
          filter: isFocusMode ? 'none' : `drop-shadow(0 0 20px ${accentColor}40)`,
          transition: 'filter 0.5s ease',
          ...(isFocusMode && {
            color: accentColor,
            transform: 'scale(1.05)',
            textShadow: `${textShadowStrong}, 0 0 30px ${accentColor}50`,
          }),
        }}>
          {renderCurrentLine()}
          {/* 當前行翻譯 */}
          {currentLineIndex >= 0 && translations[currentLineIndex] && (
            <Typography sx={{
              fontSize: { xs: '1.3rem', sm: '1.5rem', md: '1.7rem' },
              color: `${accentColor}CC`,
              fontWeight: 400, fontStyle: 'italic',
              mt: 0.5, lineHeight: 1.3,
              textShadow: textShadowLight,
            }}>
              {translations[currentLineIndex]}
            </Typography>
          )}
          {/* 翻譯重試 */}
          {translationError && !isTranslating && translations.length === 0 && onRetryTranslation && (
            <Chip
              icon={<RefreshIcon sx={{ color: 'white !important' }} />}
              label="重試翻譯"
              onClick={onRetryTranslation}
              variant="outlined"
              size="small"
              sx={{
                mt: 1,
                color: 'white',
                borderColor: 'rgba(255,255,255,0.5)',
                textShadow: textShadowLight,
                cursor: 'pointer',
                '&:hover': { borderColor: 'white', backgroundColor: 'rgba(255,255,255,0.1)' },
              }}
            />
          )}
          {isTranslating && translations.length === 0 && (
            <CircularProgress size={18} sx={{ mt: 1, color: 'rgba(255,255,255,0.6)' }} />
          )}
        </Box>

        {/* Next line */}
        <Typography sx={{
          fontSize: { xs: '1.1rem', sm: '1.3rem', md: '1.5rem' },
          color: textColorMid, fontWeight: 400, lineHeight: 1.4, textShadow: textShadowLight,
          minHeight: { xs: '1.6rem', sm: '2rem' },
          transition: 'all 0.5s ease',
          filter: isFocusMode ? 'blur(1px)' : 'none',
        }}>
          {nextLine ? toTraditional(nextLine.text) : '\u00A0'}
        </Typography>
      </Box>

      {/* Bottom glow */}
      <Box sx={{
        position: 'absolute', bottom: 0, left: '10%', right: '10%', height: '30%',
        background: `radial-gradient(ellipse at bottom, ${accentColor}30, transparent 70%)`,
        pointerEvents: 'none',
      }} />
    </Box>
  );
}
