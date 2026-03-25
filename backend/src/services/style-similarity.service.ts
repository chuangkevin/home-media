import { CachedTrackStyle } from './style-cache.service';

// Mood adjacency matrix: adjacent moods score 0.5
const MOOD_ADJACENCY: Record<string, string[]> = {
  'energetic': ['upbeat', 'aggressive'],
  'upbeat': ['energetic', 'romantic'],
  'chill': ['dreamy'],
  'dreamy': ['chill', 'romantic'],
  'melancholic': ['dark'],
  'dark': ['melancholic', 'aggressive'],
  'aggressive': ['energetic', 'dark'],
  'romantic': ['dreamy', 'upbeat'],
};

// Energy levels ordered for adjacency comparison
const ENERGY_LEVELS = ['very-low', 'low', 'medium', 'high', 'very-high'];

/**
 * Calculate style-based similarity between two tracks.
 * Returns { score: 0-1, reason: string }
 */
export function calculateStyleSimilarity(
  seedStyle: CachedTrackStyle,
  candidateStyle: CachedTrackStyle,
  sameChannel: boolean
): { score: number; reason: string } {
  // 40% mood + energy
  const moodScore = getMoodScore(seedStyle.mood, candidateStyle.mood);
  const energyScore = getEnergyScore(seedStyle.energy, candidateStyle.energy);
  const moodEnergyScore = (moodScore + energyScore) / 2;

  // 30% genre match
  const genreScore = getGenreScore(
    seedStyle.genre, seedStyle.subgenre,
    candidateStyle.genre, candidateStyle.subgenre
  );

  // 20% theme overlap
  const themeScore = getThemeScore(seedStyle.themes, candidateStyle.themes);

  // 10% same channel bonus
  const channelScore = sameChannel ? 1.0 : 0;

  const totalScore = moodEnergyScore * 0.4 + genreScore * 0.3 + themeScore * 0.2 + channelScore * 0.1;

  // Build reason string
  const reasons: string[] = [];
  if (moodScore >= 0.5) reasons.push(`${candidateStyle.mood} mood`);
  if (genreScore >= 0.7) reasons.push(candidateStyle.subgenre || candidateStyle.genre);
  if (themeScore > 0) {
    const commonThemes = seedStyle.themes.filter(t => candidateStyle.themes.includes(t));
    if (commonThemes.length > 0) reasons.push(commonThemes.join(', '));
  }

  const reason = reasons.length > 0
    ? `Similar: ${reasons.join(' · ')}`
    : `Related ${candidateStyle.genre}`;

  return { score: totalScore, reason };
}

function getMoodScore(mood1: string, mood2: string): number {
  if (mood1 === mood2) return 1.0;
  const adjacent = MOOD_ADJACENCY[mood1] || [];
  if (adjacent.includes(mood2)) return 0.5;
  return 0;
}

function getEnergyScore(energy1: string, energy2: string): number {
  const idx1 = ENERGY_LEVELS.indexOf(energy1);
  const idx2 = ENERGY_LEVELS.indexOf(energy2);
  if (idx1 === -1 || idx2 === -1) return 0;
  const diff = Math.abs(idx1 - idx2);
  if (diff === 0) return 1.0;
  if (diff === 1) return 0.5;
  return 0;
}

function getGenreScore(genre1: string, subgenre1: string, genre2: string, subgenre2: string): number {
  const g1 = genre1.toLowerCase();
  const g2 = genre2.toLowerCase();
  const s1 = (subgenre1 || '').toLowerCase();
  const s2 = (subgenre2 || '').toLowerCase();

  if (g1 === g2 && s1 === s2 && s1 !== '') return 1.0;
  if (g1 === g2) return 0.7;
  return 0;
}

function getThemeScore(themes1: string[], themes2: string[]): number {
  if (!themes1.length || !themes2.length) return 0;
  const set1 = new Set(themes1.map(t => t.toLowerCase()));
  const set2 = new Set(themes2.map(t => t.toLowerCase()));
  const intersection = [...set1].filter(t => set2.has(t)).length;
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Apply skip/complete ratio adjustment to a score
 */
export function applyPlaybackSignalAdjustment(
  score: number,
  skipCount: number,
  completeCount: number
): number {
  const total = skipCount + completeCount;
  if (total < 3) return score; // Not enough data

  const skipRatio = skipCount / total;
  const completeRatio = completeCount / total;

  if (skipRatio > 0.7) return Math.max(0, score - 0.3);
  if (completeRatio > 0.8) return Math.min(1, score + 0.1);
  return score;
}
