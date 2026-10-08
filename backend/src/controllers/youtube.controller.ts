import { Request, Response } from 'express';
import { spawn } from 'child_process';
import { pipeline } from 'stream';
import { createAudioCacheWriter } from '../services/audio-cache-writer';
import { streamProgressiveAudio } from '../services/audio-progressive-response';
import { streamLiveAudio } from '../services/audio-live-response';
import type { AudioProgressiveSpool } from '../services/audio-progressive-spool';
import { AudioStreamOwner, audioStreamOwners, waitForAudioOwners, waitForAudioRetirement } from '../services/audio-stream-owner';
import youtubeService from '../services/youtube.service';
import audioCacheService from '../services/audio-cache.service';
import downloadManager from '../services/download-manager.service';
// Style analysis disabled to save Gemini quota
import logger from '../utils/logger';

export class YouTubeController {
  /**
   * Track in-flight yt-dlp stream processes per videoId to avoid duplicate spawns.
   * Requests for the same video wait for the current producer/cache owner;
   * a failed owner is replaced by at most one new producer at a time.
   */
  private inFlightStreams: Map<string, Promise<void>> = new Map();
  private inFlightSpools: Map<string, AudioProgressiveSpool> = new Map();
  private activeStreamOwners = 0;
  private waitingStreamAdmissions = 0;
  private inFlightOwners = audioStreamOwners;

