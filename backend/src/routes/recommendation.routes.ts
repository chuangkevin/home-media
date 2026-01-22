import { Router } from 'express';
import recommendationController from '../controllers/recommendation.controller';

const router = Router();

// 頻道推薦
router.get('/recommendations/channels', (req, res) => recommendationController.getChannelRecommendations(req, res));

// 單一頻道影片
router.get('/recommendations/channel/:channelName', (req, res) => recommendationController.getChannelVideos(req, res));

// 刷新推薦
router.post('/recommendations/refresh', (req, res) => recommendationController.refreshRecommendations(req, res));

// 統計資訊
router.get('/recommendations/stats', (req, res) => recommendationController.getStats(req, res));

export default router;
