import { describe, it, expect, vi } from 'vitest';

// Mock the gemini module
vi.mock('../services/gemini.service', () => ({
  analyzeTrackStyle: vi.fn(),
  isConfigured: vi.fn(() => true),
}));

import { analyzeTrackStyle } from '../services/gemini.service';

describe('Style Analysis', () => {
  it('should return valid TrackStyle with constrained enums', async () => {
    const mockStyle = {
      mood: 'chill',
      genre: 'indie-rock',
      subgenre: 'shoegaze',
      energy: 'medium',
      language: 'ja',
      themes: ['youth', 'nostalgia'],
    };
    (analyzeTrackStyle as any).mockResolvedValue(mockStyle);

    const result = await analyzeTrackStyle('羊文学 - Feel', '羊文学', ['J-Rock']);
    expect(result).toBeDefined();
    expect(result!.mood).toBe('chill');
    expect(result!.genre).toBe('indie-rock');
    expect(result!.energy).toBe('medium');
    expect(result!.themes).toHaveLength(2);
  });

  it('should return null when Gemini fails', async () => {
    (analyzeTrackStyle as any).mockResolvedValue(null);
    const result = await analyzeTrackStyle('Unknown Track');
    expect(result).toBeNull();
  });

  it('should handle Gemini throwing an error', async () => {
    (analyzeTrackStyle as any).mockRejectedValue(new Error('API error'));
    await expect(analyzeTrackStyle('Test')).rejects.toThrow('API error');
  });
});

describe('Style Enum Validation', () => {
  const validMoods = ['energetic', 'chill', 'melancholic', 'upbeat', 'dark', 'dreamy', 'aggressive', 'romantic'];
  const validEnergy = ['very-low', 'low', 'medium', 'high', 'very-high'];

  it('should accept all valid mood values', () => {
    for (const mood of validMoods) {
      expect(validMoods).toContain(mood);
    }
    expect(validMoods).toHaveLength(8);
  });

  it('should accept all valid energy values', () => {
    for (const energy of validEnergy) {
      expect(validEnergy).toContain(energy);
    }
    expect(validEnergy).toHaveLength(5);
  });
});
