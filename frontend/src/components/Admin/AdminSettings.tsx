import { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Grid,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import apiService from '../../services/api.service';

interface Settings {
  site_title: string;
  cache_duration: number;
  enable_lyrics: boolean;
  auto_play: boolean;
  theme_mode: string;
  audio_cache_ttl_days: number;
  audio_cache_max_size_gb: number;
  audio_cache_max_entries: number;
}

export default function AdminSettings() {
  const [settings, setSettings] = useState<Settings>({
    site_title: 'Home Media',
    cache_duration: 86400000,
    enable_lyrics: true,
    auto_play: true,
    theme_mode: 'dark',
    audio_cache_ttl_days: 30,
    audio_cache_max_size_gb: 2,
    audio_cache_max_entries: 200,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 載入設定
  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await apiService.getSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage({ type: 'error', text: '載入設定失敗' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // 儲存設定
  const handleSave = async () => {
    try {
      setSaving(true);
      await apiService.updateSettings(settings);
      setMessage({ type: 'success', text: '設定已儲存' });
      
      // 更新頁面標題
      document.title = settings.site_title;
      
      // 觸發主題變更事件
      window.dispatchEvent(new CustomEvent('themeChanged', { detail: settings.theme_mode }));
      
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMessage({ type: 'error', text: '儲存設定失敗' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="80vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Typography variant="h4" gutterBottom sx={{ mb: 3 }}>
        系統設定
      </Typography>

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* 基本設定 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                基本設定
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <TextField
                fullWidth
                label="網站標題"
                value={settings.site_title}
                onChange={(e) => setSettings({ ...settings, site_title: e.target.value })}
                sx={{ mb: 2 }}
                helperText="顯示在瀏覽器標籤的標題"
              />

              <TextField
                fullWidth
                label="主題模式"
                value={settings.theme_mode}
                onChange={(e) => setSettings({ ...settings, theme_mode: e.target.value })}
                select
                SelectProps={{ native: true }}
                sx={{ mb: 2 }}
              >
                <option value="dark">深色模式</option>
                <option value="light">淺色模式</option>
                <option value="auto">自動</option>
              </TextField>
            </CardContent>
          </Card>
        </Grid>

        {/* 功能設定 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                功能設定
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enable_lyrics}
                    onChange={(e) => setSettings({ ...settings, enable_lyrics: e.target.checked })}
                  />
                }
                label="啟用歌詞功能"
                sx={{ mb: 2, display: 'block' }}
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.auto_play}
                    onChange={(e) => setSettings({ ...settings, auto_play: e.target.checked })}
                  />
                }
                label="自動播放下一首"
                sx={{ mb: 2, display: 'block' }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* 快取設定 */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                推薦快取設定
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <TextField
                fullWidth
                label="快取時間 (毫秒)"
                type="number"
                value={settings.cache_duration}
                onChange={(e) => setSettings({ ...settings, cache_duration: parseInt(e.target.value) })}
                helperText="預設: 86400000 (24小時)"
                sx={{ maxWidth: 400 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* 音樂快取設定 */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                音樂快取設定
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="快取期限 (天)"
                    type="number"
                    value={settings.audio_cache_ttl_days}
                    onChange={(e) => setSettings({ ...settings, audio_cache_ttl_days: parseInt(e.target.value) })}
                    helperText="預設: 30 天"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="最大容量 (GB)"
                    type="number"
                    value={settings.audio_cache_max_size_gb}
                    onChange={(e) => setSettings({ ...settings, audio_cache_max_size_gb: parseInt(e.target.value) })}
                    helperText="預設: 2 GB"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="最多歌曲數"
                    type="number"
                    value={settings.audio_cache_max_entries}
                    onChange={(e) => setSettings({ ...settings, audio_cache_max_entries: parseInt(e.target.value) })}
                    helperText="預設: 200 首"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 操作按鈕 */}
      <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={saving ? <CircularProgress size={20} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          size="large"
        >
          {saving ? '儲存中...' : '儲存設定'}
        </Button>

        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadSettings}
          disabled={loading || saving}
          size="large"
        >
          重新載入
        </Button>
      </Box>
    </Box>
  );
}
