import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Checkbox,
  Typography,
  Box,
  CircularProgress,
} from '@mui/material';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import ComputerIcon from '@mui/icons-material/Computer';
import TvIcon from '@mui/icons-material/Tv';
import type { RootState } from '../../store';
import {
  addCastTarget,
  removeCastTarget,
  setIsController,
  setCastTargets,
} from '../../store/castingSlice';
import { socketService } from '../../services/socket.service';

interface CastDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function CastDialog({ open, onClose }: CastDialogProps) {
  const dispatch = useDispatch();
  const { devices, castTargets, isController } = useSelector(
    (state: RootState) => state.casting
  );
  const { currentTrack, currentTime, isPlaying } = useSelector(
    (state: RootState) => state.player
  );

  // 開啟對話框時發現裝置
  useEffect(() => {
    if (open) {
      socketService.discoverDevices();
    }
  }, [open]);

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'mobile':
        return <PhoneAndroidIcon />;
      case 'tv':
        return <TvIcon />;
      default:
        return <ComputerIcon />;
    }
  };

  const handleToggleDevice = (deviceId: string) => {
    if (castTargets.includes(deviceId)) {
      dispatch(removeCastTarget(deviceId));
    } else {
      dispatch(addCastTarget(deviceId));
    }
  };

  const handleStartCast = () => {
    if (currentTrack && castTargets.length > 0) {
      socketService.startCast(castTargets, currentTrack, currentTime, isPlaying);
      dispatch(setIsController(true));
      onClose();
    }
  };

  const handleStopCast = () => {
    socketService.stopCast(castTargets);
    dispatch(setIsController(false));
    dispatch(setCastTargets([]));
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isController ? '投射中...' : '投射到裝置'}</DialogTitle>

      <DialogContent>
        {devices.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress size={24} sx={{ mb: 2 }} />
            <Typography color="text.secondary">搜尋裝置中...</Typography>
          </Box>
        ) : (
          <List>
            {devices.map((device) => (
              <ListItem key={device.id} disablePadding>
                <ListItemButton onClick={() => handleToggleDevice(device.id)}>
                  <ListItemIcon>
                    <Checkbox
                      edge="start"
                      checked={castTargets.includes(device.id)}
                      tabIndex={-1}
                      disableRipple
                    />
                  </ListItemIcon>
                  <ListItemIcon>{getDeviceIcon(device.type)}</ListItemIcon>
                  <ListItemText
                    primary={device.name}
                    secondary={
                      device.type === 'mobile'
                        ? '手機'
                        : device.type === 'tv'
                          ? '電視'
                          : '電腦'
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        {isController ? (
          <Button onClick={handleStopCast} color="error">
            停止投射
          </Button>
        ) : (
          <Button
            onClick={handleStartCast}
            variant="contained"
            disabled={castTargets.length === 0 || !currentTrack}
          >
            投射 ({castTargets.length})
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