  /**
   * GET /api/search?q=query&limit=20
   * 搜尋 YouTube 影片
   */
  async search(req: Request, res: Response): Promise<void> {
    try {
      const { q, limit } = req.query;

      if (!q || typeof q !== 'string') {
        res.status(400).json({
          error: 'Query parameter "q" is required',
        });
        return;
      }

      const limitNum = limit ? parseInt(limit as string, 10) : 20;
      const results = await youtubeService.search(q, limitNum);

      res.json({
        query: q,
        count: results.length,
        results,
      });

      // 搜尋結果返回後，背景預快取所有結果的音訊
      if (results.length > 0) {
        const videoIds = results.slice(0, 3).map(r => r.videoId);
        console.log(`📦 [Search] Triggering pre-cache for ${videoIds.length} search results`);
        downloadManager.precache(videoIds);

        // Style analysis disabled to save Gemini quota for translations
        // queueForAnalysis(...);
      }
    } catch (error) {
      logger.error('Search controller error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to search',
      });
    }
  }

  /**
   * GET /api/search/suggestions?q=query
   * YouTube 搜尋建議（autocomplete）
   */
  async searchSuggestions(req: Request, res: Response): Promise<void> {
    const { q } = req.query;
    if (!q || typeof q !== 'string' || q.trim().length < 1) {
      res.json([]);
      return;
    }

    try {
      const https = await import('https');
      const url = `https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&hl=zh-TW&gl=TW&q=${encodeURIComponent(q)}&ds=yt`;

      const data = await new Promise<string>((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
          let body = '';
          resp.on('data', (d: Buffer) => body += d);
          resp.on('end', () => resolve(body));
        }).on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      });

      // Response format: window.google.ac.h(["query",[["suggestion1"],["suggestion2"],...]])
      const match = data.match(/\[.*\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const suggestions: string[] = (parsed[1] || []).map((s: any) => s[0]).filter(Boolean).slice(0, 10);
        res.json(suggestions);
      } else {
        res.json([]);
      }
    } catch (error) {
      logger.error('Search suggestions error:', error);
      res.json([]);
    }
  }

  /**
   * GET /api/video/:videoId
   * 獲取影片資訊
   */
  async getVideoInfo(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;

      if (!videoId) {
        res.status(400).json({
          error: 'Video ID is required',
        });
        return;
      }

      const isValid = await youtubeService.validateVideoId(videoId);
      if (!isValid) {
        res.status(400).json({
          error: 'Invalid video ID',
        });
        return;
      }

      const info = await youtubeService.getVideoInfo(videoId);
      res.json(info);
    } catch (error) {
      logger.error('Get video info error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get video info',
      });
    }
  }

  /**
   * GET /api/stream/:videoId
   * 串流音訊 - 優先從伺服器快取讀取，否則使用 yt-dlp 直接串流
   */
  async streamAudio(req: Request, res: Response): Promise<void> {
    const { videoId } = req.params;
    try {
      if (!videoId || !(await youtubeService.validateVideoId(videoId))) {
        res.status(400).json({ error: 'Invalid video ID' });
        return;
      }
      while (!req.aborted && !res.destroyed && !res.writableEnded) {
        if (audioCacheService.has(videoId)) {
          this.streamFromCache(req, res, videoId);
          return;
        }
        const existing = this.inFlightOwners.get(videoId);
        if (existing) {
          const release = existing.acquireHTTP(req, res);
          if (!release) {
            if (!await this.waitForRetiredOwner(req, res, existing)) {
              if (!req.aborted && !res.destroyed) this.streamBusy(res);
              return;
            }
            continue;
          }
          const spool = this.inFlightSpools.get(videoId);
          try {
            if (spool) { await streamProgressiveAudio(req, res, spool); return; }
            // Legacy/no-spool owner still holds its path through cleanup.
            await waitForAudioOwners(req, res, [existing], 3000);
          } finally { release(); }
          continue;
        }
        // An explicit manager preload already owns this path. Its live spool
        // serves first bytes directly; never abort a still-owned cache producer.
        const background = downloadManager.getProgressiveJob?.(videoId);
        if (background) { await streamProgressiveAudio(req, res, background.spool); return; }
        if (this.activeStreamOwners >= 4) {
          if (!await this.waitForStreamCapacity(req, res)) {
            if (!req.aborted && !res.destroyed) this.streamBusy(res);
            return;
          }
          continue; // Recheck path/cache atomically before claiming a slot.
        }
        const retiringDownload = downloadManager.abortForVideoId(videoId);
        if (retiringDownload) {
          if (!await this.waitForDownloadRetirement(req, res, retiringDownload)) {
            if (!req.aborted && !res.destroyed) this.streamBusy(res);
            return;
          }
          if (req.aborted || res.destroyed) return;
          if (this.inFlightOwners.has(videoId) || audioCacheService.has(videoId) || this.activeStreamOwners >= 4) continue;
        }
        let resolveInFlight!: () => void;
        const completion = new Promise<void>(resolve => { resolveInFlight = resolve; });
        const owner = new AudioStreamOwner();
        const release = owner.acquireHTTP(req, res);
        if (!release) return;
        this.inFlightStreams.set(videoId, completion);
        this.inFlightOwners.set(videoId, owner);
        this.activeStreamOwners++;
        let released = false;
        const cleanup = () => {
          if (released) return;
          released = true;
          this.activeStreamOwners--;
          if (this.inFlightStreams.get(videoId) === completion) this.inFlightStreams.delete(videoId);
          if (this.inFlightOwners.get(videoId) === owner) this.inFlightOwners.delete(videoId);
          resolveInFlight();
          owner.finish();
        };
        try { this.streamWithYtDlp(req, res, videoId, cleanup, owner); }
        catch (error) { cleanup(); throw error; }
        return;
      }
    } catch (error) {
      logger.error('Stream controller error:', error);
      if (!res.headersSent && !res.destroyed) res.status(500).json({ error: 'Failed to stream audio' });
    }
  }

  private streamBusy(res: Response): void {
    res.setHeader('Retry-After', '2');
    res.status(503).json({ error: 'Audio stream capacity is busy', retryable: true });
  }

  private async waitForDownloadRetirement(req: Request, res: Response, completion: Promise<void>): Promise<boolean> {
    if (this.waitingStreamAdmissions >= 8) return false;
    this.waitingStreamAdmissions++;
    try { return await waitForAudioRetirement(req, res, completion, 3000); }
    finally { this.waitingStreamAdmissions--; }
  }

  private async waitForRetiredOwner(req: Request, res: Response, owner: AudioStreamOwner): Promise<boolean> {
    if (this.waitingStreamAdmissions >= 8) return false;
    this.waitingStreamAdmissions++;
    try {
      if (owner.finished) return true;
      const alive = await waitForAudioOwners(req, res, [owner], 3000);
      return alive && owner.finished;
    } finally { this.waitingStreamAdmissions--; }
  }

  private async waitForStreamCapacity(req: Request, res: Response): Promise<boolean> {
    if (this.waitingStreamAdmissions >= 8) return false;
    this.waitingStreamAdmissions++;
    const deadline = Date.now() + 3000;
    try {
      while (this.activeStreamOwners >= 4 && !req.aborted && !res.destroyed) {
        const idle = [...this.inFlightOwners.values()].filter(owner => owner.isIdle());
        if (!idle.length || Date.now() >= deadline) return false;
        idle.forEach(owner => owner.reclaim());
        const grace = idle.filter(owner => !owner.cancelling).map(owner => owner.idleDelayMs());
        const delay = Math.min(deadline - Date.now(), ...grace.filter(ms => ms > 0));
        if (!await waitForAudioOwners(req, res, idle, delay)) return false;
      }
      return !req.aborted && !res.destroyed;
    } finally { this.waitingStreamAdmissions--; }
  }

  /**
   * 使用 yt-dlp 直接串流音訊到客戶端，同時寫入快取
   */
  private streamWithYtDlp(req: Request, res: Response, videoId: string, onCacheWriteComplete?: () => void, owner?: AudioStreamOwner): void {
    const ytdlpPath = youtubeService.getYtDlpPath();
    const baseArgs = youtubeService.getYtDlpBaseArgs();

    const args = [
      ...baseArgs,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
      '-o', '-', // 輸出到 stdout
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    console.log(`🚀 [Stream] Spawning yt-dlp for: ${videoId}`);
    const ytdlp = spawn(ytdlpPath, args, { timeout: 300000, killSignal: 'SIGKILL' });
    let hasData = false;
    let stderrOutput = '';
    // Live playback starts before cache finalization/remux.
    // This extractor always emits the complete body from byte zero and answers
    // unknown-length Range requests with honest 200. Even Safari's initial
    // bytes=0-1 probe can share this one writer with the following media request.
    const cacheWriter = !audioCacheService.has(videoId)
      ? createAudioCacheWriter(ytdlp, audioCacheService.getCachePath(videoId),
        (file, signal) => audioCacheService.remuxIfNeeded(file, signal),
        { keepStreamingOnError: true })
      : null;
    let producerDone = false;
    let cacheDone = !cacheWriter;
    if (cacheWriter?.spool) this.inFlightSpools.set(videoId, cacheWriter.spool);
    const finishOwnership = () => {
      if (producerDone && cacheDone) {
        if (this.inFlightSpools.get(videoId) === cacheWriter?.spool) this.inFlightSpools.delete(videoId);
        onCacheWriteComplete?.();
      }
    };
    if (cacheWriter) {
      void cacheWriter.completion.then(() => { cacheDone = true; owner?.cacheCompleted(); finishOwnership(); });
    }
    owner?.setCancellation(() => { if (cacheWriter) cacheWriter.cancel(); else ytdlp.kill('SIGKILL'); });
    if (!cacheWriter) owner?.cacheCompleted();
    ytdlp.once('close', () => { producerDone = true; owner?.childClosed(); finishOwnership(); });
    ytdlp.stderr.on('data', (chunk: Buffer) => {
      stderrOutput = (stderrOutput + chunk.toString()).slice(-500);
    });
    ytdlp.stdout.on('data', () => { hasData = true; });
    streamLiveAudio(req, res, ytdlp);
    ytdlp.on('close', code => {
      if (code !== 0 || !hasData) {
        logger.error(`yt-dlp stream failed for ${videoId} (code ${code}): ${stderrOutput}`);
      }
    });

  }

  /**
   * POST /api/preload/:videoId
   * 預加載音訊 URL（觸發緩存但不等待完成）
   */
  async preloadAudio(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;

      if (!videoId) {
        res.status(400).json({
          error: 'Video ID is required',
        });
        return;
      }

      console.log(`🔄 開始預加載: ${videoId}`);
      logger.info(`Starting preload for: ${videoId}`);

      // Explicit cache intent leases the existing producer through finalization.
      const owner = this.inFlightOwners.get(videoId);
      if (owner?.retainCacheUntilCompletion()) {
        // The current path already has its sole writer.
      } else if (owner) {
        void owner.completion.then(() => downloadManager.precache([videoId]))
          .catch(error => logger.warn('Deferred audio preload failed:', error));
      } else downloadManager.precache([videoId]);

      // 立即返回，不等待完成
      res.status(202).json({
        message: 'Preload started',
        videoId
      });
    } catch (error) {
      logger.error('Preload controller error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preload audio',
      });
    }
  }

  /**
   * POST /api/preload-wait/:videoId
   * 預加載音訊 URL（等待完成，用於第一首）
   */
  async preloadAudioWait(req: Request, res: Response): Promise<void> {
    const { videoId } = req.params;

    try {
      if (!videoId) {
        res.status(400).json({
          error: 'Video ID is required',
        });
        return;
      }

      console.log(`⏳ 等待預加載: ${videoId}`);
      logger.info(`Waiting for preload: ${videoId}`);

      // 等待獲取 URL 完成
      await youtubeService.getAudioStreamUrl(videoId);

      console.log(`✅ 預加載完成: ${videoId}`);
      res.status(200).json({
        message: 'Preload completed',
        videoId
      });
    } catch (error) {
      console.error(`❌ 預加載失敗: ${videoId}`, error);
      logger.error('Preload-wait controller error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to preload audio',
      });
    }
  }

  /**
   * POST /api/prewarm-urls
   * 批量預熱音訊 URL（火即忘，立即返回 202）
   */
  async prewarmUrls(req: Request, res: Response): Promise<void> {
    try {
      const { videoIds } = req.body;

      if (!videoIds || !Array.isArray(videoIds)) {
        res.status(400).json({ error: 'videoIds array is required' });
        return;
      }

      // 限制最多 10 個
      const ids = videoIds.slice(0, 10).filter((id: any) => typeof id === 'string' && id.length === 11);

      if (ids.length > 0) {
        console.log(`🔥 [Prewarm] Warming ${ids.length} URL(s) in background`);
        // Fire-and-forget: 並行呼叫 getAudioStreamUrl 預熱快取
        for (const id of ids) {
          youtubeService.getAudioStreamUrl(id).catch(() => {});
        }
      }

      res.status(202).json({ message: 'Prewarm started', count: ids.length });
    } catch (error) {
      logger.error('Prewarm URLs error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to prewarm URLs',
      });
    }
  }

  /**
   * DELETE /api/cache/clear
   * 清空所有音訊快取
   */
  async clearCache(_req: Request, res: Response): Promise<void> {
    try {
      const result = audioCacheService.clearAll();
      res.json({
        success: true,
        message: `Cleared ${result.deletedCount} cache files (${result.deletedSizeMB} MB)`,
        deletedCount: result.deletedCount,
        deletedSizeMB: result.deletedSizeMB,
      });
    } catch (error) {
      logger.error('Clear cache error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clear cache',
      });
    }
  }

  /**
   * GET /api/cache/stats
   * 獲取音訊快取統計
   */
  async getCacheStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = audioCacheService.getStats();
      res.json({
        count: stats.totalFiles,
        size: Math.round(stats.totalSizeMB * 1024 * 1024),
      });
    } catch (error) {
      logger.error('Get cache stats error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get cache stats',
      });
    }
  }

  /**
   * GET /api/cache/status/:videoId
   * 檢查單一曲目的快取狀態
   */
  async getCacheStatus(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;

      if (!videoId) {
        res.status(400).json({ error: 'Video ID is required' });
        return;
      }

      const cached = audioCacheService.has(videoId);
      const downloading = audioCacheService.isDownloading(videoId);
      const progress = audioCacheService.getDownloadProgress(videoId);

      res.json({
        videoId,
        cached,
        downloading,
        progress,
      });
    } catch (error) {
      logger.error('Get cache status error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get cache status',
      });
    }
  }

  /**
   * POST /api/cache/status/batch
   * 批量檢查多個曲目的快取狀態
   */
  async getCacheStatusBatch(req: Request, res: Response): Promise<void> {
    try {
      const { videoIds } = req.body;

      if (!videoIds || !Array.isArray(videoIds)) {
        res.status(400).json({ error: 'videoIds array is required' });
        return;
      }

      const statusMap = audioCacheService.getCacheStatusBatch(videoIds);
      const result: Record<string, { cached: boolean; downloading: boolean; progress: unknown }> = {};

      statusMap.forEach((status, videoId) => {
        result[videoId] = status;
      });

      res.json(result);
    } catch (error) {
      logger.error('Get batch cache status error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get batch cache status',
      });
    }
  }

  /**
   * 從伺服器快取串流音訊（支援 Range requests）
   */
  private streamFromCache(req: Request, res: Response, videoId: string): void {
    const fileSize = audioCacheService.getFileSize(videoId);

    if (fileSize === null) {
      res.status(404).json({ error: 'Cache file not found' });
      return;
    }

    const range = req.headers.range;

    // 設定共用 headers
    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 快取 1 天

    if (range) {
      // 解析 Range header (例如: bytes=0-1024)
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return;
      }

      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = audioCacheService.createReadStream(videoId, { start, end });
      if (stream) {
        pipeline(stream, res, (err) => {
          if (err) {
            logger.error(`Cache stream pipeline error for ${videoId}:`, err);
            stream.destroy();
            res.destroy();
          }
        });
      } else {
        res.status(500).json({ error: 'Failed to create read stream' });
      }
    } else {
      // 沒有 Range request，返回完整檔案
      res.setHeader('Content-Length', fileSize);

      const stream = audioCacheService.createReadStream(videoId);
      if (stream) {
        pipeline(stream, res, (err) => {
          if (err) {
            logger.error(`Cache stream pipeline error for ${videoId}:`, err);
            stream.destroy();
            res.destroy();
          }
        });
      } else {
        res.status(500).json({ error: 'Failed to create read stream' });
      }
    }
  }
}

export default new YouTubeController();
