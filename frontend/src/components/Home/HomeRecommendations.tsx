import { useEffect, useRef, useCallback, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Box, Typography, CircularProgress, Button, Alert, Chip, Skeleton } from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import { RootState, AppDispatch } from '../../store'
import {
  fetchChannelRecommendations,
  loadMoreRecommendations,
  refreshRecommendations,
} from '../../store/recommendationSlice'
import { playNow } from '../../store/playerSlice'
import ChannelSection from './ChannelSection'
import PersonalizedSection from './PersonalizedSection'
import type { Track } from '../../types/track.types'
import apiService from '../../services/api.service'
import audioCacheService from '../../services/audio-cache.service'
import lyricsCacheService from '../../services/lyrics-cache.service'

interface HomeRecommendationsProps {
  onSearch?: (query: string) => void
}

export default function HomeRecommendations({ onSearch }: HomeRecommendationsProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { channelRecommendations, loading, hasMore, error } = useSelector(
    (state: RootState) => state.recommendation
  )
  // playlist selector removed - playNow handles insertion

  const observerRef = useRef<IntersectionObserver | null>(null)
  const restoreThrottleRef = useRef(0)
  const [cacheStatus, setCacheStatus] = useState<Map<string, boolean>>(new Map())
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set())
  const [hideError, setHideError] = useState<string | null>(null)

  const visibleRecommendations = channelRecommendations.filter(
    (channel) => !hiddenChannels.has(channel.channelName)
  )

  useEffect(() => {
    if (channelRecommendations.length === 0) {
      dispatch(fetchChannelRecommendations({ page: 0, pageSize: 5, mixed: true }))
    }
  }, [dispatch, channelRecommendations.length])

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - restoreThrottleRef.current < 1500) return
      restoreThrottleRef.current = now
      if (
        document.visibilityState === 'visible' &&
        channelRecommendations.length === 0 &&
        !loading &&
        !error
      ) {
        dispatch(fetchChannelRecommendations({ page: 0, pageSize: 5, mixed: true }))
      }
    }

    window.addEventListener('pageshow', handleVisible)
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      window.removeEventListener('pageshow', handleVisible)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [dispatch, channelRecommendations.length, loading, error])

  useEffect(() => {
    setHiddenChannels(new Set())
  }, [channelRecommendations])

  // 檢查所有影片的快取狀態 + 自動預載未快取的音樂和歌詞
  useEffect(() => {
    let isActive = true // 用於取消預載

    const checkAndPreload = async () => {
      const allVideos = channelRecommendations.flatMap((channel) =>
        channel.videos.map((v) => ({
          videoId: v.videoId,
          title: v.title,
          channel: channel.channelName,
          thumbnail: v.thumbnail,
          duration: v.duration,
        }))
      )

      if (allVideos.length === 0) return

      try {
        // 檢查音訊快取狀態
        const allVideoIds = allVideos.map((v) => v.videoId)
        const audioStatusMap = await audioCacheService.hasMany(allVideoIds)
        if (!isActive) return
        setCacheStatus(audioStatusMap)

        const audioCachedCount = Array.from(audioStatusMap.values()).filter((v) => v).length
        console.log(`📊 音訊快取狀態: ${audioCachedCount}/${allVideoIds.length} 已快取`)

        // 檢查歌詞快取狀態
        const lyricCandidates = allVideos.slice(0, 2)
        const lyricsStatusMap = await lyricsCacheService.hasMany(
          lyricCandidates.map((video) => video.videoId)
        )
        const lyricsCachedCount = Array.from(lyricsStatusMap.values()).filter((v) => v).length
        console.log(`📝 歌詞快取狀態: ${lyricsCachedCount}/${lyricCandidates.length} 已快取`)

        // 找出未快取的音訊，過濾掉合輯/超長影片（>10 分鐘），逐個預載
        const uncachedAudios = allVideos.filter(
          (v) => !audioStatusMap.get(v.videoId) && v.duration > 0 && v.duration <= 600
        )
        const uncachedLyrics = lyricCandidates.filter((v) => !lyricsStatusMap.get(v.videoId))

        // 只預載前 2 首（避免首頁載入時佔滿頻寬，其餘等播放時再下載）
        const HOMEPAGE_PRELOAD_LIMIT = 2
        const preloadAudios = uncachedAudios.slice(0, HOMEPAGE_PRELOAD_LIMIT)

        if (preloadAudios.length > 0 && isActive) {
          console.log(
            `🔄 預載首頁前 ${preloadAudios.length} 首（共 ${uncachedAudios.length} 首未快取）`
          )

          // 並行預載（不序列等待）
          await Promise.all(
            preloadAudios.map(async (video) => {
              if (!isActive) return
              try {
                await apiService.preloadAudio(video.videoId)
                console.log(`✅ 音訊預載已排入後端低優先級佇列: ${video.title}`)
              } catch (err) {
                console.warn(`⚠️ 音訊預載失敗: ${video.title}`, err)
              }
            })
          )
        }

        if (uncachedLyrics.length > 0 && isActive) {
          console.log(`🔄 開始預載 ${uncachedLyrics.length} 首未快取的歌詞...`)

          for (const video of uncachedLyrics) {
            if (!isActive) break

            try {
              const lyrics = await apiService.getLyricsForPreload(
                video.videoId,
                video.title,
                video.channel
              )
              if (lyrics && isActive) {
                await lyricsCacheService.set(video.videoId, lyrics)
                console.log(`✅ 歌詞預載完成: ${video.title}`)
              } else {
                console.log(`⏭️ 無歌詞: ${video.title}`)
              }
            } catch (err) {
              console.warn(`⚠️ 歌詞預載失敗: ${video.title}`, err)
            }
          }

          if (isActive) {
            console.log(`🎉 所有推薦歌詞預載完成！`)
          }
        }
      } catch (error) {
        console.error('檢查快取狀態失敗:', error)
      }
    }

    const preloadTimeout = window.setTimeout(() => void checkAndPreload(), 3000)

    // 監聽快取更新事件，即時更新顯示狀態
    const handleCacheUpdated = (event: CustomEvent<{ videoId: string }>) => {
      const { videoId } = event.detail
      setCacheStatus((prev) => {
        const updated = new Map(prev)
        updated.set(videoId, true)
        return updated
      })
    }

    window.addEventListener('audio-cache-updated', handleCacheUpdated as EventListener)
    return () => {
      isActive = false // 取消預載
      window.clearTimeout(preloadTimeout)
      window.removeEventListener('audio-cache-updated', handleCacheUpdated as EventListener)
    }
  }, [channelRecommendations])

  const lastChannelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect()
      if (loading || error || !node) return

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore) {
            dispatch(loadMoreRecommendations())
          }
        },
        { rootMargin: '0px 0px 600px 0px' }
      )

      if (node) observerRef.current.observe(node)
    },
    [loading, hasMore, dispatch, error]
  )

  useEffect(() => () => observerRef.current?.disconnect(), [])

  const handlePlay = (track: Track) => {
    // Fire-and-forget，不阻塞播放（只在 channel 存在時記錄）
    if (track.channel) {
      apiService.recordChannelWatch(track.channel, track.thumbnail)
    }

    // YouTube 風格：點歌 → 插入到下一首位置並立即播放
    // 不再把整個頻道的歌都加進去
    dispatch(playNow(track))
  }

  const handleRefresh = () => {
    dispatch(refreshRecommendations())
  }

  const handleHideChannel = async (channelName: string) => {
    setHideError(null)
    try {
      setHiddenChannels((prev) => new Set(prev).add(channelName))
      await apiService.hideChannel(channelName)
      console.log(`🚫 已隱藏頻道: ${channelName}`)
      // 刷新推薦列表
      dispatch(refreshRecommendations())
    } catch (error) {
      setHiddenChannels((prev) => {
        const next = new Set(prev)
        next.delete(channelName)
        return next
      })
      console.error('隱藏頻道失敗:', error)
      setHideError(channelName)
    }
  }

  return (
    <Box className="home-recommendations" sx={{ width: '100%', minWidth: 0 }}>
      <PersonalizedSection onPlay={handlePlay} />
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          mb: 3,
        }}
      >
        <Typography
          variant="h5"
          component="h2"
          sx={{ fontWeight: 700, fontSize: { xs: 20, sm: 24 }, minWidth: 0 }}
        >
          為你推薦
        </Typography>
        <Button
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
          onClick={handleRefresh}
          variant="outlined"
          disabled={loading}
          sx={{ minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          重新整理
        </Button>
      </Box>

      {error && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={
            <Button
              color="inherit"
              onClick={handleRefresh}
              disabled={loading}
              sx={{ minHeight: 44 }}
            >
              重試
            </Button>
          }
        >
          推薦暫時無法更新。你仍可播放目前的歌曲，或稍後再試。
        </Alert>
      )}
      {hideError && (
        <Alert
          severity="warning"
          sx={{ mb: 3, '& .MuiAlert-message': { overflowWrap: 'anywhere' } }}
          action={
            <Button
              color="inherit"
              onClick={() => void handleHideChannel(hideError)}
              sx={{ minHeight: 44 }}
            >
              重試
            </Button>
          }
        >
          無法隱藏「{hideError}」，推薦已恢復。
        </Alert>
      )}

      <Box className="home-channel-grid" data-testid="home-channel-grid">
        {visibleRecommendations.map((channel, index) => (
          <div
            key={`${channel.channelName}-${index}`}
            ref={index === visibleRecommendations.length - 1 ? lastChannelRef : null}
          >
            <ChannelSection
              channel={channel}
              onPlay={handlePlay}
              onHideChannel={handleHideChannel}
              cacheStatus={cacheStatus}
              onChannelSearch={onSearch}
            />
          </div>
        ))}
      </Box>

      {visibleRecommendations.length === 0 && !loading && !error && (
        <Box
          sx={{
            py: { xs: 4, sm: 5 },
            px: { xs: 2, sm: 3 },
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'action.hover',
            textAlign: 'center',
          }}
        >
          <Typography
            variant="h6"
            component="h3"
            sx={{ fontSize: { xs: 20, sm: 24 }, fontWeight: 700 }}
          >
            從一首喜歡的歌開始
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>
            搜尋歌曲或歌手，讓這裡慢慢成為你的音樂收藏。
          </Typography>
          {onSearch && (
            <Box
              sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1, mt: 3 }}
            >
              {['爵士', '鋼琴', '華語'].map((genre) => (
                <Chip
                  key={genre}
                  label={genre}
                  onClick={() => onSearch(genre)}
                  variant="outlined"
                  sx={{ minHeight: 44, fontSize: 14, px: 1 }}
                />
              ))}
            </Box>
          )}
        </Box>
      )}

      {loading && channelRecommendations.length === 0 && (
        <Box role="status" aria-label="載入推薦歌曲">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            正在尋找適合你的音樂
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: 'repeat(4, minmax(0, 1fr))',
              },
              gap: 2,
            }}
          >
            {[1, 2, 3, 4].map((item) => (
              <Box key={item} sx={{ minWidth: 0 }}>
                <Skeleton
                  animation={false}
                  variant="rounded"
                  sx={{ aspectRatio: '16 / 10', height: 'auto' }}
                />
                <Skeleton animation={false} width="85%" sx={{ mt: 1 }} />
                <Skeleton animation={false} width="55%" />
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {loading && channelRecommendations.length > 0 && (
        <Box
          role="status"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3, gap: 1.5 }}
        >
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            正在更新推薦歌曲
          </Typography>
        </Box>
      )}
      {!hasMore && channelRecommendations.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          推薦已看完，播放更多音樂，發現下一首喜歡的歌。
        </Typography>
      )}
    </Box>
  )
}
