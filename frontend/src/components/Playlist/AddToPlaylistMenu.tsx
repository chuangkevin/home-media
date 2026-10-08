import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CheckIcon from '@mui/icons-material/Check'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../../store'
import type { Track } from '../../types/track.types'
import { fetchPlaylists, addTrackToPlaylist } from '../../store/playlistSlice'
import CreatePlaylistDialog from './CreatePlaylistDialog'

interface AddToPlaylistMenuProps {
  anchorEl: HTMLElement | null
  open: boolean
  onClose: () => void
  track: Track
}

export default function AddToPlaylistMenu({
  anchorEl,
  open,
  onClose,
  track,
}: AddToPlaylistMenuProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { playlists } = useSelector((state: RootState) => state.playlists)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [pendingTitle, setPendingTitle] = useState<string | null>(null)
  const [addedIds, setAddedIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const mountedRef = useRef(true)
  const contextRef = useRef({ videoId: track.videoId, generation: 0 })
  const loadSequenceRef = useRef(0)
  const addSequenceRef = useRef(0)

  useLayoutEffect(() => {
    contextRef.current = {
      videoId: track.videoId,
      generation: contextRef.current.generation + 1,
    }
    setAddedIds([])
    setSuccess(null)
    setError(null)
  }, [open, track.videoId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadPlaylists = useCallback(async () => {
    const requestContext = { ...contextRef.current }
    const sequence = ++loadSequenceRef.current
    const isCurrent = () =>
      mountedRef.current &&
      sequence === loadSequenceRef.current &&
      requestContext.generation === contextRef.current.generation &&
      requestContext.videoId === contextRef.current.videoId
    setLoading(true)
    setError(null)
    setLoadFailed(false)
    try {
      await dispatch(fetchPlaylists()).unwrap()
    } catch {
      if (isCurrent()) {
        setLoadFailed(true)
        setError('播放清單載入失敗，請再試一次。')
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [dispatch])

  useEffect(() => {
    if (open) {
      void loadPlaylists()
    }
  }, [open, track.videoId, loadPlaylists])

  const handleAdd = async (playlistId: string) => {
    if (submittingRef.current || addedIds.includes(playlistId)) return
    const requestTrack = { ...track }
    const requestGeneration = contextRef.current.generation
    const sequence = ++addSequenceRef.current
    const isCurrent = () =>
      mountedRef.current &&
      sequence === addSequenceRef.current &&
      requestGeneration === contextRef.current.generation &&
      requestTrack.videoId === contextRef.current.videoId
    submittingRef.current = true
    setAddingTo(playlistId)
    setPendingTitle(requestTrack.title)
    setError(null)
    setSuccess(null)
    try {
      await dispatch(addTrackToPlaylist({ playlistId, track: requestTrack })).unwrap()
      if (isCurrent()) {
        setAddedIds((ids) => [...ids, playlistId])
        setSuccess(`已將「${requestTrack.title}」加入播放清單`)
      }
    } catch (reason) {
      if (isCurrent()) {
        if (reason === 'already-added') {
          setAddedIds((ids) => [...ids, playlistId])
          setSuccess(`「${requestTrack.title}」已在播放清單中`)
        } else {
          setError('加入失敗，請再點選一次播放清單重試。')
        }
      }
    } finally {
      // Release only this request's submission lock, even if the visible track changed.
      if (sequence === addSequenceRef.current) {
        submittingRef.current = false
        if (mountedRef.current) {
          setAddingTo(null)
          setPendingTitle(null)
        }
      }
    }
  }

  const handleClose = () => {
    if (!submittingRef.current) onClose()
  }

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        open={open && !createDialogOpen}
        onClose={handleClose}
        disableRestoreFocus={createDialogOpen}
        PaperProps={{
          sx: { width: 320, maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(520px, 75dvh)' },
        }}
        MenuListProps={{ 'aria-label': '選擇要加入的播放清單' }}
      >
        <Box component="li" sx={{ listStyle: 'none', px: 2, pt: 1, pb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            加入播放清單
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            title={track.title}
            sx={{ fontSize: 14 }}
          >
            {track.title}
          </Typography>
        </Box>
        <MenuItem
          onClick={() => setCreateDialogOpen(true)}
          disabled={Boolean(addingTo)}
          sx={{ minHeight: 48 }}
        >
          <ListItemIcon>
            <AddIcon />
          </ListItemIcon>
          <ListItemText primary="建立新播放清單" />
        </MenuItem>
        <Divider />
        {pendingTitle && (
          <Box component="li" sx={{ listStyle: 'none', px: 2, py: 1 }}>
            <Typography
              role="status"
              color="text.secondary"
              sx={{ fontSize: 14, overflowWrap: 'anywhere' }}
            >
              正在加入「{pendingTitle}」…
            </Typography>
          </Box>
        )}
        {error && (
          <Box component="li" sx={{ listStyle: 'none', px: 2, py: 1 }}>
            <Alert
              severity="error"
              action={
                loadFailed ? (
                  <Button onClick={() => void loadPlaylists()} sx={{ minHeight: 44 }}>
                    重試
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          </Box>
        )}
        {success && (
          <Box component="li" sx={{ listStyle: 'none', px: 2, py: 1 }}>
            <Alert severity="success" role="status">
              {success}
            </Alert>
          </Box>
        )}
        {loading ? (
          <MenuItem disabled sx={{ minHeight: 64 }}>
            <CircularProgress size={20} sx={{ mr: 2 }} />
            載入播放清單…
          </MenuItem>
        ) : !loadFailed && playlists.length === 0 ? (
          <Box component="li" sx={{ listStyle: 'none', p: 2 }}>
            <Typography color="text.secondary" sx={{ fontSize: 14 }}>
              尚無播放清單，先建立一個吧。
            </Typography>
          </Box>
        ) : (
          playlists.map((playlist) => (
            <MenuItem
              key={playlist.id}
              onClick={() => void handleAdd(playlist.id)}
              disabled={Boolean(addingTo) || addedIds.includes(playlist.id)}
              sx={{ minHeight: 64, whiteSpace: 'normal' }}
            >
              <ListItemIcon>
                {addingTo === playlist.id ? (
                  <CircularProgress size={20} />
                ) : addedIds.includes(playlist.id) ? (
                  <CheckIcon color="success" />
                ) : (
                  <PlaylistAddIcon />
                )}
              </ListItemIcon>
              <ListItemText
                primary={playlist.name}
                secondary={
                  addedIds.includes(playlist.id) ? '已加入' : `${playlist.trackCount} 首歌曲`
                }
                primaryTypographyProps={{ sx: { fontSize: 14, overflowWrap: 'anywhere' } }}
                secondaryTypographyProps={{ sx: { fontSize: 12 } }}
              />
            </MenuItem>
          ))
        )}
        <Divider />
        <MenuItem
          onClick={handleClose}
          disabled={Boolean(addingTo)}
          sx={{ minHeight: 44, justifyContent: 'center', color: 'primary.main' }}
        >
          {success ? '完成' : '取消'}
        </MenuItem>
      </Menu>
      <CreatePlaylistDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(id) => void handleAdd(id)}
      />
    </>
  )
}
