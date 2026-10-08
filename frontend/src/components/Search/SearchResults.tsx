import { useState, useEffect, useRef, useMemo } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import {
  Box,
  Card,
  CardActionArea,
  Typography,
  IconButton,
  Chip,
  Menu,
  MenuItem,
  Snackbar,
  Button,
  Tabs,
  Tab,
  Alert,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import AddIcon from '@mui/icons-material/Add'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import BlockIcon from '@mui/icons-material/Block'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import MusicNoteIcon from '@mui/icons-material/MusicNote'
import PersonIcon from '@mui/icons-material/Person'
import type { Track } from '../../types/track.types'
import { formatDuration } from '../../utils/formatTime'
import AddToPlaylistMenu from '../Playlist/AddToPlaylistMenu'
import apiService from '../../services/api.service'
import { RootState, AppDispatch } from '../../store'
import { blockItem, unblockItem } from '../../store/blockSlice'
import { toggleFavorite } from '../../store/favoritesSlice'

const PAGE_SIZE = 12
const actionSize = { width: 44, height: 44, flexShrink: 0 }

interface SearchResultsProps {
  results: Track[]
  onPlay: (track: Track) => void
  onAddToQueue?: (track: Track) => void
  currentTrackId?: string
}

export default function SearchResults({
  results,
  onPlay,
  onAddToQueue,
  currentTrackId,
}: SearchResultsProps) {
  const dispatch = useDispatch<AppDispatch>()
  const blockedItems = useSelector((state: RootState) => state.block.items)
  const favoriteIds = useSelector((state: RootState) => state.favorites.favoriteIds)
  const [playlistMenuAnchor, setPlaylistMenuAnchor] = useState<HTMLElement | null>(null)
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null)
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set())
  const [cacheStatus, setCacheStatus] = useState<Record<string, boolean>>({})
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [activeTab, setActiveTab] = useState(0)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const [blockMenuAnchor, setBlockMenuAnchor] = useState<HTMLElement | null>(null)
  const [blockMenuTrack, setBlockMenuTrack] = useState<Track | null>(null)
  const [snackbar, setSnackbar] = useState<{
    message: string
    blockedId?: number
    severity: 'success' | 'error'
  } | null>(null)
  const visibleResults = results.slice(0, visibleCount)
  const hasMore = visibleCount < results.length

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
    setActiveTab(0)
  }, [results])

  useEffect(() => {
    let active = true
    const unchecked = results
      .slice(0, visibleCount)
      .filter((track) => !(track.videoId in cacheStatus))
    if (unchecked.length) {
      apiService
        .getCacheStatusBatch(unchecked.map((track) => track.videoId))
        .then((status) => {
          if (!active) return
          const cached: Record<string, boolean> = {}
          for (const [videoId, value] of Object.entries(status)) cached[videoId] = value.cached
          setCacheStatus((prev) => ({ ...prev, ...cached }))
        })
        .catch(() => {
          /* Cache availability is optional metadata. */
        })
    }
    return () => {
      active = false
    }
  }, [results, visibleCount])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting)
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, results.length))
      },
      { rootMargin: '200px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, results.length, visibleCount, activeTab])

  const channelGroups = useMemo(() => {
    const groups: Record<string, Track[]> = {}
    results.slice(0, visibleCount).forEach((track) => {
      const channel = track.channel || '未知頻道'
      ;(groups[channel] ||= []).push(track)
    })
    return groups
  }, [results, visibleCount])

  const closeBlockMenu = () => {
    setBlockMenuAnchor(null)
    setBlockMenuTrack(null)
  }
  const handleBlock = async (type: 'song' | 'channel') => {
    const track = blockMenuTrack
    if (!track) return
    closeBlockMenu()
    try {
      const result = await dispatch(
        blockItem(
          type === 'song'
            ? { type, videoId: track.videoId, title: track.title, thumbnail: track.thumbnail }
            : { type, channelName: track.channel, title: track.channel, thumbnail: track.thumbnail }
        )
      ).unwrap()
      setSnackbar({
        message: type === 'song' ? `已封鎖「${track.title}」` : `已封鎖頻道「${track.channel}」`,
        blockedId: result.newId,
        severity: 'success',
      })
    } catch {
      setSnackbar({ message: '封鎖失敗，請再試一次。', severity: 'error' })
    }
  }
  const handleUndoBlock = async () => {
    if (!snackbar?.blockedId) return
    try {
      await dispatch(unblockItem(snackbar.blockedId)).unwrap()
      setSnackbar({ message: '已復原封鎖', severity: 'success' })
    } catch {
      setSnackbar({ message: '復原失敗，請至設定中的封鎖管理重試。', severity: 'error' })
    }
  }

  const renderTrack = (track: Track) => {
    const blocked = blockedItems.some(
      (item) =>
        (item.type === 'song' && item.video_id === track.videoId) ||
        (item.type === 'channel' && item.channel_name === track.channel)
    )
    const isCurrent = currentTrackId === track.videoId
    const isFavorite = !!favoriteIds[track.videoId]
    return (
      <Card
        key={track.videoId}
        component="article"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          minWidth: 0,
          border: 1,
          borderColor: isCurrent ? 'primary.main' : 'divider',
          boxShadow: 'none',
          bgcolor: isCurrent ? 'action.selected' : 'background.paper',
          overflow: 'hidden',
        }}
      >
        <CardActionArea
          onClick={() => onPlay(track)}
          aria-label={`播放 ${track.title}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            flex: 1,
            minWidth: 0,
            p: { xs: 1.5, sm: 2 },
            gap: { xs: 1.5, sm: 2 },
          }}
        >
          <Box
            sx={{
              position: 'relative',
              width: { xs: 64, sm: 72 },
              height: { xs: 64, sm: 72 },
              flexShrink: 0,
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'action.hover',
            }}
          >
            <Box
              component="img"
              src={track.thumbnail}
              alt=""
              loading="lazy"
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <Box
              sx={{
                position: 'absolute',
                bottom: 4,
                right: 4,
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 18 }} />
            </Box>
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <Typography
              component="h3"
              sx={{
                fontSize: { xs: 14, sm: 16 },
                lineHeight: 1.5,
                fontWeight: 600,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
              }}
            >
              {track.title}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              noWrap
              sx={{ mt: 0.25, fontSize: 13 }}
            >
              {track.channel || '未知頻道'}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
              >
                {formatDuration(track.duration)}
              </Typography>
              {isCurrent && (
                <Typography
                  component="span"
                  variant="caption"
                  color="primary.main"
                  sx={{ fontSize: 12, fontWeight: 600 }}
                >
                  正在播放
                </Typography>
              )}
              {cacheStatus[track.videoId] && (
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontSize: 12 }}
                >
                  已快取
                </Typography>
              )}
              {blocked && (
                <Chip
                  icon={<BlockIcon />}
                  label="已封鎖推薦"
                  size="small"
                  sx={{ height: 24, fontSize: 12 }}
                />
              )}
            </Box>
          </Box>
        </CardActionArea>
        <Box
          sx={{
            display: 'flex',
            justifyContent: { xs: 'flex-end', md: 'center' },
            alignItems: 'center',
            px: { xs: 1, sm: 1.5 },
            py: { xs: 0.5, md: 1 },
            gap: 0.5,
            borderTop: { xs: 1, md: 0 },
            borderColor: 'divider',
            flexShrink: 0,
          }}
        >
          {onAddToQueue && (
            <IconButton
              sx={actionSize}
              aria-label={`將 ${track.title} 加入待播`}
              title="加入待播"
              onClick={() => onAddToQueue(track)}
            >
              <AddIcon />
            </IconButton>
          )}
          <IconButton
            sx={actionSize}
            aria-label={`將 ${track.title} 加入播放清單`}
            title="加入播放清單"
            onClick={(event) => {
              setPlaylistMenuAnchor(event.currentTarget)
              setSelectedTrack(track)
            }}
          >
            <PlaylistAddIcon />
          </IconButton>
          <IconButton
            sx={actionSize}
            aria-label={`${isFavorite ? '取消收藏' : '收藏'} ${track.title}`}
            aria-pressed={isFavorite}
            disabled={pendingFavorites.has(track.videoId)}
            title={isFavorite ? '取消收藏' : '收藏'}
            onClick={async () => {
              if (pendingFavorites.has(track.videoId)) return
              setPendingFavorites((previous) => new Set(previous).add(track.videoId))
              try {
                await dispatch(
                  toggleFavorite({
                    videoId: track.videoId,
                    title: track.title,
                    channel: track.channel,
                    thumbnail: track.thumbnail,
                    duration: track.duration,
                  })
                ).unwrap()
              } catch {
                setSnackbar({ message: '收藏更新失敗，請再試一次。', severity: 'error' })
              } finally {
                setPendingFavorites((previous) => {
                  const next = new Set(previous)
                  next.delete(track.videoId)
                  return next
                })
              }
            }}
          >
            {isFavorite ? <FavoriteIcon color="error" /> : <FavoriteBorderIcon />}
          </IconButton>
          <IconButton
            sx={actionSize}
            aria-label={`${track.title} 的更多選項`}
            aria-haspopup="menu"
            title="更多選項"
            onClick={(event) => {
              setBlockMenuAnchor(event.currentTarget)
              setBlockMenuTrack(track)
            }}
          >
            <MoreVertIcon />
          </IconButton>
        </Box>
      </Card>
    )
  }

  if (!results.length)
    return (
      <Box sx={{ py: 6, px: 2, textAlign: 'center' }}>
        <MusicNoteIcon sx={{ color: 'text.secondary', fontSize: 32, mb: 1.5 }} />
        <Typography component="h2" sx={{ fontSize: 22, fontWeight: 600 }}>
          沒有找到結果
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          試試歌曲名稱、歌手，或較短的關鍵字。
        </Typography>
      </Box>
    )

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ fontSize: { xs: 22, sm: 24 }, fontWeight: 600 }}>
          搜尋結果
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {results.length} 首曲目
        </Typography>
      </Box>
      <Tabs
        value={activeTab}
        onChange={(_, value) => setActiveTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="搜尋結果顯示方式"
        sx={{
          mb: 2,
          minHeight: 48,
          borderBottom: 1,
          borderColor: 'divider',
          '& .MuiTab-root': { minHeight: 48, fontSize: 14 },
        }}
      >
        <Tab
          id="search-tracks-tab"
          aria-controls="search-results-panel"
          icon={<MusicNoteIcon fontSize="small" />}
          iconPosition="start"
          label="曲目"
        />
        <Tab
          id="search-channels-tab"
          aria-controls="search-results-panel"
          icon={<PersonIcon fontSize="small" />}
          iconPosition="start"
          label="依頻道"
        />
      </Tabs>
      <Box
        id="search-results-panel"
        role="tabpanel"
        aria-labelledby={activeTab === 0 ? 'search-tracks-tab' : 'search-channels-tab'}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {activeTab === 0
          ? visibleResults.map(renderTrack)
          : Object.entries(channelGroups).map(([channel, tracks]) => (
              <Box component="section" key={channel} sx={{ mb: 1.5, minWidth: 0 }}>
                <Typography
                  component="h3"
                  sx={{ fontSize: 18, fontWeight: 600, mb: 1.5, overflowWrap: 'anywhere' }}
                >
                  {channel}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {tracks.map(renderTrack)}
                </Box>
              </Box>
            ))}
      </Box>
      {hasMore && (
        <Box ref={loadMoreRef} sx={{ textAlign: 'center', py: 3 }}>
          <Button
            variant="outlined"
            sx={{ minHeight: 44 }}
            onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, results.length))}
          >
            顯示更多曲目
          </Button>
        </Box>
      )}
      {selectedTrack && (
        <AddToPlaylistMenu
          anchorEl={playlistMenuAnchor}
          open={Boolean(playlistMenuAnchor)}
          track={selectedTrack}
          onClose={() => {
            setPlaylistMenuAnchor(null)
            setSelectedTrack(null)
          }}
        />
      )}
      <Menu anchorEl={blockMenuAnchor} open={Boolean(blockMenuAnchor)} onClose={closeBlockMenu}>
        <MenuItem onClick={() => handleBlock('song')} sx={{ minHeight: 48 }}>
          <BlockIcon sx={{ mr: 1.5, fontSize: 20 }} />
          封鎖這首歌的推薦
        </MenuItem>
        <MenuItem onClick={() => handleBlock('channel')} sx={{ minHeight: 48 }}>
          <BlockIcon sx={{ mr: 1.5, fontSize: 20 }} />
          封鎖此頻道的推薦
        </MenuItem>
      </Menu>
      <Snackbar
        open={!!snackbar}
        autoHideDuration={snackbar?.severity === 'error' ? null : 5000}
        onClose={() => setSnackbar(null)}
      >
        <Alert
          severity={snackbar?.severity || 'success'}
          onClose={() => setSnackbar(null)}
          sx={{
            alignItems: 'center',
            maxWidth: '100%',
            '& .MuiAlert-message': { overflowWrap: 'anywhere' },
          }}
          action={
            snackbar?.blockedId ? (
              <Button color="inherit" sx={{ minHeight: 44 }} onClick={handleUndoBlock}>
                復原
              </Button>
            ) : undefined
          }
        >
          {snackbar?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
