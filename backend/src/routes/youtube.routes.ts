import { Router } from 'express';
import youtubeController from '../controllers/youtube.controller';

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

export default router;
