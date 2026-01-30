import { Request, Response } from 'express';
import fs from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream';
import youtubeService from '../services/youtube.service';
import audioCacheService from '../services/audio-cache.service';
import logger from '../utils/logger';

export class YouTubeController {
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
        const videoIds = results.map(r => r.videoId);
        console.log(`📦 [Search] Triggering pre-cache for ${videoIds.length} search results`);
        audioCacheService.precacheVideos(videoIds).catch((err) => {
          console.warn('⚠️ [Search] Pre-cache batch failed:', err);
        });
      }
    } catch (error) {
      logger.error('Search controller error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to search',
      });
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
      if (!videoId) {
        res.status(400).json({ error: 'Video ID is required' });
        return;
      }

      const isValid = await youtubeService.validateVideoId(videoId);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid video ID' });
        return;
      }

      // 檢查伺服器端快取
      if (audioCacheService.has(videoId)) {
        console.log(`🎵 [Stream] Serving from server cache: ${videoId}`);
        logger.info(`Streaming audio for video: ${videoId} from server cache`);
        this.streamFromCache(req, res, videoId);
        return;
      }

      // 使用 yt-dlp 直接串流（避免 403）
      console.log(`🎵 [Stream] yt-dlp direct stream: ${videoId}`);
      logger.info(`Streaming audio for video: ${videoId} via yt-dlp direct`);
      this.streamWithYtDlp(req, res, videoId);

    } catch (error) {
      logger.error('Stream controller error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to stream audio',
        });
      }
    }
  }

  /**
   * 使用 yt-dlp 直接串流音訊到客戶端，同時寫入快取
   */
  private streamWithYtDlp(req: Request, res: Response, videoId: string): void {
    const ytdlpPath = youtubeService.getYtDlpPath();
    const baseArgs = youtubeService.getYtDlpBaseArgs();

    const args = [
      ...baseArgs,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
      '-o', '-', // 輸出到 stdout
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    console.log(`🚀 [Stream] Spawning yt-dlp for: ${videoId}`);
    const ytdlp = spawn(ytdlpPath, args);

    let headersSent = false;
    let hasData = false;
    let stderrOutput = '';

    // 準備快取寫入
    const cachePath = audioCacheService.getCachePath(videoId);
    const tempPath = `${cachePath}.tmp`;
    let cacheStream: fs.WriteStream | null = null;

    // 不是 Range request 時才寫入快取
    if (!req.headers.range) {
      cacheStream = fs.createWriteStream(tempPath);
      cacheStream.on('error', (err) => {
        logger.error(`Cache write error for ${videoId}:`, err);
        cacheStream = null;
      });
    }

    // 收集 stderr（yt-dlp 的進度/錯誤資訊）
    ytdlp.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    // 當有 stdout 數據時
    ytdlp.stdout.on('data', (chunk: Buffer) => {
      hasData = true;

      // 第一次收到數據時發送 headers
      if (!headersSent) {
        headersSent = true;
        res.status(200);
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
        res.setHeader('Cache-Control', 'no-cache');
      }

      // 寫入 HTTP response
      if (!res.writableEnded) {
        res.write(chunk);
      }

      // 同時寫入快取檔案
      if (cacheStream && !cacheStream.destroyed) {
        cacheStream.write(chunk);
      }
    });

    // stdout 結束
    ytdlp.stdout.on('end', () => {
      // 只有收到資料才結束 response；沒資料時讓 close 事件處理錯誤
      if (hasData && !res.writableEnded) {
        res.end();
      }

      // 完成快取寫入
      if (cacheStream && !cacheStream.destroyed) {
        cacheStream.end(() => {
          if (hasData && fs.existsSync(tempPath)) {
            try {
              const stats = fs.statSync(tempPath);
              if (stats.size > 0) {
                fs.renameSync(tempPath, cachePath);
                console.log(`💾 [Stream] Cached: ${videoId} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
              } else {
                fs.unlinkSync(tempPath);
              }
            } catch (err) {
              logger.error(`Cache rename error for ${videoId}:`, err);
              try { fs.unlinkSync(tempPath); } catch {}
            }
          }
        });
      }
    });

    // yt-dlp 進程結束
    ytdlp.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ [Stream] yt-dlp failed (code ${code}) for ${videoId}: ${stderrOutput.slice(-500)}`);
        logger.error(`yt-dlp stream failed for ${videoId} (code ${code}): ${stderrOutput.slice(-500)}`);

        // 如果還沒發送任何數據，返回錯誤
        if (!headersSent && !res.headersSent) {
          res.status(500).json({
            error: 'Failed to stream audio',
            details: stderrOutput.slice(-200),
          });
        } else if (!res.writableEnded) {
          res.end();
        }

        // 清理快取臨時檔案
        if (cacheStream) {
          cacheStream.destroy();
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        }
      } else if (!hasData) {
        // yt-dlp 正常結束但沒有產出資料
        console.error(`❌ [Stream] yt-dlp produced no output for ${videoId}: ${stderrOutput.slice(-300)}`);
        if (!res.headersSent) {
          res.status(500).json({
            error: 'No audio data received',
            details: stderrOutput.slice(-200),
          });
        } else if (!res.writableEnded) {
          res.end();
        }
        // 清理空的快取臨時檔案
        if (cacheStream) {
          cacheStream.destroy();
          try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        }
      }
    });

    // yt-dlp spawn 錯誤
    ytdlp.on('error', (err) => {
      console.error(`❌ [Stream] yt-dlp spawn error for ${videoId}:`, err);
      logger.error(`yt-dlp spawn error for ${videoId}:`, err);

      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start audio stream' });
      }

      if (cacheStream) {
        cacheStream.destroy();
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
      }
    });

    // 客戶端斷開時，殺掉 yt-dlp 進程
    // 但如果快取正在寫入，繼續寫完
    req.on('close', () => {
      if (!ytdlp.killed) {
        // 如果已經有數據且正在寫入快取，不殺進程（讓它完成快取）
        // 否則殺掉以節省資源
        if (!cacheStream || !hasData) {
          ytdlp.kill('SIGTERM');
        }
        // 如果有 cacheStream，讓 yt-dlp 繼續執行以完成快取
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

      // 在背景獲取 URL（會觸發緩存）
      youtubeService.getAudioStreamUrl(videoId)
        .then(() => {
          console.log(`✅ 預加載完成: ${videoId}`);
        })
        .catch((error) => {
          console.error(`❌ 預加載失敗: ${videoId}`, error);
          logger.error(`Preload failed for ${videoId}:`, error);
        });

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
   * GET /api/cache/stats
   * 獲取音訊快取統計
   */
  async getCacheStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = audioCacheService.getStats();
      res.json(stats);
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
    res.setHeader('Content-Type', 'audio/webm');
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
