import { Router } from 'express';
import lyricsController from '../controllers/lyrics.controller';

const router = Router();

// 獲取歌詞
router.get('/lyrics/:videoId', (req, res) => lyricsController.getLyrics(req, res));

export default router;
