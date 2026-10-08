import { useEffect, useState, useCallback } from 'react'
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
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import StorageIcon from '@mui/icons-material/Storage'
import CloudIcon from '@mui/icons-material/Cloud'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import LyricsIcon from '@mui/icons-material/Lyrics'
import RefreshIcon from '@mui/icons-material/Refresh'
import audioCacheService, { type CacheListItem } from '../../services/audio-cache.service'
import lyricsCacheService from '../../services/lyrics-cache.service'
import apiService from '../../services/api.service'
import { formatFileSize, formatDate, formatDuration } from '../../utils/formatTime'

interface AudioCacheStats {
  count: number
  maxCount: number
  totalSize: number
  totalSizeMB: string
  maxSizeMB: string
}

interface LyricsCacheStats {
  count: number
}

const dialogSx = {
  '& .MuiDialog-paper': { m: 2, width: 'calc(100% - 32px)' },
  '& .MuiDialogTitle-root': { fontSize: 20, lineHeight: 1.5, p: 3, pb: 2 },
  '& .MuiDialogContent-root': { px: 3, overflowWrap: 'anywhere' },
  '& .MuiDialogContentText-root': { fontSize: 14, lineHeight: 1.7 },
  '& .MuiDialogActions-root': { p: 3, pt: 2, gap: 1, flexWrap: 'wrap' },
  '& .MuiDialogActions-root .MuiButton-root': { minHeight: 44, minWidth: 88, m: 0 },
}

