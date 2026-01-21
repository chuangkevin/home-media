import { Router } from 'express';
import youtubeController from '../controllers/youtube.controller';

const router = Router();

// 搜尋 YouTube 影片
router.get('/search', (req, res) => youtubeController.search(req, res));

// 獲取影片資訊
router.get('/video/:videoId', (req, res) => youtubeController.getVideoInfo(req, res));

// 串流音訊
router.get('/stream/:videoId', (req, res) => youtubeController.streamAudio(req, res));

export default router;
