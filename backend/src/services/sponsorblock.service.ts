import { getDatabase } from '../config/database';
import logger from '../utils/logger';

export interface SkipSegment {
  start: number;
  end: number;
  category: string;
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const API_BASE = 'https://sponsor.ajay.app/api';

class SponsorBlockService {
  constructor() {
    this.initTable();
  }

  private initTable(): void {
    try {
      const db = getDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS sponsorblock_cache (
          video_id TEXT PRIMARY KEY,
          segments_json TEXT NOT NULL,
          cached_at INTEGER NOT NULL
        )
      `);
    } catch {
      // DB 尚未初始化
    }
  }

  /**
   * 獲取影片的 skip segments（有快取就用快取）
   */
  async getSegments(videoId: string, categories?: string[]): Promise<SkipSegment[]> {
    // 1. 檢查快取
    const cached = this.getCached(videoId);
    if (cached !== null) return cached;

    // 2. 查 SponsorBlock API
    const cats = categories || ['music_offtopic', 'sponsor', 'intro', 'outro', 'selfpromo', 'interaction'];
    try {
      const url = `${API_BASE}/skipSegments?videoID=${videoId}&categories=${JSON.stringify(cats)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (res.status === 404) {
        // 無 segments，快取空結果
        this.saveCache(videoId, []);
        return [];
      }

      if (!res.ok) {
        console.warn(`⚠️ [SponsorBlock] API error ${res.status} for ${videoId}`);
        return [];
      }

      const data = await res.json() as any[];
      const segments: SkipSegment[] = data.map((item: any) => ({
        start: item.segment[0],
        end: item.segment[1],
        category: item.category,
      }));

      console.log(`✅ [SponsorBlock] ${videoId}: ${segments.length} segments found`);
      this.saveCache(videoId, segments);
      return segments;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn(`⚠️ [SponsorBlock] Timeout for ${videoId}`);
      } else {
        console.warn(`⚠️ [SponsorBlock] Fetch error for ${videoId}:`, err.message);
      }
      return [];
    }
  }

  private getCached(videoId: string): SkipSegment[] | null {
    try {
      const db = getDatabase();
      const row = db.prepare(
        'SELECT segments_json, cached_at FROM sponsorblock_cache WHERE video_id = ?'
      ).get(videoId) as { segments_json: string; cached_at: number } | undefined;

      if (!row) return null;
      if (Date.now() - row.cached_at > CACHE_TTL) return null;

      return JSON.parse(row.segments_json);
    } catch {
      return null;
    }
  }

  private saveCache(videoId: string, segments: SkipSegment[]): void {
    try {
      const db = getDatabase();
      db.prepare(
        `INSERT INTO sponsorblock_cache (video_id, segments_json, cached_at)
         VALUES (?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET segments_json = excluded.segments_json, cached_at = excluded.cached_at`
      ).run(videoId, JSON.stringify(segments), Date.now());
    } catch (err) {
      logger.warn('SponsorBlock cache save error:', err);
    }
  }
}

export const sponsorBlockService = new SponsorBlockService();
export default sponsorBlockService;
