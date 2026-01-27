import { useState, useEffect } from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  CircularProgress,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import type { Track } from '../../types/track.types';
import { fetchPlaylists, addTrackToPlaylist } from '../../store/playlistSlice';
import CreatePlaylistDialog from './CreatePlaylistDialog';

interface AddToPlaylistMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  track: Track;
}

export default function AddToPlaylistMenu({ anchorEl, open, onClose, track }: AddToPlaylistMenuProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { playlists, isLoading } = useSelector((state: RootState) => state.playlists);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  useEffect(() => {
    if (open && playlists.length === 0) {
      dispatch(fetchPlaylists());
    }
  }, [open, playlists.length, dispatch]);

  const handleAddToPlaylist = async (playlistId: string) => {
    setAddingTo(playlistId);
    try {
      await dispatch(addTrackToPlaylist({ playlistId, track })).unwrap();
      onClose();
    } catch (error) {
      console.error('Failed to add track to playlist:', error);
    } finally {
      setAddingTo(null);
    }
  };

  const handleCreateNew = () => {
    setCreateDialogOpen(true);
  };

  const handlePlaylistCreated = (playlistId: string) => {
    handleAddToPlaylist(playlistId);
  };

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={onClose}
        PaperProps={{ sx: { minWidth: 200, maxHeight: 400 } }}
      >
        <MenuItem onClick={handleCreateNew}>
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="建立新播放清單" />
        </MenuItem>
        <Divider />
        {isLoading ? (
          <MenuItem disabled>
            <CircularProgress size={20} sx={{ mx: 'auto' }} />
          </MenuItem>
        ) : playlists.length === 0 ? (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">
              尚無播放清單
            </Typography>
          </MenuItem>
        ) : (
          playlists.map((playlist) => (
            <MenuItem
              key={playlist.id}
              onClick={() => handleAddToPlaylist(playlist.id)}
              disabled={addingTo === playlist.id}
            >
              <ListItemIcon>
                {addingTo === playlist.id ? (
                  <CircularProgress size={20} />
                ) : (
                  <PlaylistAddIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={playlist.name}
                secondary={`${playlist.trackCount} 首`}
              />
            </MenuItem>
          ))
        )}
      </Menu>
      <CreatePlaylistDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={handlePlaylistCreated}
      />
    </>
  );
}
