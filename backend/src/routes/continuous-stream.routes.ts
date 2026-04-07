import { Router, Request, Response } from 'express';
import continuousStreamService from '../services/continuous-stream.service';

const router = Router();

/**
 * POST /api/stream/continuous
 * 建立 continuous stream session，回傳 sessionId
 */
router.post('/stream/continuous', (_req: Request, res: Response) => {
  const sessionId = continuousStreamService.createSession();
  res.json({ sessionId });
});

/**
 * GET /api/stream/continuous/:sessionId
 * 連續音訊串流（HTTP chunked MP3）
 */
router.get('/stream/continuous/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!continuousStreamService.getSession(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  continuousStreamService.attachStream(sessionId, res);
});

/**
 * GET /api/stream/continuous/:sessionId/events
 * SSE：track-change / lyrics / position / queue-empty / session-ended
 */
router.get('/stream/continuous/:sessionId/events', (req: Request, res: Response) => {
  const { sessionId } = req.params;

  if (!continuousStreamService.getSession(sessionId)) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  continuousStreamService.addSseClient(sessionId, res);
});

/**
 * POST /api/stream/continuous/:sessionId/queue
 * 加歌到 queue
 * body: { tracks: QueueTrack[] }
 */
router.post('/stream/continuous/:sessionId/queue', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { tracks } = req.body;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    res.status(400).json({ error: 'tracks array is required' });
    return;
  }

  const ok = continuousStreamService.addToQueue(sessionId, tracks);
  if (!ok) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({ message: 'Tracks queued', count: tracks.length });
});

/**
 * POST /api/stream/continuous/:sessionId/next
 * 手動切下一首
 */
router.post('/stream/continuous/:sessionId/next', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  const ok = await continuousStreamService.manualNext(sessionId);
  if (!ok) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({ message: 'Skipped to next' });
});

/**
 * POST /api/stream/continuous/:sessionId/seek
 * Seek（重新啟動 ffmpeg 從指定位置）
 * body: { position: number }
 */
router.post('/stream/continuous/:sessionId/seek', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { position } = req.body;

  if (typeof position !== 'number' || position < 0) {
    res.status(400).json({ error: 'position (non-negative number) is required' });
    return;
  }

  const ok = await continuousStreamService.seek(sessionId, position);
  if (!ok) {
    res.status(404).json({ error: 'Session not found or no current track' });
    return;
  }

  res.json({ message: 'Seeked', position });
});

/**
 * DELETE /api/stream/continuous/:sessionId
 * 結束 session，清理所有資源
 */
router.delete('/stream/continuous/:sessionId', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  continuousStreamService.deleteSession(sessionId);
  res.json({ message: 'Session ended' });
});

export default router;
