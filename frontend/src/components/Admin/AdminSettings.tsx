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
  List,
  ListItem,
  ListItemAvatar,
  Avatar,
  ListItemText,
  IconButton,
  Collapse,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import apiService from '../../services/api.service';
import audioCacheService, { type CacheListItem } from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';

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
  const [clearing, setClearing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [cachedTracks, setCachedTracks] = useState<CacheListItem[]>([]);
  const [showCacheList, setShowCacheList] = useState(false);
  const [deletingTrack, setDeletingTrack] = useState<string | null>(null);

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

  // 清除本地音訊快取
  const handleClearLocalCache = async () => {
    if (!confirm('確定要清除本地音訊快取嗎？')) return;
    try {
      setClearing('local');
      await audioCacheService.clear();
      setCachedTracks([]);
      setMessage({ type: 'success', text: '本地音訊快取已清除' });
      setTimeout(() => {
        setMessage(null);
        setClearing(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to clear local cache:', error);
      setMessage({ type: 'error', text: '清除本地快取失敗' });
      setClearing(null);
    }
  };

  // 載入快取列表
  const loadCacheList = async () => {
    try {
      const list = await audioCacheService.getCacheList();
      setCachedTracks(list);
    } catch (error) {
      console.error('Failed to load cache list:', error);
    }
  };

  // 刪除單首音樂快取
  const handleDeleteTrack = async (videoId: string) => {
    if (!confirm('確定要刪除這首歌的快取嗎？')) return;
    try {
      setDeletingTrack(videoId);
      await audioCacheService.delete(videoId);
      await loadCacheList();
      setMessage({ type: 'success', text: '快取已刪除' });
      setTimeout(() => setMessage(null), 2000);
    } catch (error) {
      console.error('Failed to delete track cache:', error);
      setMessage({ type: 'error', text: '刪除快取失敗' });
    } finally {
      setDeletingTrack(null);
    }
  };

  // 切換快取列表顯示
  const handleToggleCacheList = async () => {
    if (!showCacheList) {
      await loadCacheList();
    }
    setShowCacheList(!showCacheList);
  };

  // 清除歌詞快取
  const handleClearLyricsCache = async () => {
    if (!confirm('確定要清除歌詞快取嗎？')) return;
    try {
      setClearing('lyrics');
      await lyricsCacheService.clear();
      setMessage({ type: 'success', text: '歌詞快取已清除' });
      setTimeout(() => {
        setMessage(null);
        setClearing(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to clear lyrics cache:', error);
      setMessage({ type: 'error', text: '清除歌詞快取失敗' });
      setClearing(null);
    }
  };

  // 清除伺服器快取
  const handleClearServerCache = async () => {
    if (!confirm('確定要清除伺服器快取嗎？')) return;
    try {
      setClearing('server');
      await apiService.clearServerCache();
      setMessage({ type: 'success', text: '伺服器快取已清除' });
      setTimeout(() => {
        setMessage(null);
        setClearing(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to clear server cache:', error);
      setMessage({ type: 'error', text: '清除伺服器快取失敗' });
      setClearing(null);
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

              {/* 快取列表 */}
              <Box sx={{ mt: 3 }}>
                <Button
                  variant="outlined"
                  startIcon={showCacheList ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  onClick={handleToggleCacheList}
                  fullWidth
                >
                  {showCacheList ? '隱藏快取列表' : '顯示快取列表'}
                </Button>

                <Collapse in={showCacheList}>
                  <Box sx={{ mt: 2 }}>
                    {cachedTracks.length === 0 ? (
                      <Typography color="text.secondary" align="center" sx={{ py: 2 }}>
                        目前沒有快取
                      </Typography>
                    ) : (
                      <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                        {cachedTracks.map((track) => (
                          <ListItem
                            key={track.videoId}
                            divider
                            secondaryAction={
                              <IconButton
                                edge="end"
                                aria-label="delete"
                                onClick={() => handleDeleteTrack(track.videoId)}
                                disabled={deletingTrack === track.videoId}
                                color="error"
                              >
                                {deletingTrack === track.videoId ? (
                                  <CircularProgress size={24} />
                                ) : (
                                  <DeleteIcon />
                                )}
                              </IconButton>
                            }
                          >
                            <ListItemAvatar>
                              <Avatar src={track.thumbnail} variant="rounded" />
                            </ListItemAvatar>
                            <ListItemText
                              primary={track.title}
                              secondary={
                                <>
                                  {track.channel && `${track.channel} • `}
                                  {(track.size / 1024 / 1024).toFixed(1)} MB
                                  {track.duration && ` • ${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}`}
                                </>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Box>
                </Collapse>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 操作按鈕 */}
      <Box sx={{ mt: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
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

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <Button
          variant="outlined"
          color="warning"
          startIcon={clearing === 'local' ? <CircularProgress size={20} /> : <DeleteIcon />}
          onClick={handleClearLocalCache}
          disabled={clearing !== null}
          size="large"
        >
          {clearing === 'local' ? '清除中...' : '清除本地音訊快取'}
        </Button>

        <Button
          variant="outlined"
          color="warning"
          startIcon={clearing === 'lyrics' ? <CircularProgress size={20} /> : <DeleteIcon />}
          onClick={handleClearLyricsCache}
          disabled={clearing !== null}
          size="large"
        >
          {clearing === 'lyrics' ? '清除中...' : '清除歌詞快取'}
        </Button>

        <Button
          variant="outlined"
          color="error"
          startIcon={clearing === 'server' ? <CircularProgress size={20} /> : <DeleteIcon />}
          onClick={handleClearServerCache}
          disabled={clearing !== null}
          size="large"
        >
          {clearing === 'server' ? '清除中...' : '清除伺服器快取'}
        </Button>
      </Box>
    </Box>
  );
}
