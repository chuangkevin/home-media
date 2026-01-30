import { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  IconButton,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import StorageIcon from '@mui/icons-material/Storage';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import LyricsIcon from '@mui/icons-material/Lyrics';
import audioCacheService, { type CacheListItem } from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { formatFileSize, formatDate, formatDuration } from '../../utils/formatTime';

interface AudioCacheStats {
  count: number;
  maxCount: number;
  totalSize: number;
  totalSizeMB: string;
  maxSizeMB: string;
}

interface LyricsCacheStats {
  count: number;
}

export default function CacheManagementSection() {
  const [audioStats, setAudioStats] = useState<AudioCacheStats | null>(null);
  const [lyricsStats, setLyricsStats] = useState<LyricsCacheStats | null>(null);
  const [cacheList, setCacheList] = useState<CacheListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 對話框狀態
  const [clearAudioDialogOpen, setClearAudioDialogOpen] = useState(false);
  const [clearLyricsDialogOpen, setClearLyricsDialogOpen] = useState(false);
  const [deleteItemDialog, setDeleteItemDialog] = useState<CacheListItem | null>(null);

  // 載入快取資料
  const loadCacheData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [audioStatsResult, lyricsStatsResult, cacheListResult] = await Promise.all([
        audioCacheService.getStats(),
        lyricsCacheService.getStats(),
        audioCacheService.getCacheList(),
      ]);
      setAudioStats(audioStatsResult);
      setLyricsStats(lyricsStatsResult);
      setCacheList(cacheListResult);
    } catch (error) {
      console.error('Failed to load cache data:', error);
      setAlertMessage({ type: 'error', text: '載入快取資料失敗' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCacheData();
  }, [loadCacheData]);

  // 監聽快取更新事件
  useEffect(() => {
    const handleCacheUpdated = () => {
      loadCacheData();
    };
    window.addEventListener('audio-cache-updated', handleCacheUpdated);
    return () => {
      window.removeEventListener('audio-cache-updated', handleCacheUpdated);
    };
  }, [loadCacheData]);

  // 清除所有音訊快取
  const handleClearAudioCache = async () => {
    setClearAudioDialogOpen(false);
    setIsClearing(true);
    try {
      await audioCacheService.clear();
      setAlertMessage({ type: 'success', text: '已清除所有音訊快取' });
      await loadCacheData();
    } catch (error) {
      console.error('Failed to clear audio cache:', error);
      setAlertMessage({ type: 'error', text: '清除音訊快取失敗' });
    } finally {
      setIsClearing(false);
    }
  };

  // 清除所有歌詞快取
  const handleClearLyricsCache = async () => {
    setClearLyricsDialogOpen(false);
    setIsClearing(true);
    try {
      await lyricsCacheService.clear();
      setAlertMessage({ type: 'success', text: '已清除所有歌詞快取' });
      await loadCacheData();
    } catch (error) {
      console.error('Failed to clear lyrics cache:', error);
      setAlertMessage({ type: 'error', text: '清除歌詞快取失敗' });
    } finally {
      setIsClearing(false);
    }
  };

  // 刪除單一快取項目
  const handleDeleteItem = async (item: CacheListItem) => {
    setDeleteItemDialog(null);
    try {
      await audioCacheService.delete(item.videoId);
      // 同時刪除歌詞快取
      await lyricsCacheService.delete(item.videoId);
      setAlertMessage({ type: 'success', text: `已刪除「${item.title}」的快取` });
      await loadCacheData();
    } catch (error) {
      console.error('Failed to delete cache item:', error);
      setAlertMessage({ type: 'error', text: '刪除快取失敗' });
    }
  };

  // 自動隱藏提示訊息
  useEffect(() => {
    if (alertMessage) {
      const timer = setTimeout(() => setAlertMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [alertMessage]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* 提示訊息 */}
      {alertMessage && (
        <Alert severity={alertMessage.type} sx={{ mb: 2 }} onClose={() => setAlertMessage(null)}>
          {alertMessage.text}
        </Alert>
      )}

      {/* 快取統計 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <StorageIcon />
            快取統計
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Chip
              icon={<MusicNoteIcon />}
              label={`音訊快取: ${audioStats?.count || 0} 首 / ${formatFileSize(audioStats?.totalSize || 0)}`}
              color="primary"
              variant="outlined"
            />
            <Chip
              icon={<LyricsIcon />}
              label={`歌詞快取: ${lyricsStats?.count || 0} 首`}
              color="secondary"
              variant="outlined"
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setClearAudioDialogOpen(true)}
              disabled={isClearing || (audioStats?.count || 0) === 0}
            >
              清除所有音訊快取
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setClearLyricsDialogOpen(true)}
              disabled={isClearing || (lyricsStats?.count || 0) === 0}
            >
              清除所有歌詞快取
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* 快取列表 */}
      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            已快取的曲目 ({cacheList.length})
          </Typography>

          {cacheList.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              目前沒有任何快取的曲目
            </Typography>
          ) : (
            <List sx={{ maxHeight: 400, overflow: 'auto' }}>
              {cacheList.map((item, index) => (
                <Box key={item.videoId}>
                  {index > 0 && <Divider />}
                  <ListItem
                    secondaryAction={
                      <IconButton
                        edge="end"
                        aria-label="delete"
                        onClick={() => setDeleteItemDialog(item)}
                        color="error"
                      >
                        <DeleteIcon />
                      </IconButton>
                    }
                  >
                    <ListItemAvatar>
                      <Avatar
                        variant="rounded"
                        src={item.thumbnail}
                        sx={{ width: 56, height: 56, mr: 1 }}
                      >
                        <MusicNoteIcon />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={
                        <Typography variant="body1" noWrap sx={{ maxWidth: { xs: 150, sm: 250, md: 400 } }}>
                          {item.title}
                        </Typography>
                      }
                      secondaryTypographyProps={{ component: 'div' }}
                      secondary={
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {item.channel}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                              label={formatFileSize(item.size)}
                              size="small"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                            {item.duration && (
                              <Chip
                                label={formatDuration(item.duration)}
                                size="small"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            )}
                            <Chip
                              label={formatDate(item.timestamp)}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          </Box>
                        </Box>
                      }
                    />
                  </ListItem>
                </Box>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* 清除音訊快取確認對話框 */}
      <Dialog open={clearAudioDialogOpen} onClose={() => setClearAudioDialogOpen(false)}>
        <DialogTitle>確定要清除所有音訊快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            這將會刪除 {audioStats?.count || 0} 首歌曲的快取資料（共 {formatFileSize(audioStats?.totalSize || 0)}）。
            下次播放時會重新從伺服器下載。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearAudioDialogOpen(false)}>取消</Button>
          <Button onClick={handleClearAudioCache} color="error" autoFocus>
            確定清除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 清除歌詞快取確認對話框 */}
      <Dialog open={clearLyricsDialogOpen} onClose={() => setClearLyricsDialogOpen(false)}>
        <DialogTitle>確定要清除所有歌詞快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            這將會刪除 {lyricsStats?.count || 0} 首歌曲的歌詞快取。
            下次播放時會重新從伺服器獲取歌詞。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearLyricsDialogOpen(false)}>取消</Button>
          <Button onClick={handleClearLyricsCache} color="error" autoFocus>
            確定清除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 刪除單一項目確認對話框 */}
      <Dialog open={!!deleteItemDialog} onClose={() => setDeleteItemDialog(null)}>
        <DialogTitle>確定要刪除這首歌的快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            將刪除「{deleteItemDialog?.title}」的音訊和歌詞快取。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteItemDialog(null)}>取消</Button>
          <Button onClick={() => deleteItemDialog && handleDeleteItem(deleteItemDialog)} color="error" autoFocus>
            確定刪除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
