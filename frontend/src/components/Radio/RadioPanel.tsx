import { useState, useEffect } from 'react';
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
  ListItemSecondaryAction,
  Typography,
  Box,
  TextField,
  Tabs,
  Tab,
  IconButton,
  Chip,
  Avatar,
} from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import PeopleIcon from '@mui/icons-material/People';
import { useRadio } from '../../hooks/useRadio';

interface RadioPanelProps {
  open: boolean;
  onClose: () => void;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div hidden={value !== index} style={{ minHeight: 200 }}>
      {value === index && children}
    </div>
  );
}

export default function RadioPanel({ open, onClose }: RadioPanelProps) {
  const [tabIndex, setTabIndex] = useState(0);
  const [stationName, setStationName] = useState('');
  const {
    stations,
    isHost,
    myStationId,
    myStationName,
    listenerCount,
    isListener,
    currentStationName,
    hostName,
    createStation,
    closeStation,
    joinRadio,
    leaveRadio,
    refreshStations,
  } = useRadio();

  // 開啟對話框時刷新電台列表
  useEffect(() => {
    if (open) {
      refreshStations();
    }
  }, [open, refreshStations]);

  // 如果已經是主播或聽眾，自動切換到對應的 tab
  useEffect(() => {
    if (isHost) {
      setTabIndex(1);
    } else if (isListener) {
      setTabIndex(0);
    }
  }, [isHost, isListener]);

  const handleCreateStation = () => {
    createStation(stationName || undefined);
    setStationName('');
  };

  const handleCloseStation = () => {
    closeStation();
  };

  const handleJoinStation = (stationId: string) => {
    joinRadio(stationId);
    onClose();
  };

  const handleLeaveStation = () => {
    leaveRadio();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <RadioIcon color="primary" />
        電台
      </DialogTitle>

      <Tabs
        value={tabIndex}
        onChange={(_, newValue) => setTabIndex(newValue)}
        sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
      >
        <Tab label="發現電台" />
        <Tab label="開台" />
      </Tabs>

      <DialogContent sx={{ minHeight: 300 }}>
        {/* 發現電台 */}
        <TabPanel value={tabIndex} index={0}>
          {isListener ? (
            // 正在收聽中
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <HeadphonesIcon sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                正在收聽
              </Typography>
              <Typography variant="h5" color="primary" gutterBottom>
                {currentStationName}
              </Typography>
              <Typography color="text.secondary" gutterBottom>
                主播: {hostName}
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={handleLeaveStation}
                sx={{ mt: 2 }}
              >
                離開電台
              </Button>
            </Box>
          ) : stations.length === 0 ? (
            // 沒有電台
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <RadioIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
              <Typography color="text.secondary">目前沒有電台在播放</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                點擊「開台」分享你正在聽的音樂
              </Typography>
              <IconButton onClick={refreshStations} sx={{ mt: 2 }}>
                <RefreshIcon />
              </IconButton>
            </Box>
          ) : (
            // 電台列表
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <IconButton size="small" onClick={refreshStations}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Box>
              <List>
                {stations.map((station) => (
                  <ListItem
                    key={station.id}
                    disablePadding
                    sx={{
                      mb: 1,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                    }}
                  >
                    <ListItemButton
                      onClick={() => handleJoinStation(station.id)}
                      disabled={station.id === myStationId}
                    >
                      <ListItemIcon>
                        {station.currentTrack ? (
                          <Avatar
                            src={station.currentTrack.thumbnail}
                            variant="rounded"
                            sx={{ width: 48, height: 48 }}
                          />
                        ) : (
                          <RadioIcon sx={{ fontSize: 40 }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {station.stationName}
                            {station.isPlaying ? (
                              <PlayArrowIcon fontSize="small" color="success" />
                            ) : (
                              <PauseIcon fontSize="small" color="disabled" />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              主播: {station.hostName}
                            </Typography>
                            {station.currentTrack && (
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {station.currentTrack.title}
                              </Typography>
                            )}
                          </Box>
                        }
                        sx={{ ml: 1 }}
                      />
                      <ListItemSecondaryAction>
                        <Chip
                          icon={<PeopleIcon />}
                          label={station.listenerCount}
                          size="small"
                          variant="outlined"
                        />
                      </ListItemSecondaryAction>
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Box>
          )}
        </TabPanel>

        {/* 開台 */}
        <TabPanel value={tabIndex} index={1}>
          {isHost ? (
            // 已經開台
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <RadioIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                電台播放中
              </Typography>
              <Typography variant="h5" color="primary" gutterBottom>
                {myStationName}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, mb: 2 }}>
                <PeopleIcon color="action" />
                <Typography color="text.secondary">
                  {listenerCount} 位聽眾
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                你的播放內容會同步給所有聽眾
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={handleCloseStation}
              >
                關閉電台
              </Button>
            </Box>
          ) : isListener ? (
            // 正在收聽別人的電台
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <HeadphonesIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
              <Typography color="text.secondary">
                你正在收聽「{currentStationName}」
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                離開電台後才能開始自己的電台
              </Typography>
            </Box>
          ) : (
            // 可以開台
            <Box sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                開始播放後，其他人可以加入收聽你正在播放的音樂
              </Typography>
              <TextField
                fullWidth
                label="電台名稱（選填）"
                placeholder="例如：深夜電台、周杰倫精選..."
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                sx={{ mt: 2 }}
              />
              <Button
                fullWidth
                variant="contained"
                startIcon={<RadioIcon />}
                onClick={handleCreateStation}
                sx={{ mt: 2 }}
              >
                開始直播
              </Button>
            </Box>
          )}
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>關閉</Button>
      </DialogActions>
    </Dialog>
  );
}
