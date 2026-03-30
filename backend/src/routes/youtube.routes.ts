import { Router } from 'express';
import youtubeController from '../controllers/youtube.controller';
import videoCacheService from '../services/video-cache.service';
import sponsorBlockService from '../services/sponsorblock.service';
import downloadManager from '../services/download-manager.service';
import audioCacheService from '../services/audio-cache.service';
import youtubeService from '../services/youtube.service';

const router = Router();

// 搜尋 YouTube 影片
router.get('/search', (req, res) => youtubeController.search(req, res));

// YouTube 搜尋建議（autocomplete）
router.get('/search/suggestions', (req, res) => youtubeController.searchSuggestions(req, res));

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

// ===== Play (快速取得直連 URL + 背景下載) =====

// 播放歌曲：快速回傳直連 URL，同時背景下載到快取
router.post('/play/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) { res.status(400).json({ error: 'videoId required' }); return; }

  try {
    // 已快取？直接回傳 stream URL
    if (audioCacheService.has(videoId)) {
      res.json({ status: 'ready', cached: true, url: null });
      return;
    }

    // 快速提取 YouTube 直連 URL（2-5 秒）
    const directUrl = await youtubeService.getAudioStreamUrl(videoId);

    // 背景下載到快取（不阻塞回應）
    downloadManager.playNow(videoId).catch(() => {});

    res.json({ status: 'ready', cached: false, url: directUrl });
  } catch (err: any) {
    res.status(500).json({ status: 'failed', error: err?.message });
  }
});

// ===== SponsorBlock =====

// 獲取跳過片段
router.get('/sponsorblock/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) { res.status(400).json({ error: 'videoId required' }); return; }
  const segments = await sponsorBlockService.getSegments(videoId);
  res.json({ videoId, segments });
});

export default router;
