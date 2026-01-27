import { Router } from 'express';
import lyricsController from '../controllers/lyrics.controller';

const router = Router();

// 搜尋 LRCLIB 歌詞（必須在 :videoId 之前）
router.get('/lyrics/search', (req, res) => lyricsController.searchLyrics(req, res));

// 搜尋網易雲音樂歌詞
router.get('/lyrics/search/netease', (req, res) => lyricsController.searchNeteaseLyrics(req, res));

// 透過 LRCLIB ID 獲取特定歌詞
router.get('/lyrics/lrclib/:lrclibId', (req, res) => lyricsController.getLyricsByLRCLIBId(req, res));

// 透過網易雲音樂 ID 獲取特定歌詞
router.get('/lyrics/netease/:neteaseId', (req, res) => lyricsController.getLyricsByNeteaseId(req, res));

// 獲取歌詞（自動搜尋）
router.get('/lyrics/:videoId', (req, res) => lyricsController.getLyrics(req, res));

export default router;
