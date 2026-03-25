import { Router, Request, Response } from 'express';
import { getKeyList, addKeys, removeKey, validateApiKey, isConfigured } from '../services/gemini.service';

const router = Router();

// 取得 Gemini 狀態
router.get('/status', (_req: Request, res: Response): void => {
  res.json({
    configured: isConfigured(),
    keys: getKeyList(),
  });
});

// 批量新增 API Keys（支援多行文字）
router.post('/keys', async (req: Request, res: Response): Promise<void> => {
  const { keys: rawText } = req.body;

  if (!rawText || typeof rawText !== 'string') {
    res.status(400).json({ error: 'keys (string) is required' });
    return;
  }

  // 從多行文字中提取 API Keys（每行一個，或逗號分隔）
  const lines = rawText.split(/[\n,]/).map(l => l.trim()).filter(l => l.length >= 20);

  if (lines.length === 0) {
    res.status(400).json({ error: 'No valid API keys found in input' });
    return;
  }

  // 驗證第一把 key
  const validation = await validateApiKey(lines[0]);
  if (!validation.valid) {
    res.status(400).json({ error: `First key validation failed: ${validation.error}` });
    return;
  }

  const result = addKeys(lines);
  res.json({
    success: true,
    ...result,
    total: getKeyList().length,
  });
});

// 移除 API Key（by suffix）
router.delete('/keys/:suffix', (req: Request, res: Response): void => {
  const { suffix } = req.params;
  const removed = removeKey(suffix);
  res.json({ success: removed });
});

export default router;
