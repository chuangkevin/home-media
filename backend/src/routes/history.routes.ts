import { Router } from 'express';
import historyController from '../controllers/history.controller';

const router = Router();

// 搜尋歷史
router.get('/history/searches', (req, res) => historyController.getSearchHistory(req, res));
router.post('/history/search', (req, res) => historyController.recordSearch(req, res));
router.delete('/history/searches', (req, res) => historyController.clearSearchHistory(req, res));

// 頻道歷史
router.get('/history/channels', (req, res) => historyController.getWatchedChannels(req, res));
router.post('/history/channel', (req, res) => historyController.recordChannelWatch(req, res));
router.delete('/history/channels', (req, res) => historyController.clearChannelHistory(req, res));

// 統計資訊
router.get('/history/stats', (req, res) => historyController.getStats(req, res));

export default router;
