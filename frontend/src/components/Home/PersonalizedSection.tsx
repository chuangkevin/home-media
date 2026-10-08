import { useState, useEffect, useCallback, useRef } from 'react'
import { useSelector } from 'react-redux'
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  CardMedia,
  CardContent,
  Skeleton,
  useMediaQuery,
  Alert,
  Button,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import {
  homeMediaCardSx,
  homeMediaTitleSx,
  homeMediaPlaySx,
  homeMediaShelfSx,
} from './homeMediaStyles'
import apiService from '../../services/api.service'
import type { RootState } from '../../store'
import type { Track } from '../../types/track.types'

interface PersonalizedItem {
  videoId: string
  title: string
  channel: string
  thumbnail: string
  duration: number
}

interface PersonalizedData {
  recentlyPlayed: PersonalizedItem[]
  mostPlayed: PersonalizedItem[]
  favorites: PersonalizedItem[]
}

interface PersonalizedSectionProps {
  onPlay: (track: Track) => void
}

export default function PersonalizedSection({ onPlay }: PersonalizedSectionProps) {
  const isDesktop = useMediaQuery('(min-width: 900px)')
  const favoriteIds = useSelector((state: RootState) => state.favorites.favoriteIds)
  const [data, setData] = useState<PersonalizedData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const dataRef = useRef<PersonalizedData | null>(null)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const restoreThrottleRef = useRef(0)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    if (inFlightRef.current) {
      return inFlightRef.current
    }
    const silent = options?.silent && dataRef.current !== null
    if (!silent) {
      setLoading(true)
    }
    setError(false)
    const request = (async () => {
      try {
        const next = await apiService.getPersonalizedRecommendations()
        setData(next)
      } catch (error) {
        setError(true)
        console.error('載入個人化推薦失敗:', error)
        // 前景 refresh / pull 後若請求偶發失敗，保留舊資料避免整區消失。
      } finally {
        if (!silent) {
          setLoading(false)
        }
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = request
    return request
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    if (data !== null) {
      void fetchData({ silent: true })
    }
  }, [fetchData, Object.keys(favoriteIds).sort().join('|')])

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - restoreThrottleRef.current < 1500) return
      restoreThrottleRef.current = now
      if (document.visibilityState === 'visible') {
        void fetchData({ silent: true })
      }
    }
    window.addEventListener('pageshow', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      window.removeEventListener('pageshow', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [fetchData])

  const handlePlay = (item: PersonalizedItem) => {
    const track: Track = {
      id: item.videoId,
      videoId: item.videoId,
      title: item.title,
      channel: item.channel,
      thumbnail: item.thumbnail,
      duration: item.duration || 0,
    }
    onPlay(track)
  }

  const renderRow = (title: string, items: PersonalizedItem[], compact = false) => {
    if (!items || items.length === 0) return null
    const collapsedLimit = compact ? 4 : isDesktop ? 6 : 10
    const canExpand = compact || isDesktop
    const limit = canExpand && expanded[title] ? 20 : collapsedLimit
    const visibleItems = items.slice(0, limit)
    const compactRows = compact
    return (
      <Box component="section" aria-label={title} sx={{ minWidth: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: 2,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700, fontSize: 20 }}>
            {title}
          </Typography>
          {canExpand && items.length > collapsedLimit && (
            <Button
              size="small"
              aria-expanded={Boolean(expanded[title])}
              aria-label={`${expanded[title] ? '收合' : '顯示更多'}${title}`}
              onClick={() => setExpanded((prev) => ({ ...prev, [title]: !prev[title] }))}
              sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              {expanded[title] ? '收合' : '顯示更多'}
            </Button>
          )}
        </Box>
        <Box
          sx={{
            ...homeMediaShelfSx,
            ...(compactRows && {
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                md: 'repeat(2, minmax(0, 1fr))',
              },
              overflowX: 'visible',
              scrollSnapType: 'none',
            }),
          }}
        >
          {visibleItems.map((item) => (
            <Card
              key={item.videoId}
              sx={{
                ...homeMediaCardSx,
                width: compactRows || isDesktop ? '100%' : { xs: 192, sm: 216 },
                flexShrink: 0,
                scrollSnapAlign: 'start',
              }}
            >
              <CardActionArea
                onClick={() => handlePlay(item)}
                aria-label={`播放 ${item.title}，${item.channel}`}
                sx={{
                  height: '100%',
                  display: compactRows ? 'flex' : 'block',
                  textAlign: 'left',
                  p: compactRows ? 1.5 : 0,
                  gap: compactRows ? { xs: 1, sm: 1.5 } : 0,
                  '&.Mui-focusVisible': { outlineOffset: -3 },
                }}
              >
                <Box sx={{ position: 'relative', flexShrink: 0, width: compactRows ? 64 : '100%' }}>
                  <CardMedia
                    component="img"
                    loading="lazy"
                    image={item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`}
                    alt=""
                    sx={{
                      objectFit: 'cover',
                      bgcolor: 'action.selected',
                      width: '100%',
                      aspectRatio: compactRows ? '1' : '16 / 10',
                      borderRadius: compactRows ? 1 : 0,
                    }}
                  />
                  {!compactRows && (
                    <Box
                      aria-hidden="true"
                      sx={{
                        position: 'absolute',
                        right: 8,
                        bottom: 8,
                        ...homeMediaPlaySx,
                      }}
                    >
                      <PlayArrowIcon />
                    </Box>
                  )}
                </Box>
                <CardContent
                  sx={{
                    p: compactRows ? 0 : 1.5,
                    flex: 1,
                    minWidth: 0,
                    '&:last-child': { pb: compactRows ? 0 : 1.5 },
                  }}
                >
                  <Typography variant="body2" sx={homeMediaTitleSx}>
                    {item.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    component="p"
                    color="text.secondary"
                    noWrap
                    sx={{ fontSize: 12, mt: 0.5 }}
                  >
                    {item.channel}
                  </Typography>
                </CardContent>
                {compactRows && (
                  <Box aria-hidden="true" sx={homeMediaPlaySx}>
                    <PlayArrowIcon />
                  </Box>
                )}
              </CardActionArea>
            </Card>
          ))}
        </Box>
      </Box>
    )
  }

  if (loading && !data) {
    return (
      <Box role="status" aria-label="載入你的音樂" sx={{ mb: 4, minWidth: 0 }}>
        <Skeleton animation={false} variant="text" width={120} height={32} sx={{ mb: 1.5 }} />
        <Box
          sx={{
            ...homeMediaShelfSx,
            overflow: 'hidden',
          }}
        >
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton
              key={i}
              animation={false}
              variant="rounded"
              width={isDesktop ? '100%' : undefined}
              height={180}
              sx={{ borderRadius: 2, flexShrink: 0, width: { xs: 192, sm: 216, md: '100%' } }}
            />
          ))}
        </Box>
      </Box>
    )
  }

  const hasContent = Boolean(
    data && (data.recentlyPlayed.length || data.mostPlayed.length || data.favorites.length)
  )
  if (!hasContent && !error) return null

  return (
    <Box sx={{ display: 'grid', gap: 3, minWidth: 0, mb: data || error ? 4 : 0 }}>
      {error && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              onClick={() => void fetchData()}
              disabled={loading}
              sx={{ minHeight: 44 }}
            >
              重試
            </Button>
          }
        >
          {hasContent
            ? '暫時無法更新你的音樂，已保留目前內容。'
            : '暫時無法載入你的音樂，請稍後再試。'}
        </Alert>
      )}
      {data && (
        <>
          {renderRow('最近播放', data.recentlyPlayed)}
          {renderRow('常聽的歌', data.mostPlayed, true)}
          {renderRow('我的收藏', data.favorites, true)}
        </>
      )}
    </Box>
  )
}
