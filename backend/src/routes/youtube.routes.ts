import { Router } from 'express';
import youtubeController from '../controllers/youtube.controller';
import videoCacheService from '../services/video-cache.service';

const router = Router();

// 搜尋 YouTube 影片
router.get('/search', (req, res) => youtubeController.search(req, res));

// 獲取影片資訊
router.get('/video/:videoId', (req, res) => youtubeController.getVideoInfo(req, res));

// 串流音訊
router.get('/stream/:videoId', (req, res) => youtubeController.streamAudio(req, res));

// 預加載音訊（觸發緩存，立即返回）
router.post('/preload/:videoId', (req, res) => youtubeController.preloadAudio(req, res));

// 預加載音訊（等待完成，用於第一首）
router.post('/preload-wait/:videoId', (req, res) => youtubeController.preloadAudioWait(req, res));

// 獲取音訊快取統計
router.get('/cache/stats', (req, res) => youtubeController.getCacheStats(req, res));

// 清空所有音訊快取
router.delete('/cache/clear', (req, res) => youtubeController.clearCache(req, res));

// 檢查單一曲目快取狀態
router.get('/cache/status/:videoId', (req, res) => youtubeController.getCacheStatus(req, res));

// 批量檢查快取狀態
router.post('/cache/status/batch', (req, res) => youtubeController.getCacheStatusBatch(req, res));

// ===== 影片快取 =====

// 觸發影片下載
router.post('/video-cache/:videoId/download', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) { res.status(400).json({ error: 'videoId required' }); return; }
  // Fire-and-forget
  videoCacheService.download(videoId).catch(() => {});
  res.status(202).json({ message: 'Video download started', videoId });
});

// 檢查影片快取狀態
router.get('/video-cache/:videoId/status', (req, res) => {
  const { videoId } = req.params;
  res.json(videoCacheService.getStatus(videoId));
});

// 串流影片
router.get('/video-cache/:videoId/stream', (req, res) => {
  const { videoId } = req.params;
  videoCacheService.streamVideo(videoId, req, res);
});

// 刪除影片快取
router.delete('/video-cache/:videoId', (req, res) => {
  const { videoId } = req.params;
  videoCacheService.delete(videoId);
  res.json({ message: 'Video deleted', videoId });
});

// 智慧清理影片快取
router.post('/video-cache/cleanup', (_req, res) => {
  videoCacheService.smartCleanup();
  res.json({ message: 'Smart cleanup completed' });
});

export default router;
