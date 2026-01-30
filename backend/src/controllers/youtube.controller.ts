import { Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { pipeline } from 'stream';
import { URL } from 'url';
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
   * 串流音訊 - 優先從伺服器快取讀取，否則代理並背景下載
   */
  async streamAudio(req: Request, res: Response): Promise<void> {
    const { videoId } = req.params;
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelays = [1000, 3000, 5000]; // 指數退避延遲
    const requestTimeout = 60000; // 60 秒請求超時

    const attemptStream = async (): Promise<void> => {
      try {
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

        // 檢查伺服器端快取
        if (audioCacheService.has(videoId)) {
          console.log(`🎵 [Stream] Serving from server cache: ${videoId}`);
          logger.info(`Streaming audio for video: ${videoId} from server cache`);
          this.streamFromCache(req, res, videoId);
          return;
        }

        logger.info(`Streaming audio for video: ${videoId} via proxy (attempt ${retryCount + 1})`);
        console.log(`🌐 [Stream] Proxying from network: ${videoId}`);

        // 使用 yt-dlp 獲取音訊 URL
        const audioUrl = await youtubeService.getAudioStreamUrl(videoId);

        // 準備代理請求的 headers
        const proxyHeaders: any = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com',
        };

        // 支援 Range requests（讓瀏覽器可以 seek）
        if (req.headers.range) {
          proxyHeaders['Range'] = req.headers.range;
        }

        // 發起代理請求（自動處理重定向）
        const makeProxyRequest = (url: string, redirectCount = 0): void => {
          if (redirectCount > 5) {
            logger.error(`Too many redirects for ${videoId}`);
            if (!res.headersSent) {
              res.status(500).json({ error: 'Too many redirects' });
            }
            return;
          }

          const parsedRedirectUrl = new URL(url);
          const redirectHttpModule = parsedRedirectUrl.protocol === 'https:' ? https : http;

          const proxyReq = redirectHttpModule.get(
            url,
            {
              headers: proxyHeaders,
            },
            (proxyRes) => {
              // 處理重定向
              if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 303 || proxyRes.statusCode === 307 || proxyRes.statusCode === 308) {
                const location = proxyRes.headers.location;
                if (location) {
                  logger.info(`Following redirect for ${videoId}: ${proxyRes.statusCode} -> ${location}`);
                  proxyRes.resume(); // 消耗響應體
                  makeProxyRequest(location, redirectCount + 1);
                  return;
                }
              }

              // 處理 403 錯誤（URL 過期）- 清除緩存並使用指數退避重試
              if (proxyRes.statusCode === 403 && retryCount < maxRetries) {
                const delay = retryDelays[retryCount] || 5000;
                logger.warn(`Got 403 for ${videoId}, retry in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
                console.log(`⚠️ URL 過期 (403): ${videoId}，${delay}ms 後重試 (${retryCount + 1}/${maxRetries})...`);
                proxyRes.resume(); // 消耗響應體
                youtubeService.clearUrlCache(videoId);
                retryCount++;
                setTimeout(() => attemptStream(), delay);
                return;
              }

              // 處理 5xx 伺服器錯誤 - 重試
              if (proxyRes.statusCode && proxyRes.statusCode >= 500 && retryCount < maxRetries) {
                const delay = retryDelays[retryCount] || 5000;
                logger.warn(`Got ${proxyRes.statusCode} for ${videoId}, retry in ${delay}ms`);
                console.log(`⚠️ 伺服器錯誤 (${proxyRes.statusCode}): ${videoId}，${delay}ms 後重試...`);
                proxyRes.resume();
                retryCount++;
                setTimeout(() => attemptStream(), delay);
                return;
              }

              // 轉發狀態碼
              res.status(proxyRes.statusCode || 200);

              // 轉發重要的 headers
              // 注意：不轉發 content-length，因為 YouTube 連線可能中斷（ECONNRESET）
              // 使用 chunked transfer encoding 代替，避免 ERR_CONTENT_LENGTH_MISMATCH
              const headersToForward = [
                'content-type',
                // 'content-length', // 故意不轉發，改用 chunked transfer
                'content-range',
                'accept-ranges',
                'cache-control',
                'etag',
                'last-modified',
              ];

              headersToForward.forEach((header) => {
                const value = proxyRes.headers[header];
                if (value) {
                  res.setHeader(header, value);
                }
              });

              // 使用 chunked transfer encoding
              res.setHeader('Transfer-Encoding', 'chunked');

              // 如果沒有 accept-ranges，添加它（支援 seek）
              if (!proxyRes.headers['accept-ranges']) {
                res.setHeader('Accept-Ranges', 'bytes');
              }

              // 啟用 CORS
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

              logger.info(`Proxying audio stream for ${videoId} (status: ${proxyRes.statusCode})`);

              // 背景下載到伺服器快取（不阻塞串流）
              // 只有非 Range request 才下載完整檔案
              if (!req.headers.range) {
                audioCacheService.downloadAndCache(videoId, audioUrl)
                  .then((cachePath) => {
                    if (cachePath) {
                      console.log(`💾 [Stream] Background cache completed: ${videoId}`);
                    }
                  })
                  .catch((err) => {
                    console.warn(`⚠️ [Stream] Background cache failed: ${videoId}`, err);
                  });
              }

              // 使用 pipeline 安全地串流數據，它會自動處理錯誤和清理
              pipeline(proxyRes, res, (err) => {
                if (err) {
                  // ECONNRESET 經常發生，當客戶端在串流結束前斷開連接
                  // 我們可以安全地忽略它，因為請求已經結束
                  if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
                    logger.warn(`Client disconnected prematurely for ${videoId}: ${err.message}`);
                  } else {
                    logger.error(`Stream pipeline error for ${videoId}:`, err);
                  }
                  // 確保在發生任何錯誤時銷毀兩個串流
                  proxyRes.destroy();
                  if (!res.writableEnded) {
                    res.destroy();
                  }
                }
              });
            }
          );

          // 設置請求超時
          proxyReq.setTimeout(requestTimeout, () => {
            logger.error(`Request timeout for ${videoId} after ${requestTimeout}ms`);
            console.log(`⏱️ 請求超時: ${videoId}`);
            proxyReq.destroy();

            // 嘗試重試
            if (retryCount < maxRetries && !res.headersSent) {
              const delay = retryDelays[retryCount] || 5000;
              console.log(`🔄 超時重試 ${retryCount + 1}/${maxRetries}，${delay}ms 後...`);
              retryCount++;
              setTimeout(() => attemptStream(), delay);
            } else if (!res.headersSent) {
              res.status(504).json({ error: 'Gateway Timeout' });
            }
          });

          // 處理代理請求錯誤（網路錯誤、連線中斷等）
          proxyReq.on('error', (error: NodeJS.ErrnoException) => {
            logger.error(`Proxy request error for ${videoId}:`, error);

            // 可重試的網路錯誤
            const retryableErrors = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];
            const isRetryable = retryableErrors.includes(error.code || '');

            if (isRetryable && retryCount < maxRetries && !res.headersSent) {
              const delay = retryDelays[retryCount] || 5000;
              logger.warn(`Retryable error (${error.code}) for ${videoId}, retry in ${delay}ms`);
              console.log(`🔄 網路錯誤 (${error.code}): ${videoId}，${delay}ms 後重試...`);
              youtubeService.clearUrlCache(videoId); // 清除 URL 緩存
              retryCount++;
              setTimeout(() => attemptStream(), delay);
            } else if (!res.headersSent) {
              res.status(500).json({
                error: 'Failed to proxy audio stream',
              });
            }
          });

          // 當客戶端關閉連接時，中止代理請求
          req.on('close', () => {
            proxyReq.destroy();
          });
        };

        // 開始代理請求
        makeProxyRequest(audioUrl);

      } catch (error) {
        logger.error('Stream controller error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: error instanceof Error ? error.message : 'Failed to stream audio',
          });
        }
      }
    };

    await attemptStream();
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
