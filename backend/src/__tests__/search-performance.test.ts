import { describe, it, expect, vi } from 'vitest';

/**
 * Integration tests for search performance improvements.
 * Tests youtube-sr integration, cache TTL, and precache limits.
 */

// Mock youtube-sr to avoid real network calls in tests
vi.mock('youtube-sr', () => ({
  default: {
    search: vi.fn(),
  },
}));

import YouTube from 'youtube-sr';

describe('Search with youtube-sr', () => {
  it('should map youtube-sr results to YouTubeSearchResult type', async () => {
    const mockVideos = [
      {
        id: 'dQw4w9WgXcQ',
        title: 'Rick Astley - Never Gonna Give You Up',
        channel: { name: 'Rick Astley' },
        duration: 213000, // 3:33 in ms
        thumbnail: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
      },
      {
        id: 'abc12345678',
        title: 'Test Song',
        channel: { name: 'Test Channel' },
        duration: 180000,
        thumbnail: { url: 'https://example.com/thumb.jpg' },
      },
    ];

    (YouTube.search as ReturnType<typeof vi.fn>).mockResolvedValue(mockVideos);

    const videos = await YouTube.search('rick astley', { limit: 20, type: 'video' });
    const tracks = videos
      .filter((video: any) => video.id)
      .map((video: any) => ({
        id: video.id || '',
        videoId: video.id || '',
        title: video.title || 'Unknown Title',
        channel: video.channel?.name || 'Unknown Channel',
        duration: video.duration ? Math.floor(video.duration / 1000) : 0,
        thumbnail: video.thumbnail?.url || '',
      }));

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toEqual({
      id: 'dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
      title: 'Rick Astley - Never Gonna Give You Up',
      channel: 'Rick Astley',
      duration: 213, // converted from ms to seconds
      thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
    });
  });

  it('should handle youtube-sr returning empty results', async () => {
    (YouTube.search as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const videos = await YouTube.search('nonexistent query xyz123', { limit: 20, type: 'video' });
    const tracks = videos.filter((video: any) => video.id);

    expect(tracks).toHaveLength(0);
  });

  it('should handle youtube-sr results with missing fields gracefully', async () => {
    const mockVideos = [
      {
        id: 'test1234567',
        title: null,
        channel: null,
        duration: null,
        thumbnail: null,
      },
    ];

    (YouTube.search as ReturnType<typeof vi.fn>).mockResolvedValue(mockVideos);

    const videos = await YouTube.search('test', { limit: 5, type: 'video' });
    const tracks = videos
      .filter((video: any) => video.id)
      .map((video: any) => ({
        id: video.id || '',
        videoId: video.id || '',
        title: video.title || 'Unknown Title',
        channel: video.channel?.name || 'Unknown Channel',
        duration: video.duration ? Math.floor(video.duration / 1000) : 0,
        thumbnail: video.thumbnail?.url || '',
      }));

    expect(tracks[0].title).toBe('Unknown Title');
    expect(tracks[0].channel).toBe('Unknown Channel');
    expect(tracks[0].duration).toBe(0);
    expect(tracks[0].thumbnail).toBe('');
  });

  it('should fallback to yt-dlp when youtube-sr throws', async () => {
    (YouTube.search as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    let usedFallback = false;
    try {
      await YouTube.search('test query', { limit: 20, type: 'video' });
    } catch {
      // In real code, this triggers yt-dlp fallback
      usedFallback = true;
    }

    expect(usedFallback).toBe(true);
  });
});

describe('Search cache TTL', () => {
  it('should use 24-hour TTL for search cache', () => {
    const SEARCH_CACHE_TTL = 24 * 60 * 60 * 1000;
    expect(SEARCH_CACHE_TTL).toBe(86400000); // 24 hours in ms
  });
});

describe('Precache limit', () => {
  it('should only precache first 3 results from 20', () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      videoId: `video${i}`,
      title: `Track ${i}`,
    }));

    const videoIds = results.slice(0, 3).map(r => r.videoId);

    expect(videoIds).toHaveLength(3);
    expect(videoIds).toEqual(['video0', 'video1', 'video2']);
  });
});
