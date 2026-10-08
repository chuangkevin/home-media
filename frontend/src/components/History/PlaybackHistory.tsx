import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Alert,
  Box,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Skeleton,
  Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import apiService, { type PlaybackHistoryTrack } from '../../services/api.service'
import type { Track } from '../../types/track.types'

function groupByDate(tracks: PlaybackHistoryTrack[]): Record<string, PlaybackHistoryTrack[]> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = today - 86400000
  const weekAgo = today - 7 * 86400000
  const groups: Record<string, PlaybackHistoryTrack[]> = {}
  for (const track of tracks) {
    const label =
      track.lastPlayed >= today
        ? '今天'
        : track.lastPlayed >= yesterday
          ? '昨天'
          : track.lastPlayed >= weekAgo
            ? '本週'
            : '更早'
    if (!groups[label]) groups[label] = []
    groups[label].push(track)
  }
  return groups
}

interface PlaybackHistoryProps {
  onPlay: (track: Track) => void
}

export default function PlaybackHistory({ onPlay }: PlaybackHistoryProps) {
  const [tracks, setTracks] = useState<PlaybackHistoryTrack[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(6)
  const hasDataRef = useRef(false)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async (silent = false) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    if (!silent || !hasDataRef.current) setLoading(true)
    setError(null)
    try {
      const data = await apiService.getPlaybackHistory(100)
      if (mountedRef.current) {
        setTracks(data)
        hasDataRef.current = data.length > 0
      }
    } catch {
      if (mountedRef.current)
        setError(
          hasDataRef.current
            ? '播放紀錄暫時無法更新，仍顯示上次載入的內容。'
            : '播放紀錄載入失敗，請檢查連線後重試。'
        )
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void fetchData()
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void fetchData(true)
    }
    window.addEventListener('pageshow', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pageshow', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [fetchData])

  const handlePlay = (track: PlaybackHistoryTrack) => {
    onPlay({
      id: track.videoId,
      videoId: track.videoId,
      title: track.title,
      channel: track.channel,
      thumbnail: track.thumbnail,
      duration: track.duration,
    })
  }

  if (loading && !tracks.length)
    return (
      <Box aria-label="正在載入最近播放">
        {[1, 2, 3].map((index) => (
          <Skeleton key={index} height={72} sx={{ mb: 1 }} />
        ))}
      </Box>
    )

  const groups = groupByDate(tracks.slice(0, visibleCount))
  return (
    <Box>
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button onClick={() => void fetchData()} disabled={loading} sx={{ minHeight: 44 }}>
              重試
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {!error && !tracks.length && (
        <Typography color="text.secondary" sx={{ py: 3, fontSize: 14 }}>
          還沒有播放紀錄。播放喜歡的歌曲後，就能在這裡再次找到。
        </Typography>
      )}
      {['今天', '昨天', '本週', '更早'].map((label) => {
        const items = groups[label]
        if (!items?.length) return null
        return (
          <Box key={label} sx={{ mb: 2 }}>
            <Typography
              component="h3"
              color="text.secondary"
              sx={{ fontSize: 12, fontWeight: 600, mb: 1, px: 1 }}
            >
              {label}
            </Typography>
            <List disablePadding aria-label={`${label}播放的歌曲`}>
              {items.map((track) => (
                <ListItem key={track.videoId} disablePadding>
                  <ListItemButton
                    onClick={() => handlePlay(track)}
                    aria-label={`播放 ${track.title}`}
                    sx={{ px: { xs: 1, sm: 2 }, py: 1.5, minHeight: 76, gap: 2, m: 0 }}
                  >
                    <Box
                      component="img"
                      src={track.thumbnail}
                      alt=""
                      loading="lazy"
                      sx={{
                        width: 48,
                        height: 48,
                        flexShrink: 0,
                        objectFit: 'cover',
                        borderRadius: 1,
                      }}
                    />
                    <ListItemText
                      primary={track.title}
                      secondary={`${track.channel} · 播放 ${track.playCount} 次`}
                      primaryTypographyProps={{
                        noWrap: true,
                        sx: { fontSize: 15, fontWeight: 500 },
                      }}
                      secondaryTypographyProps={{ noWrap: true, sx: { fontSize: 12, mt: 0.5 } }}
                      sx={{ minWidth: 0, m: 0 }}
                    />
                    <PlayArrowIcon sx={{ flexShrink: 0, color: 'primary.main' }} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
        )
      })}
      {tracks.length > visibleCount && (
        <Button
          startIcon={<ExpandMoreIcon />}
          onClick={() => setVisibleCount((count) => count + 12)}
          sx={{ minHeight: 44, mt: 1 }}
        >
          顯示更多紀錄
        </Button>
      )}
    </Box>
  )
}
