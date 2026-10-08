import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import QueueMusicIcon from '@mui/icons-material/QueueMusic'
import { useDispatch, useSelector, useStore } from 'react-redux'
import type { AppDispatch, RootState } from '../../store'
import {
  fetchPlaylists,
  fetchPlaylist,
  deletePlaylist,
  updatePlaylist,
  clearCurrentPlaylist,
} from '../../store/playlistSlice'
import { setPlaylist, setPendingTrack, setIsPlaying, playNow } from '../../store/playerSlice'
import CreatePlaylistDialog from './CreatePlaylistDialog'
import apiService, { type Playlist, type PlaylistWithTracks } from '../../services/api.service'
import PlaybackHistory from '../History/PlaybackHistory'
import { formatDuration } from '../../utils/formatTime'
import type { Track } from '../../types/track.types'
import { createPlaylistPlaybackGuard } from './playlistPlaybackGuard'

interface PlaylistSectionProps {
  onPlaylistSelect?: (playlistId: string) => void
}

export default function PlaylistSection({ onPlaylistSelect }: PlaylistSectionProps) {
  const dispatch = useDispatch<AppDispatch>()
  const store = useStore<RootState>()
  const { playlists, currentPlaylist } = useSelector((state: RootState) => state.playlists)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; playlist: Playlist } | null>(null)
  const [dialogMode, setDialogMode] = useState<'edit' | 'delete' | null>(null)
  const dialogModeRef = useRef<'edit' | 'delete'>('edit')
  const [dialogTarget, setDialogTarget] = useState<Playlist | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [failedRequest, setFailedRequest] = useState<{ id?: string; play?: boolean } | null>(null)
  const [notice, setNotice] = useState('')
  const [cacheStatus, setCacheStatus] = useState<Record<string, boolean>>({})
  const busyRef = useRef(false)
  const requestRef = useRef<{ abort: () => void; cancel: () => void } | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const lastSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      const request = requestRef.current
      requestRef.current = null
      request?.cancel()
      request?.abort()
    }
  }, [])

  const loadList = useCallback(async () => {
    setLoadingList(true)
    setLoadError(null)
    setFailedRequest(null)
    try {
      await dispatch(fetchPlaylists()).unwrap()
    } catch {
      setLoadError('播放清單載入失敗。請檢查連線後重試。')
      setFailedRequest({})
    } finally {
      setLoadingList(false)
    }
  }, [dispatch])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    let active = true
    setCacheStatus({})
    if (!currentPlaylist?.tracks.length) return
    apiService
      .getCacheStatusBatch(currentPlaylist.tracks.map((track) => track.videoId))
      .then((status) => {
        if (!active) return
        setCacheStatus(
          Object.fromEntries(
            Object.entries(status).map(([videoId, value]) => [videoId, value.cached])
          )
        )
      })
      .catch(() => {
        // Cache availability is optional; a failed check must not block the playlist.
      })
    return () => {
      active = false
    }
  }, [currentPlaylist])

  const playTracks = (playlist: PlaylistWithTracks, track: Track = playlist.tracks[0]) => {
    if (!track) return
    dispatch(setPlaylist(playlist.tracks))
    dispatch(setPendingTrack(track))
    dispatch(setIsPlaying(true))
  }

  const loadPlaylist = async (id: string, play = false) => {
    if (requestRef.current) return
    const playbackGuard = createPlaylistPlaybackGuard(store)
    const task = dispatch(fetchPlaylist(id))
    const request = { abort: () => task.abort(), cancel: playbackGuard.cancel }
    requestRef.current = request
    setPendingId(id)
    setLoadError(null)
    setFailedRequest(null)
    lastSelectedRef.current = id
    try {
      const result = await task.unwrap()
      if (requestRef.current !== request) return
      onPlaylistSelect?.(id)
      if (play && playbackGuard.canPlay()) playTracks(result)
    } catch {
      if (requestRef.current !== request) return
      setLoadError('這個播放清單暫時無法開啟。請再試一次。')
      setFailedRequest({ id, play })
    } finally {
      playbackGuard.dispose()
      if (requestRef.current === request) {
        requestRef.current = null
        setPendingId(null)
      }
    }
  }

  const retryLoad = () => {
    if (failedRequest?.id) void loadPlaylist(failedRequest.id, failedRequest.play)
    else void loadList()
  }

  const openMenu = (element: HTMLElement, playlist: Playlist) => {
    returnFocusRef.current = element
    setMenuAnchor({ el: element, playlist })
  }

  const openDialog = (mode: 'edit' | 'delete') => {
    if (!menuAnchor) return
    setDialogTarget(menuAnchor.playlist)
    setEditName(menuAnchor.playlist.name)
    setEditDescription(menuAnchor.playlist.description || '')
    setActionError(null)
    dialogModeRef.current = mode
    setDialogMode(mode)
    setMenuAnchor(null)
  }

  const closeDialog = () => {
    if (!busyRef.current) setDialogMode(null)
  }

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (
      !dialogTarget ||
      !dialogMode ||
      busyRef.current ||
      (dialogMode === 'edit' && !editName.trim())
    )
      return
    busyRef.current = true
    setSaving(true)
    setActionError(null)
    try {
      if (dialogMode === 'edit') {
        await dispatch(
          updatePlaylist({
            playlistId: dialogTarget.id,
            name: editName.trim(),
            description: editDescription.trim(),
          })
        ).unwrap()
        setNotice('播放清單已儲存')
      } else {
        await dispatch(deletePlaylist(dialogTarget.id)).unwrap()
        setNotice(`已刪除「${dialogTarget.name}」`)
      }
      setDialogMode(null)
    } catch {
      setActionError(
        dialogMode === 'edit'
          ? '儲存失敗，修改內容已保留。請再試一次。'
          : '刪除失敗，播放清單仍保留。請再試一次。'
      )
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  const backToList = () => {
    dispatch(clearCurrentPlaylist())
    setLoadError(null)
    setFailedRequest(null)
    requestAnimationFrame(() => {
      const item = lastSelectedRef.current
        ? document.getElementById(`saved-playlist-${lastSelectedRef.current}`)
        : null
      ;(item || createButtonRef.current)?.focus()
    })
  }

  const errorNotice = loadError && (
    <Alert
      severity="error"
      sx={{ mb: 3 }}
      action={
        <Button
          onClick={retryLoad}
          disabled={loadingList || Boolean(pendingId)}
          sx={{ minHeight: 44 }}
        >
          重試
        </Button>
      }
    >
      {loadError}
    </Alert>
  )
  const visibleDialogMode = dialogMode || dialogModeRef.current

  return (
    <Box sx={{ pb: 2 }}>
      {currentPlaylist ? (
        <>
          <Button onClick={backToList} startIcon={<ArrowBackIcon />} sx={{ minHeight: 44, mb: 2 }}>
            返回我的播放清單
          </Button>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            sx={{ mb: 3 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component="h2"
                variant="h4"
                sx={{ fontSize: { xs: 26, sm: 32 }, overflowWrap: 'anywhere', mb: 1 }}
              >
                {currentPlaylist.name}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                {currentPlaylist.trackCount} 首歌曲
              </Typography>
              {currentPlaylist.description && (
                <Typography
                  color="text.secondary"
                  sx={{ mt: 1.5, fontSize: 14, lineHeight: 1.7, overflowWrap: 'anywhere' }}
                >
                  {currentPlaylist.description}
                </Typography>
              )}
            </Box>
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                disabled={!currentPlaylist.tracks.length}
                onClick={() => playTracks(currentPlaylist)}
                sx={{ minHeight: 44, flexGrow: { xs: 1, sm: 0 } }}
              >
                播放全部
              </Button>
              <IconButton
                aria-label={`管理「${currentPlaylist.name}」`}
                onClick={(event) => openMenu(event.currentTarget, currentPlaylist)}
                sx={{ width: 44, height: 44 }}
              >
                <MoreVertIcon />
              </IconButton>
            </Stack>
          </Stack>
          {errorNotice}
          {currentPlaylist.tracks.length ? (
            <List disablePadding aria-label={`${currentPlaylist.name}的歌曲`}>
              {currentPlaylist.tracks.map((track, index) => (
                <ListItem
                  key={`${track.videoId}-${index}`}
                  disablePadding
                  sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <ListItemButton
                    onClick={() => playTracks(currentPlaylist, track)}
                    aria-label={`播放 ${track.title}${cacheStatus[track.videoId] ? '，已快取' : ''}`}
                    sx={{
                      minHeight: 80,
                      px: { xs: 1, sm: 2 },
                      py: 1.5,
                      gap: { xs: 1.5, sm: 2 },
                      m: 0,
                    }}
                  >
                    <Typography
                      color="text.secondary"
                      sx={{ width: 24, flexShrink: 0, fontSize: 12, textAlign: 'center' }}
                    >
                      {index + 1}
                    </Typography>
                    <Box
                      component="img"
                      src={track.thumbnail}
                      alt=""
                      loading="lazy"
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 1,
                        objectFit: 'cover',
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText
                      primary={track.title}
                      secondary={
                        <Box
                          component="span"
                          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                          <Box
                            component="span"
                            sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {track.channel}
                          </Box>
                          {cacheStatus[track.videoId] && (
                            <Box component="span" sx={{ flexShrink: 0 }}>
                              已快取
                            </Box>
                          )}
                        </Box>
                      }
                      primaryTypographyProps={{
                        sx: {
                          fontSize: 15,
                          fontWeight: 600,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        },
                      }}
                      secondaryTypographyProps={{ noWrap: true, sx: { fontSize: 12, mt: 0.5 } }}
                      sx={{ minWidth: 0, my: 0 }}
                    />
                    <Typography
                      color="text.secondary"
                      sx={{ display: { xs: 'none', sm: 'block' }, fontSize: 12, flexShrink: 0 }}
                    >
                      {formatDuration(track.duration)}
                    </Typography>
                    <PlayArrowIcon sx={{ color: 'primary.main', flexShrink: 0 }} />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          ) : (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <QueueMusicIcon sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
              <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
                清單準備好了，加入第一首歌吧
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1, fontSize: 14 }}>
                搜尋喜歡的歌曲，再選擇「加入播放清單」。
              </Typography>
            </Box>
          )}
        </>
      ) : (
        <>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            gap={2}
            sx={{ mb: 3, flexWrap: 'wrap' }}
          >
            <Box>
              <Typography component="h2" variant="h4" sx={{ fontSize: { xs: 26, sm: 32 }, mb: 1 }}>
                我的播放清單
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: 14 }}>
                把喜歡的聲音，留給下一次聆聽。
              </Typography>
            </Box>
            <Button
              ref={createButtonRef}
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateDialogOpen(true)}
              sx={{ minHeight: 44 }}
            >
              建立清單
            </Button>
          </Stack>
          {errorNotice}
          {loadingList ? (
            <Box
              aria-label="正在載入播放清單"
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}
            >
              {[1, 2].map((index) => (
                <Skeleton key={index} variant="rounded" height={152} />
              ))}
            </Box>
          ) : playlists.length ? (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              {playlists.map((playlist) => (
                <Card key={playlist.id} variant="outlined" sx={{ minWidth: 0, boxShadow: 'none' }}>
                  <CardActionArea
                    id={`saved-playlist-${playlist.id}`}
                    onClick={() => void loadPlaylist(playlist.id)}
                    disabled={Boolean(pendingId)}
                    aria-label={`開啟播放清單 ${playlist.name}`}
                    sx={{ p: 2, minHeight: 104, display: 'flex', alignItems: 'center', gap: 2 }}
                  >
                    <Box
                      sx={{
                        bgcolor: 'action.selected',
                        color: 'primary.main',
                        width: 56,
                        height: 56,
                        borderRadius: 1.5,
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <QueueMusicIcon sx={{ fontSize: 28 }} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        component="h3"
                        sx={{ fontSize: 18, fontWeight: 600, overflowWrap: 'anywhere' }}
                      >
                        {playlist.name}
                      </Typography>
                      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 0.5 }}>
                        {playlist.trackCount} 首歌曲
                      </Typography>
                      {playlist.description && (
                        <Typography color="text.secondary" noWrap sx={{ fontSize: 14, mt: 1 }}>
                          {playlist.description}
                        </Typography>
                      )}
                    </Box>
                    {pendingId === playlist.id && (
                      <CircularProgress size={20} aria-label="正在開啟播放清單" />
                    )}
                  </CardActionArea>
                  <Box
                    sx={{
                      px: 2,
                      pb: 1.5,
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Button
                      startIcon={<PlayArrowIcon />}
                      disabled={!playlist.trackCount || Boolean(pendingId)}
                      onClick={() => void loadPlaylist(playlist.id, true)}
                      sx={{ minHeight: 44 }}
                    >
                      播放全部
                    </Button>
                    <IconButton
                      aria-label={`管理「${playlist.name}」`}
                      onClick={(event) => openMenu(event.currentTarget, playlist)}
                      sx={{ width: 44, height: 44 }}
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </Box>
                </Card>
              ))}
            </Box>
          ) : (
            !loadError && (
              <Box
                sx={{
                  py: 6,
                  px: 2,
                  textAlign: 'center',
                  borderTop: '1px solid',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <QueueMusicIcon sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
                <Typography component="h3" sx={{ fontSize: 18, fontWeight: 600 }}>
                  為喜歡的歌曲，建立一個清單
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 14, mt: 1, mb: 3 }}>
                  依心情、時段或一起聽的人，整理你的音樂。
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setCreateDialogOpen(true)}
                  sx={{ minHeight: 44 }}
                >
                  建立第一個播放清單
                </Button>
              </Box>
            )
          )}
          <Divider sx={{ my: 4 }} />
          <Typography component="h2" variant="h5" sx={{ fontSize: 22, mb: 2 }}>
            最近播放
          </Typography>
          <PlaybackHistory onPlay={(track) => dispatch(playNow(track))} />
        </>
      )}

      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        disableRestoreFocus={Boolean(dialogMode)}
      >
        <MenuItem onClick={() => openDialog('edit')} sx={{ minHeight: 44, gap: 1.5 }}>
          <EditIcon fontSize="small" />
          編輯播放清單
        </MenuItem>
        <MenuItem
          onClick={() => openDialog('delete')}
          sx={{ minHeight: 44, gap: 1.5, color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" />
          刪除播放清單
        </MenuItem>
      </Menu>
      <CreatePlaylistDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={() => setNotice('播放清單已建立')}
      />
      <Dialog
        open={Boolean(dialogMode)}
        onClose={closeDialog}
        maxWidth="sm"
        fullWidth
        disableRestoreFocus
        aria-labelledby="playlist-action-title"
        PaperProps={{ sx: { m: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: '100%' } } }}
        TransitionProps={{
          onExited: () => {
            setDialogTarget(null)
            const target = returnFocusRef.current
            ;(target?.isConnected ? target : createButtonRef.current)?.focus()
          },
        }}
      >
        <form onSubmit={handleSave}>
          <DialogTitle id="playlist-action-title">
            {visibleDialogMode === 'delete' ? '刪除播放清單' : '編輯播放清單'}
          </DialogTitle>
          <DialogContent sx={{ pt: '8px !important' }}>
            {actionError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {actionError}
              </Alert>
            )}
            {visibleDialogMode === 'delete' ? (
              <DialogContentText sx={{ fontSize: 15, overflowWrap: 'anywhere' }}>
                確定要刪除「{dialogTarget?.name}」嗎？這個播放清單將無法復原。
              </DialogContentText>
            ) : (
              <>
                <TextField
                  autoFocus
                  fullWidth
                  required
                  label="名稱"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  margin="normal"
                  disabled={saving}
                  inputProps={{ maxLength: 120 }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && event.nativeEvent.isComposing)
                      event.preventDefault()
                  }}
                />
                <TextField
                  fullWidth
                  label="描述（選填）"
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  margin="normal"
                  multiline
                  rows={3}
                  disabled={saving}
                  inputProps={{ maxLength: 500 }}
                />
              </>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button
              autoFocus={visibleDialogMode === 'delete'}
              onClick={closeDialog}
              disabled={saving}
              sx={{ minHeight: 44 }}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="contained"
              color={visibleDialogMode === 'delete' ? 'error' : 'primary'}
              disabled={saving || (visibleDialogMode === 'edit' && !editName.trim())}
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : null}
              sx={{ minHeight: 44, minWidth: 104 }}
            >
              {saving
                ? visibleDialogMode === 'delete'
                  ? '刪除中…'
                  : '儲存中…'
                : visibleDialogMode === 'delete'
                  ? '確認刪除'
                  : '儲存'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice('')}
        message={notice}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ top: 'max(8px, env(safe-area-inset-top, 8px)) !important' }}
      />
    </Box>
  )
}
