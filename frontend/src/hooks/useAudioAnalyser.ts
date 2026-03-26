import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to connect an <audio> element to Web Audio API AnalyserNode.
 * Returns frequency data and waveform data arrays that update every frame.
 *
 * Usage:
 *   const { frequencyData, waveformData, averageFrequency } = useAudioAnalyser(audioElement, { fftSize: 256 });
 */

interface AnalyserOptions {
  fftSize?: number;       // FFT size (power of 2, 32-32768). Default 256 → 128 frequency bins
  smoothing?: number;     // Smoothing time constant (0-1). Default 0.8
  enabled?: boolean;      // Whether to run the analyser. Default true
}

interface AnalyserResult {
  frequencyData: Uint8Array;   // Frequency domain data (0-255 per bin)
  waveformData: Uint8Array;    // Time domain waveform data (0-255)
  averageFrequency: number;    // Average frequency value (0-255) for simple effects
  bassLevel: number;           // Low frequency energy (0-255) for beat detection
  subscribe: (callback: (data: AnalyserCallbackData) => void) => () => void;
}

interface AnalyserCallbackData {
  frequencyData: Uint8Array;
  waveformData: Uint8Array;
  averageFrequency: number;
  bassLevel: number;
}

// Singleton AudioContext (reused across components)
let sharedContext: AudioContext | null = null;
const sourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

function getAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

function getMediaSource(audio: HTMLAudioElement): MediaElementAudioSourceNode {
  if (sourceMap.has(audio)) {
    return sourceMap.get(audio)!;
  }
  const ctx = getAudioContext();
  const source = ctx.createMediaElementSource(audio);
  source.connect(ctx.destination); // Keep audio audible
  sourceMap.set(audio, source);
  return source;
}

export default function useAudioAnalyser(
  audioElement: HTMLAudioElement | null,
  options: AnalyserOptions = {}
): AnalyserResult {
  const { fftSize = 256, smoothing = 0.8, enabled = true } = options;

  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const frequencyDataRef = useRef<Uint8Array>(new Uint8Array(fftSize / 2));
  const waveformDataRef = useRef<Uint8Array>(new Uint8Array(fftSize / 2));
  const avgRef = useRef(0);
  const bassRef = useRef(0);
  const callbacksRef = useRef<Set<(data: AnalyserCallbackData) => void>>(new Set());

  // Subscribe to analyser updates
  const subscribe = useCallback((callback: (data: AnalyserCallbackData) => void) => {
    callbacksRef.current.add(callback);
    return () => { callbacksRef.current.delete(callback); };
  }, []);

  useEffect(() => {
    if (!audioElement || !enabled) return;

    let analyser: AnalyserNode;

    try {
      const ctx = getAudioContext();
      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const source = getMediaSource(audioElement);
      analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = smoothing;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Allocate data arrays
      const bufferLength = analyser.frequencyBinCount;
      frequencyDataRef.current = new Uint8Array(bufferLength);
      waveformDataRef.current = new Uint8Array(bufferLength);

      // Animation loop
      const tick = () => {
        if (!analyserRef.current) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (analyserRef.current as any).getByteFrequencyData(frequencyDataRef.current);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (analyserRef.current as any).getByteTimeDomainData(waveformDataRef.current);

        // Calculate average frequency
        const freqData = frequencyDataRef.current;
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
        }
        avgRef.current = sum / freqData.length;

        // Calculate bass level (first 10% of frequency bins = low frequencies)
        const bassRange = Math.max(1, Math.floor(freqData.length * 0.1));
        let bassSum = 0;
        for (let i = 0; i < bassRange; i++) {
          bassSum += freqData[i];
        }
        bassRef.current = bassSum / bassRange;

        // Notify subscribers
        if (callbacksRef.current.size > 0) {
          const data: AnalyserCallbackData = {
            frequencyData: frequencyDataRef.current,
            waveformData: waveformDataRef.current,
            averageFrequency: avgRef.current,
            bassLevel: bassRef.current,
          };
          callbacksRef.current.forEach(cb => cb(data));
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);

    } catch (err) {
      console.warn('⚠️ [AudioAnalyser] Failed to initialize:', err);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (analyserRef.current) {
        try { analyserRef.current.disconnect(); } catch {}
        analyserRef.current = null;
      }
    };
  }, [audioElement, fftSize, smoothing, enabled]);

  return {
    frequencyData: frequencyDataRef.current,
    waveformData: waveformDataRef.current,
    averageFrequency: avgRef.current,
    bassLevel: bassRef.current,
    subscribe,
  };
}
