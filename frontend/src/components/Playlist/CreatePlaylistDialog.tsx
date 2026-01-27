import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import { createPlaylist } from '../../store/playlistSlice';

interface CreatePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (playlistId: string) => void;
}

export default function CreatePlaylistDialog({ open, onClose, onCreated }: CreatePlaylistDialogProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { isCreating } = useSelector((state: RootState) => state.playlists);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      const result = await dispatch(createPlaylist({ name: name.trim(), description: description.trim() || undefined })).unwrap();
      setName('');
      setDescription('');
      onClose();
      onCreated?.(result.id);
    } catch (error) {
      console.error('Failed to create playlist:', error);
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setName('');
      setDescription('');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>建立播放清單</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="名稱"
          value={name}
          onChange={(e) => setName(e.target.value)}
          margin="normal"
          disabled={isCreating}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <TextField
          fullWidth
          label="描述（選填）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          margin="normal"
          multiline
          rows={2}
          disabled={isCreating}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isCreating}>
          取消
        </Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={!name.trim() || isCreating}
          startIcon={isCreating ? <CircularProgress size={16} /> : null}
        >
          建立
        </Button>
      </DialogActions>
    </Dialog>
  );
}