export default function CacheManagementSection() {
  const [audioStats, setAudioStats] = useState<AudioCacheStats | null>(null)
  const [lyricsStats, setLyricsStats] = useState<LyricsCacheStats | null>(null)
  const [cacheList, setCacheList] = useState<CacheListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isClearing, setIsClearing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [serverStatsUnavailable, setServerStatsUnavailable] = useState(false)
  const [alertMessage, setAlertMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)
  const [serverCacheStats, setServerCacheStats] = useState<{ count: number; size: number } | null>(
    null
  )

  // 對話框狀態
  const [clearAudioDialogOpen, setClearAudioDialogOpen] = useState(false)
  const [clearLyricsDialogOpen, setClearLyricsDialogOpen] = useState(false)
  const [clearServerCacheDialogOpen, setClearServerCacheDialogOpen] = useState(false)
  const [deleteItemDialog, setDeleteItemDialog] = useState<CacheListItem | null>(null)

  // 載入快取資料
  const loadCacheData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(false)
    try {
      const [audioStatsResult, lyricsStatsResult, cacheListResult] = await Promise.all([
        audioCacheService.getStats(),
        lyricsCacheService.getStats(),
        audioCacheService.getCacheList(),
      ])
      setAudioStats(audioStatsResult)
      setLyricsStats(lyricsStatsResult)
      setCacheList(cacheListResult)

      // 載入伺服器快取統計
      try {
        const serverStats = await apiService.getServerCacheStats()
        setServerCacheStats(serverStats)
        setServerStatsUnavailable(!serverStats)
      } catch (error) {
        console.warn('Failed to load server cache stats:', error)
        setServerCacheStats(null)
        setServerStatsUnavailable(true)
      }
    } catch (error) {
      console.error('Failed to load cache data:', error)
      setLoadError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCacheData()
  }, [loadCacheData])

  // 監聽快取更新事件
  useEffect(() => {
    const handleCacheUpdated = () => {
      loadCacheData()
    }
    window.addEventListener('audio-cache-updated', handleCacheUpdated)
    return () => {
      window.removeEventListener('audio-cache-updated', handleCacheUpdated)
    }
  }, [loadCacheData])

  // 清除所有音訊快取
  const handleClearAudioCache = async () => {
    if (isClearing) return
    setClearAudioDialogOpen(false)
    setIsClearing(true)
    setAlertMessage(null)
    try {
      await audioCacheService.clear()
      setAlertMessage({ type: 'success', text: '已清除所有音訊快取' })
      await loadCacheData()
    } catch (error) {
      console.error('Failed to clear audio cache:', error)
      setAlertMessage({ type: 'error', text: '清除音訊快取失敗' })
    } finally {
      setIsClearing(false)
    }
  }

  // 清除所有歌詞快取
  const handleClearLyricsCache = async () => {
    if (isClearing) return
    setClearLyricsDialogOpen(false)
    setIsClearing(true)
    setAlertMessage(null)
    try {
      await lyricsCacheService.clear()
      setAlertMessage({ type: 'success', text: '已清除所有歌詞快取' })
      await loadCacheData()
    } catch (error) {
      console.error('Failed to clear lyrics cache:', error)
      setAlertMessage({ type: 'error', text: '清除歌詞快取失敗' })
    } finally {
      setIsClearing(false)
    }
  }

  // 刪除單一快取項目
  const handleDeleteItem = async (item: CacheListItem) => {
    if (isClearing) return
    setDeleteItemDialog(null)
    setIsClearing(true)
    setAlertMessage(null)
    try {
      await audioCacheService.delete(item.videoId)
      // 同時刪除歌詞快取
      await lyricsCacheService.delete(item.videoId)
      setAlertMessage({ type: 'success', text: `已刪除「${item.title}」的快取` })
      await loadCacheData()
    } catch (error) {
      console.error('Failed to delete cache item:', error)
      setAlertMessage({ type: 'error', text: '未能刪除全部快取，請重新整理後再試。' })
      await loadCacheData()
    } finally {
      setIsClearing(false)
    }
  }

  // 清除伺服器音訊快取
  const handleClearServerCache = async () => {
    if (isClearing) return
    setClearServerCacheDialogOpen(false)
    setIsClearing(true)
    setAlertMessage(null)
    try {
      const result = await apiService.clearServerCache()
      if (!result.success) {
        setAlertMessage({ type: 'error', text: '清除伺服器快取失敗，請稍後再試。' })
        return
      }
      setAlertMessage({
        type: 'success',
        text: `已清除伺服器快取（${result.deletedCount} 個檔案，${result.deletedSizeMB.toFixed(2)} MB）`,
      })
      await loadCacheData()
    } catch (error) {
      console.error('Failed to clear server cache:', error)
      setAlertMessage({ type: 'error', text: '清除伺服器快取失敗' })
    } finally {
      setIsClearing(false)
    }
  }

  // 成功提示自動隱藏，錯誤保留至使用者關閉
  useEffect(() => {
    if (alertMessage?.type === 'success') {
      const timer = setTimeout(() => setAlertMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alertMessage])

  if (isLoading && !audioStats) {
    return (
      <Box
        role="status"
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 4 }}
      >
        <CircularProgress size={24} aria-label="載入快取資料" />
        <Typography variant="body2" color="text.secondary">
          正在讀取快取資料…
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        minWidth: 0,
        '& .MuiButton-root': { minHeight: 44, fontSize: 14 },
        '& .MuiIconButton-root': { minWidth: 44, minHeight: 44 },
      }}
      aria-busy={isLoading || isClearing}
    >
      {/* 提示訊息 */}
      {alertMessage && (
        <Alert
          severity={alertMessage.type}
          sx={{ mb: 2, overflowWrap: 'anywhere' }}
          onClose={() => setAlertMessage(null)}
        >
          {alertMessage.text}
        </Alert>
      )}
      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          無法更新本機快取資料，請重新整理後再試。
        </Alert>
      )}
      {serverStatsUnavailable && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          目前無法讀取伺服器快取，請重新整理後再試。
        </Alert>
      )}
      {isClearing && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2">正在清除快取…</Typography>
        </Box>
      )}

      {/* 快取統計 */}
      <Card variant="outlined" sx={{ mb: 3, boxShadow: 'none', borderColor: 'divider' }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
          <Box
            sx={{
              mb: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <Typography
              component="h2"
              variant="h6"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 20 }}
            >
              <StorageIcon sx={{ color: 'primary.main' }} />
              快取統計
            </Typography>
            <Button
              startIcon={isLoading ? <CircularProgress size={18} /> : <RefreshIcon />}
              onClick={loadCacheData}
              disabled={isLoading || isClearing}
            >
              重新整理
            </Button>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
              gap: 3,
              mb: 3,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
              >
                <MusicNoteIcon fontSize="small" />
                本機音訊
              </Typography>
              <Typography sx={{ fontSize: 24, fontWeight: 600 }}>
                {audioStats ? `${audioStats.count} 首` : '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {audioStats ? formatFileSize(audioStats.totalSize) : '尚未取得資料'}
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
              >
                <LyricsIcon fontSize="small" />
                本機歌詞
              </Typography>
              <Typography sx={{ fontSize: 24, fontWeight: 600 }}>
                {lyricsStats ? `${lyricsStats.count} 首` : '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                儲存在此裝置
              </Typography>
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
              >
                <CloudIcon fontSize="small" />
                伺服器音訊
              </Typography>
              <Typography sx={{ fontSize: 24, fontWeight: 600 }}>
                {serverCacheStats ? `${serverCacheStats.count} 個` : '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {serverCacheStats ? formatFileSize(serverCacheStats.size) : '尚未取得資料'}
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              flexWrap: 'wrap',
              pt: 3,
              borderTop: 1,
              borderColor: 'divider',
              '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' }, whiteSpace: 'normal' },
            }}
          >
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setClearAudioDialogOpen(true)}
              disabled={isClearing || isLoading || loadError || (audioStats?.count || 0) === 0}
            >
              清除所有音訊快取
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setClearLyricsDialogOpen(true)}
              disabled={isClearing || isLoading || loadError || (lyricsStats?.count || 0) === 0}
            >
              清除所有歌詞快取
            </Button>
            {serverCacheStats && (
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteSweepIcon />}
                onClick={() => setClearServerCacheDialogOpen(true)}
                disabled={isClearing || isLoading || (serverCacheStats?.count || 0) === 0}
              >
                清除伺服器快取
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* 快取列表 */}
      <Card variant="outlined" sx={{ boxShadow: 'none', borderColor: 'divider' }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 }, '&:last-child': { pb: { xs: 2, sm: 3 } } }}>
          <Typography component="h2" variant="h6" sx={{ mb: 2, fontSize: 20 }}>
            已快取的曲目{audioStats ? `（${cacheList.length}）` : ''}
          </Typography>

          {cacheList.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <MusicNoteIcon sx={{ color: 'primary.main', fontSize: 32, mb: 1 }} />
              <Typography variant="body1" sx={{ fontSize: 16, mb: 1 }}>
                {loadError ? '尚無可顯示的快取資料' : '目前沒有快取的曲目'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                {loadError ? '重新整理後即可再次讀取。' : '播放後儲存的音訊會顯示在這裡。'}
              </Typography>
            </Box>
          ) : (
            <List disablePadding sx={{ minWidth: 0 }}>
              {cacheList.map((item, index) => (
                <Box component="li" key={item.videoId}>
                  {index > 0 && <Divider />}
                  <ListItem
                    component="div"
                    disableGutters
                    sx={{ alignItems: 'flex-start', gap: { xs: 1, sm: 2 }, py: 2 }}
                  >
                    <ListItemAvatar sx={{ minWidth: 0, mt: 0.5 }}>
                      <Avatar
                        variant="rounded"
                        src={item.thumbnail}
                        alt=""
                        sx={{ width: { xs: 40, sm: 56 }, height: { xs: 40, sm: 56 } }}
                      >
                        <MusicNoteIcon />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      sx={{ minWidth: 0, my: 0 }}
                      primary={
                        <Typography
                          variant="body1"
                          sx={{
                            fontSize: 15,
                            fontWeight: 600,
                            lineHeight: 1.6,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {item.title}
                        </Typography>
                      }
                      secondaryTypographyProps={{ component: 'div' }}
                      secondary={
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ overflowWrap: 'anywhere', lineHeight: 1.6 }}
                          >
                            {item.channel}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                              label={formatFileSize(item.size)}
                              size="small"
                              sx={{ height: 24, fontSize: 12, maxWidth: '100%' }}
                            />
                            {item.duration && (
                              <Chip
                                label={formatDuration(item.duration)}
                                size="small"
                                sx={{ height: 24, fontSize: 12, maxWidth: '100%' }}
                              />
                            )}
                          </Box>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere' }}
                          >
                            快取時間：{formatDate(item.timestamp)}
                          </Typography>
                        </Box>
                      }
                    />
                    <IconButton
                      aria-label={`刪除「${item.title}」的快取`}
                      onClick={() => setDeleteItemDialog(item)}
                      disabled={isClearing || isLoading || loadError}
                      color="error"
                      sx={{ flexShrink: 0 }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </ListItem>
                </Box>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* 清除音訊快取確認對話框 */}
      <Dialog
        open={clearAudioDialogOpen}
        onClose={() => setClearAudioDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        sx={dialogSx}
        aria-labelledby="clear-audio-title"
      >
        <DialogTitle id="clear-audio-title">確定要清除所有音訊快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            這將會刪除 {audioStats?.count || 0} 首歌曲的快取資料（共{' '}
            {formatFileSize(audioStats?.totalSize || 0)}）。 下次播放時會重新從伺服器下載。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearAudioDialogOpen(false)} autoFocus>
            取消
          </Button>
          <Button
            onClick={handleClearAudioCache}
            color="error"
            variant="contained"
            disabled={isClearing}
          >
            確定清除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 清除歌詞快取確認對話框 */}
      <Dialog
        open={clearLyricsDialogOpen}
        onClose={() => setClearLyricsDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        sx={dialogSx}
        aria-labelledby="clear-lyrics-title"
      >
        <DialogTitle id="clear-lyrics-title">確定要清除所有歌詞快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            這將會刪除 {lyricsStats?.count || 0} 首歌曲的歌詞快取。
            下次播放時會重新從伺服器獲取歌詞。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearLyricsDialogOpen(false)} autoFocus>
            取消
          </Button>
          <Button
            onClick={handleClearLyricsCache}
            color="error"
            variant="contained"
            disabled={isClearing}
          >
            確定清除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 刪除單一項目確認對話框 */}
      <Dialog
        open={!!deleteItemDialog}
        onClose={() => setDeleteItemDialog(null)}
        fullWidth
        maxWidth="sm"
        sx={dialogSx}
        aria-labelledby="delete-cache-item-title"
      >
        <DialogTitle id="delete-cache-item-title">確定要刪除這首歌的快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            將刪除「{deleteItemDialog?.title}」的音訊和歌詞快取。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteItemDialog(null)} autoFocus>
            取消
          </Button>
          <Button
            onClick={() => deleteItemDialog && handleDeleteItem(deleteItemDialog)}
            color="error"
            variant="contained"
            disabled={isClearing}
          >
            確定刪除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 清除伺服器快取確認對話框 */}
      <Dialog
        open={clearServerCacheDialogOpen}
        onClose={() => setClearServerCacheDialogOpen(false)}
        fullWidth
        maxWidth="sm"
        sx={dialogSx}
        aria-labelledby="clear-server-cache-title"
      >
        <DialogTitle id="clear-server-cache-title">確定要清除伺服器音訊快取嗎？</DialogTitle>
        <DialogContent>
          <DialogContentText>
            這將會刪除伺服器上的 {serverCacheStats?.count || 0} 個快取檔案（共{' '}
            {formatFileSize(serverCacheStats?.size || 0)}）。
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>
            如果快取檔案損壞，重新下載可能改善手機端的音訊時長顯示。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearServerCacheDialogOpen(false)} autoFocus>
            取消
          </Button>
          <Button
            onClick={handleClearServerCache}
            color="error"
            variant="contained"
            disabled={isClearing}
          >
            {isClearing ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
            確定清除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
