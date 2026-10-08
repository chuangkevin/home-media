import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../../store'
import { createPlaylist } from '../../store/playlistSlice'

interface CreatePlaylistDialogProps {
  open: boolean
  onClose: () => void
  onCreated?: (playlistId: string) => void
}

export default function CreatePlaylistDialog({
  open,
  onClose,
  onCreated,
}: CreatePlaylistDialogProps) {
  const dispatch = useDispatch<AppDispatch>()
  const { isCreating } = useSelector((state: RootState) => state.playlists)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setError(null)
    }
  }, [open])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || submittingRef.current || isCreating) return
    submittingRef.current = true
    setError(null)
    try {
      const result = await dispatch(
        createPlaylist({ name: name.trim(), description: description.trim() || undefined })
      ).unwrap()
      onClose()
      onCreated?.(result.id)
    } catch {
      setError('建立失敗，內容已保留。請檢查連線後再試一次。')
    } finally {
      submittingRef.current = false
    }
  }

  const handleClose = () => {
    if (!submittingRef.current && !isCreating) onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="create-playlist-title"
      PaperProps={{ sx: { m: { xs: 2, sm: 4 }, width: { xs: 'calc(100% - 32px)', sm: '100%' } } }}
    >
      <form onSubmit={handleCreate}>
        <DialogTitle id="create-playlist-title">建立播放清單</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <DialogContentText sx={{ mb: 2, fontSize: 14 }}>
            為喜歡的歌曲留一個位置。
          </DialogContentText>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            autoFocus
            fullWidth
            required
            label="名稱"
            value={name}
            onChange={(event) => setName(event.target.value)}
            margin="normal"
            disabled={isCreating}
            inputProps={{ maxLength: 120 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
            }}
          />
          <TextField
            fullWidth
            label="描述（選填）"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            margin="normal"
            multiline
            rows={3}
            disabled={isCreating}
            inputProps={{ maxLength: 500 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button onClick={handleClose} disabled={isCreating} sx={{ minHeight: 44 }}>
            取消
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={!name.trim() || isCreating}
            sx={{ minHeight: 44, minWidth: 112 }}
            startIcon={isCreating ? <CircularProgress size={18} color="inherit" /> : null}
          >
            {isCreating ? '建立中…' : '建立清單'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
