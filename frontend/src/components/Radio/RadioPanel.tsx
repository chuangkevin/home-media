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
  const [djName, setDjName] = useState('');
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

  // 如果已經是 DJ 或聽眾，自動切換到對應的 tab
  useEffect(() => {
    if (isHost) {
      setTabIndex(1);
    } else if (isListener) {
      setTabIndex(0);
    }
  }, [isHost, isListener]);

  const handleCreateStation = () => {
    createStation(stationName || undefined, djName || undefined);
    setStationName('');
    setDjName('');
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
        Radio
      </DialogTitle>

      <Tabs
        value={tabIndex}
        onChange={(_, newValue) => setTabIndex(newValue)}
        sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
      >
        <Tab label="Discover" />
        <Tab label="On Air" />
      </Tabs>

      <DialogContent sx={{ minHeight: 300 }}>
        {/* 發現電台 */}
        <TabPanel value={tabIndex} index={0}>
          {isListener ? (
            // 正在收聽中
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <HeadphonesIcon sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                Listening
              </Typography>
              <Typography variant="h5" color="primary" gutterBottom>
                {currentStationName}
              </Typography>
              <Typography color="text.secondary" gutterBottom>
                DJ: {hostName}
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={handleLeaveStation}
                sx={{ mt: 2 }}
              >
                Leave
              </Button>
            </Box>
          ) : stations.length === 0 ? (
            // 沒有電台
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <RadioIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
              <Typography color="text.secondary">No stations on air</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Go to "On Air" tab to start your own station
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
                        primaryTypographyProps={{ component: 'div' }}
                        secondary={
                          <Box>
                            <Typography variant="body2" color="text.secondary">
                              DJ: {station.hostName}
                            </Typography>
                            {station.currentTrack && (
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {station.currentTrack.title}
                              </Typography>
                            )}
                          </Box>
                        }
                        secondaryTypographyProps={{ component: 'div' }}
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

        {/* On Air */}
        <TabPanel value={tabIndex} index={1}>
          {isHost ? (
            // 已經開台
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <RadioIcon sx={{ fontSize: 60, color: 'success.main', mb: 2 }} />
              <Chip
                label="ON AIR"
                color="error"
                sx={{ mb: 2, fontWeight: 700, animation: 'pulse 2s infinite' }}
              />
              <Typography variant="h5" color="primary" gutterBottom>
                {myStationName}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, mb: 2 }}>
                <PeopleIcon color="action" />
                <Typography color="text.secondary">
                  {listenerCount} listeners
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Your playback is synced to all listeners
              </Typography>
              <Button
                variant="outlined"
                color="error"
                onClick={handleCloseStation}
              >
                Stop Broadcasting
              </Button>
            </Box>
          ) : isListener ? (
            // 正在收聽別人的電台
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <HeadphonesIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
              <Typography color="text.secondary">
                You're listening to "{currentStationName}"
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Leave the station first to go on air
              </Typography>
            </Box>
          ) : (
            // 可以開台
            <Box sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Start broadcasting and share what you're listening to with others
              </Typography>
              <TextField
                fullWidth
                label="Station Name"
                placeholder="e.g., Late Night Vibes, Chill Hits..."
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                sx={{ mt: 2 }}
              />
              <TextField
                fullWidth
                label="DJ Name"
                placeholder="Your DJ name (optional)"
                value={djName}
                onChange={(e) => setDjName(e.target.value)}
                sx={{ mt: 2 }}
              />
              <Button
                fullWidth
                variant="contained"
                color="error"
                startIcon={<RadioIcon />}
                onClick={handleCreateStation}
                sx={{ mt: 2, fontWeight: 700 }}
              >
                Go On Air
              </Button>
            </Box>
          )}
        </TabPanel>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
