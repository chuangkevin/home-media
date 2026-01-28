import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  IconButton,
  Chip,
  Skeleton,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import { fetchPlaylists, fetchPlaylist, deletePlaylist, updatePlaylist, clearCurrentPlaylist } from '../../store/playlistSlice';
import { setPlaylist, setPendingTrack, setIsPlaying } from '../../store/playerSlice';
import CreatePlaylistDialog from './CreatePlaylistDialog';
import apiService, { type Playlist } from '../../services/api.service';

interface PlaylistSectionProps {
  onPlaylistSelect?: (playlistId: string) => void;
}

export default function PlaylistSection({ onPlaylistSelect }: PlaylistSectionProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { playlists, currentPlaylist, isLoading } = useSelector((state: RootState) => state.playlists);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; playlist: Playlist } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [cacheStatus, setCacheStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    dispatch(fetchPlaylists());
  }, [dispatch]);

  // 當播放清單曲目載入時，檢查伺服器端快取狀態
  useEffect(() => {
    if (!currentPlaylist || currentPlaylist.tracks.length === 0) return;

    const videoIds = currentPlaylist.tracks.map(t => t.videoId);
    apiService.getCacheStatusBatch(videoIds)
      .then(status => {
        const cached: Record<string, boolean> = {};
        for (const [videoId, s] of Object.entries(status)) {
          cached[videoId] = s.cached;
        }
        setCacheStatus(cached);
      })
      .catch(err => {
        console.warn('Failed to fetch cache status:', err);
      });
  }, [currentPlaylist]);

  const handlePlaylistClick = async (playlistId: string) => {
    await dispatch(fetchPlaylist(playlistId));
    onPlaylistSelect?.(playlistId);
  };

  const handlePlayAll = async (playlistId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await dispatch(fetchPlaylist(playlistId)).unwrap();
    if (result && result.tracks.length > 0) {
      dispatch(setPlaylist(result.tracks));
      dispatch(setPendingTrack(result.tracks[0]));
      dispatch(setIsPlaying(true));
    }
  };

  const handleMenuOpen = (e: React.MouseEvent<HTMLElement>, playlist: Playlist) => {
    e.stopPropagation();
    setMenuAnchor({ el: e.currentTarget, playlist });
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleEditClick = () => {
    if (menuAnchor) {
      setEditName(menuAnchor.playlist.name);
      setEditDescription(menuAnchor.playlist.description || '');
      setEditDialogOpen(true);
    }
    handleMenuClose();
  };

  const handleDeleteClick = () => {
    setDeleteDialogOpen(true);
    handleMenuClose();
  };

  const handleEditSave = async () => {
    if (menuAnchor && editName.trim()) {
      await dispatch(updatePlaylist({
        playlistId: menuAnchor.playlist.id,
        name: editName.trim(),
        description: editDescription.trim() || undefined,
      }));
      setEditDialogOpen(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (menuAnchor) {
      await dispatch(deletePlaylist(menuAnchor.playlist.id));
      setDeleteDialogOpen(false);
    }
  };

  const handleBackToList = () => {
    dispatch(clearCurrentPlaylist());
  };

  // 顯示播放清單詳情
  if (currentPlaylist) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Button onClick={handleBackToList} variant="text">
            返回清單
          </Button>
          <Typography variant="h5" sx={{ fontWeight: 600, flexGrow: 1 }}>
            {currentPlaylist.name}
          </Typography>
          <Chip label={`${currentPlaylist.trackCount} 首`} size="small" />
        </Box>
        {currentPlaylist.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {currentPlaylist.description}
          </Typography>
        )}
        {currentPlaylist.tracks.length > 0 ? (
          <>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={() => {
                dispatch(setPlaylist(currentPlaylist.tracks));
                dispatch(setPendingTrack(currentPlaylist.tracks[0]));
                dispatch(setIsPlaying(true));
              }}
              sx={{ mb: 2 }}
            >
              播放全部
            </Button>
            <Grid container spacing={2}>
              {currentPlaylist.tracks.map((track, index) => (
                <Grid item xs={12} sm={6} md={4} key={track.id}>
                  <Card>
                    <CardActionArea
                      onClick={() => {
                        dispatch(setPlaylist(currentPlaylist.tracks));
                        dispatch(setPendingTrack(track));
                        dispatch(setIsPlaying(true));
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', p: 1 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ width: 30 }}>
                          {index + 1}
                        </Typography>
                        <Box sx={{ position: 'relative', mr: 2 }}>
                          <Box
                            component="img"
                            src={track.thumbnail}
                            alt={track.title}
                            sx={{ width: 60, height: 60, borderRadius: 1 }}
                          />
                          {/* 快取狀態標籤 */}
                          <Chip
                            icon={cacheStatus[track.videoId] ? <StorageIcon sx={{ fontSize: 10 }} /> : <CloudIcon sx={{ fontSize: 10 }} />}
                            label={cacheStatus[track.videoId] ? '快取' : '網路'}
                            size="small"
                            sx={{
                              position: 'absolute',
                              bottom: -4,
                              left: '50%',
                              transform: 'translateX(-50%)',
                              height: 16,
                              fontSize: '0.65rem',
                              backgroundColor: cacheStatus[track.videoId] ? 'rgba(46, 125, 50, 0.9)' : 'rgba(25, 118, 210, 0.9)',
                              color: 'white',
                              '& .MuiChip-icon': { color: 'white', ml: 0.5 },
                              '& .MuiChip-label': { px: 0.5 },
                            }}
                          />
                        </Box>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="body1" noWrap sx={{ fontWeight: 500 }}>
                            {track.title}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {track.channel}
                          </Typography>
                        </Box>
                      </Box>
                    </CardActionArea>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </>
        ) : (
          <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            此播放清單尚無曲目
          </Typography>
        )}
      </Box>
    );
  }

  // 顯示播放清單列表
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <QueueMusicIcon />
          <Typography variant="h5" sx={{ fontWeight: 600 }}>
            我的播放清單
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          建立
        </Button>
      </Box>

      {isLoading ? (
        <Grid container spacing={2}>
          {[1, 2, 3].map((i) => (
            <Grid item xs={12} sm={6} md={4} key={i}>
              <Skeleton variant="rounded" height={100} />
            </Grid>
          ))}
        </Grid>
      ) : playlists.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <QueueMusicIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            尚無播放清單
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            建立播放清單來整理你喜愛的歌曲
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            建立第一個播放清單
          </Button>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {playlists.map((playlist) => (
            <Grid item xs={12} sm={6} md={4} key={playlist.id}>
              <Card sx={{ position: 'relative' }}>
                <CardActionArea onClick={() => handlePlaylistClick(playlist.id)}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h6" noWrap sx={{ fontWeight: 600 }}>
                          {playlist.name}
                        </Typography>
                        {playlist.description && (
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {playlist.description}
                          </Typography>
                        )}
                        <Chip
                          label={`${playlist.trackCount} 首`}
                          size="small"
                          sx={{ mt: 1 }}
                        />
                      </Box>
                    </Box>
                  </CardContent>
                </CardActionArea>
                <Box sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 0.5 }}>
                  {playlist.trackCount > 0 && (
                    <IconButton
                      size="small"
                      onClick={(e) => handlePlayAll(playlist.id, e)}
                      sx={{ bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }}
                    >
                      <PlayArrowIcon fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton
                    size="small"
                    onClick={(e) => handleMenuOpen(e, playlist)}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* 選單 */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEditClick}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="編輯" />
        </MenuItem>
        <MenuItem onClick={handleDeleteClick}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText primary="刪除" sx={{ color: 'error.main' }} />
        </MenuItem>
      </Menu>

      {/* 建立對話框 */}
      <CreatePlaylistDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />

      {/* 編輯對話框 */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>編輯播放清單</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="名稱"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            margin="normal"
          />
          <TextField
            fullWidth
            label="描述（選填）"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            margin="normal"
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>取消</Button>
          <Button onClick={handleEditSave} variant="contained" disabled={!editName.trim()}>
            儲存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 刪除確認對話框 */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>刪除播放清單</DialogTitle>
        <DialogContent>
          <Typography>
            確定要刪除「{menuAnchor?.playlist.name}」嗎？此操作無法復原。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>取消</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            刪除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
