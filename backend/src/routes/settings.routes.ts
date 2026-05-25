import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import {
  getOpenCodeStatus,
  setOpenCodeServers,
  setOpenCodeTextModel,
  setOpenCodeVisionModel,
  setOpenCodeTextVariant,
  setOpenCodeVisionVariant,
  clearOpenCodeSettings,
  listOpenCodeModels,
  OPENCODE_VARIANTS,
} from '../ai/opencode-settings';

const router = Router();

interface Setting {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean';
  updated_at: number;
}

// ── OpenCode settings (no auth gate — deployment-side config) ──────────────────

router.get('/opencode', (_req: Request, res: Response): void => {
  try {
    res.json({ openCode: getOpenCodeStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Query failed' });
  }
});

router.put('/opencode', (req: Request, res: Response): void => {
  try {
    const { servers, textModel, visionModel, textVariant, visionVariant } = req.body as Record<string, unknown>;
    if (typeof servers === 'string') setOpenCodeServers(servers);
    if (typeof textModel === 'string') setOpenCodeTextModel(textModel);
    if (typeof visionModel === 'string') setOpenCodeVisionModel(visionModel);
    if (typeof textVariant === 'string' && (textVariant === '' || OPENCODE_VARIANTS.includes(textVariant as typeof OPENCODE_VARIANTS[number]))) {
      setOpenCodeTextVariant(textVariant);
    }
    if (typeof visionVariant === 'string' && (visionVariant === '' || OPENCODE_VARIANTS.includes(visionVariant as typeof OPENCODE_VARIANTS[number]))) {
      setOpenCodeVisionVariant(visionVariant);
    }
    res.json({ openCode: getOpenCodeStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Save failed' });
  }
});

router.delete('/opencode', (_req: Request, res: Response): void => {
  try {
    clearOpenCodeSettings();
    res.json({ openCode: getOpenCodeStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Clear failed' });
  }
});

router.get('/opencode/models', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await listOpenCodeModels();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ models: [], sourceServerId: null, warning: err.message || 'Query failed' });
  }
});

// ── General settings ───────────────────────────────────────────────────────────

// 獲取所有設定
router.get('/', (_req: Request, res: Response): void => {
  const db = getDatabase();
  const settings = db.prepare('SELECT * FROM settings').all() as Setting[];
  
  const settingsMap: Record<string, any> = {};
  settings.forEach(setting => {
    let value: any = setting.value;
    if (setting.type === 'number') {
      value = parseFloat(setting.value);
    } else if (setting.type === 'boolean') {
      value = setting.value === 'true';
    }
    settingsMap[setting.key] = value;
  });
  
  res.json(settingsMap);
});

// 獲取單一設定
router.get('/:key', (req: Request, res: Response): void => {
  const db = getDatabase();
  const { key } = req.params;
  
  const setting = db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as Setting | undefined;
  
  if (!setting) {
    res.status(404).json({ error: 'Setting not found' });
    return;
  }
  
  let value: any = setting.value;
  if (setting.type === 'number') {
    value = parseFloat(setting.value);
  } else if (setting.type === 'boolean') {
    value = setting.value === 'true';
  }
  
  res.json({ [key]: value });
});

// 更新設定
router.put('/:key', (req: Request, res: Response): void => {
  const db = getDatabase();
  const { key } = req.params;
  const { value } = req.body;
  
  if (value === undefined) {
    res.status(400).json({ error: 'Value is required' });
    return;
  }
  
  // 確定資料類型
  let type: 'string' | 'number' | 'boolean' = 'string';
  let stringValue: string = String(value);
  
  if (typeof value === 'number') {
    type = 'number';
  } else if (typeof value === 'boolean') {
    type = 'boolean';
    stringValue = value ? 'true' : 'false';
  }
  
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO settings (key, value, type, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      type = excluded.type,
      updated_at = excluded.updated_at
  `).run(key, stringValue, type, now);
  
  res.json({ success: true, key, value });
});

// 批次更新設定
router.post('/batch', (req: Request, res: Response): void => {
  const db = getDatabase();
  const { settings } = req.body;
  
  if (!settings || typeof settings !== 'object') {
    res.status(400).json({ error: 'Settings object is required' });
    return;
  }
  
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, type, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      type = excluded.type,
      updated_at = excluded.updated_at
  `);
  
  const updateTransaction = db.transaction((settingsObj: Record<string, any>) => {
    for (const [key, value] of Object.entries(settingsObj)) {
      let type: 'string' | 'number' | 'boolean' = 'string';
      let stringValue: string = String(value);
      
      if (typeof value === 'number') {
        type = 'number';
      } else if (typeof value === 'boolean') {
        type = 'boolean';
        stringValue = value ? 'true' : 'false';
      }
      
      stmt.run(key, stringValue, type, now);
    }
  });
  
  try {
    updateTransaction(settings);
    res.json({ success: true, updated: Object.keys(settings).length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// 刪除設定
router.delete('/:key', (req: Request, res: Response): void => {
  const db = getDatabase();
  const { key } = req.params;
  
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  res.json({ success: true, key });
});

export default router;
