import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Skeleton,
  Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import apiService, { type PlaybackHistoryTrack } from '../../services/api.service'
import type { Track } from '../../types/track.types'
import { homeMediaCardSx, homeMediaPlaySx, homeMediaShelfSx, homeMediaTitleSx } from '../Home/homeMediaStyles'

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
            <Box sx={homeMediaShelfSx} aria-label={`${label}播放的歌曲`}>
              {items.map((track) => (
                <Card key={track.videoId} sx={{ ...homeMediaCardSx, scrollSnapAlign: 'start' }}>
                  <CardActionArea
                    onClick={() => handlePlay(track)}
                    aria-label={`播放 ${track.title}`}
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      justifyContent: 'flex-start',
                      '&.Mui-focusVisible': { outlineOffset: -3 },
                    }}
                  >
                    <Box sx={{ position: 'relative', width: '100%' }}>
                      <CardMedia
                        component="img"
                        loading="lazy"
                        image={track.thumbnail || `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`}
                        alt=""
                        sx={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', bgcolor: 'action.selected' }}
                      />
                      <Box aria-hidden="true" sx={{ position: 'absolute', right: 8, bottom: 8, ...homeMediaPlaySx }}>
                        <PlayArrowIcon />
                      </Box>
                    </Box>
                    <CardContent sx={{ p: 1.5, flex: 1, minWidth: 0, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="body2" sx={homeMediaTitleSx}>{track.title}</Typography>
                      <Typography variant="caption" component="p" color="text.secondary" noWrap sx={{ fontSize: 12, mt: 0.5 }}>
                        {track.channel} · 播放 {track.playCount} 次
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              ))}
            </Box>
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
