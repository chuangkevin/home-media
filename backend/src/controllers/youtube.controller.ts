import { Request, Response } from 'express';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import youtubeService from '../services/youtube.service';
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
   * 串流音訊 - 代理模式（支援 Range requests）
   */
  async streamAudio(req: Request, res: Response): Promise<void> {
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

      logger.info(`Streaming audio for video: ${videoId} via proxy`);

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

            // 轉發狀態碼
            res.status(proxyRes.statusCode || 200);

            // 轉發重要的 headers
            const headersToForward = [
              'content-type',
              'content-length',
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

            // 如果沒有 accept-ranges，添加它（支援 seek）
            if (!proxyRes.headers['accept-ranges']) {
              res.setHeader('Accept-Ranges', 'bytes');
            }

            // 啟用 CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

            logger.info(`Proxying audio stream for ${videoId} (status: ${proxyRes.statusCode})`);

            // 串流數據
            proxyRes.pipe(res);

            // 處理錯誤
            proxyRes.on('error', (error) => {
              logger.error(`Proxy stream error for ${videoId}:`, error);
              if (!res.headersSent) {
                res.status(500).end();
              }
            });
          }
        );

        // 處理代理請求錯誤
        proxyReq.on('error', (error) => {
          logger.error(`Proxy request error for ${videoId}:`, error);
          if (!res.headersSent) {
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
}

export default new YouTubeController();
