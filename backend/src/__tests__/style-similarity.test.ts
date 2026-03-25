import { describe, it, expect } from 'vitest';
import { calculateStyleSimilarity, applyPlaybackSignalAdjustment } from '../services/style-similarity.service';
import type { CachedTrackStyle } from '../services/style-cache.service';

function makeStyle(overrides: Partial<CachedTrackStyle> = {}): CachedTrackStyle {
  return {
    videoId: 'test123',
    mood: 'chill',
    genre: 'indie-rock',
    subgenre: 'shoegaze',
    energy: 'medium',
    language: 'en',
    themes: ['love', 'nostalgia'],
    analyzedAt: Date.now(),
    ...overrides,
  };
}

describe('calculateStyleSimilarity', () => {
  it('should score high for identical styles', () => {
    const seed = makeStyle();
    const candidate = makeStyle({ videoId: 'other' });
    const { score } = calculateStyleSimilarity(seed, candidate, false);
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it('should score 0.5 for adjacent moods', () => {
    const seed = makeStyle({ mood: 'chill' });
    const candidate = makeStyle({ mood: 'dreamy', videoId: 'other' });
    const { score } = calculateStyleSimilarity(seed, candidate, false);
    expect(score).toBeGreaterThan(0.4);
  });

  it('should score 0 for opposite moods and different genre', () => {
    const seed = makeStyle({ mood: 'energetic', genre: 'metal', energy: 'very-high' });
    const candidate = makeStyle({ mood: 'melancholic', genre: 'classical', energy: 'very-low', themes: ['peace'], videoId: 'other' });
    const { score } = calculateStyleSimilarity(seed, candidate, false);
    expect(score).toBeLessThan(0.2);
  });

  it('should give cross-genre recommendation via mood match', () => {
    const seed = makeStyle({ mood: 'chill', genre: 'indie-rock' });
    const candidate = makeStyle({ mood: 'chill', genre: 'jazz', subgenre: 'smooth-jazz', videoId: 'other' });
    const { score } = calculateStyleSimilarity(seed, candidate, false);
    expect(score).toBeGreaterThan(0.3);
  });

  it('should add channel bonus', () => {
    const seed = makeStyle();
    const candidate = makeStyle({ videoId: 'other' });
    const withChannel = calculateStyleSimilarity(seed, candidate, true);
    const withoutChannel = calculateStyleSimilarity(seed, candidate, false);
    expect(withChannel.score).toBeGreaterThan(withoutChannel.score);
  });

  it('should include reason string', () => {
    const seed = makeStyle({ mood: 'chill' });
    const candidate = makeStyle({ mood: 'chill', videoId: 'other' });
    const { reason } = calculateStyleSimilarity(seed, candidate, false);
    expect(reason).toBeTruthy();
    expect(typeof reason).toBe('string');
  });

  it('should handle energy adjacency (one level apart = 0.5)', () => {
    const seed = makeStyle({ energy: 'medium' });
    const candidate = makeStyle({ energy: 'high', videoId: 'other' });
    const { score: adjacent } = calculateStyleSimilarity(seed, candidate, false);

    const far = makeStyle({ energy: 'very-high', videoId: 'far' });
    const { score: farScore } = calculateStyleSimilarity(seed, far, false);

    expect(adjacent).toBeGreaterThan(farScore);
  });
});

describe('applyPlaybackSignalAdjustment', () => {
  it('should not adjust when insufficient data', () => {
    expect(applyPlaybackSignalAdjustment(0.5, 1, 1)).toBe(0.5);
  });

  it('should penalize high skip ratio', () => {
    const adjusted = applyPlaybackSignalAdjustment(0.8, 10, 2);
    expect(adjusted).toBe(0.5); // 0.8 - 0.3
  });

  it('should bonus high complete ratio', () => {
    const adjusted = applyPlaybackSignalAdjustment(0.7, 1, 15);
    expect(adjusted).toBeCloseTo(0.8); // 0.7 + 0.1
  });

  it('should not go below 0', () => {
    const adjusted = applyPlaybackSignalAdjustment(0.2, 10, 1);
    expect(adjusted).toBe(0); // max(0, 0.2 - 0.3)
  });

  it('should not go above 1', () => {
    const adjusted = applyPlaybackSignalAdjustment(0.95, 0, 10);
    expect(adjusted).toBe(1); // min(1, 0.95 + 0.1)
  });
});
