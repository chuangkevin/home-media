import { useState, useEffect } from 'react'
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
  Typography,
  Box,
  TextField,
  Tabs,
  Tab,
  IconButton,
  Chip,
  Avatar,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
} from '@mui/material'
import { useSelector } from 'react-redux'
import type { RootState } from '../../store'
import CloseIcon from '@mui/icons-material/Close'
import RadioIcon from '@mui/icons-material/Radio'
import HeadphonesIcon from '@mui/icons-material/Headphones'
import RefreshIcon from '@mui/icons-material/Refresh'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import PeopleIcon from '@mui/icons-material/People'
import { useRadio } from '../../hooks/useRadio'

const FUNNY_DJ_NAMES = [
  'DJ 已讀不回',
  'MC 薪水小偷',
  'DJ 拖延症末期',
  'DJ 沒睡飽',
  'MC WiFi 密碼是什麼',
  'DJ 鍵盤俠本人',
  'MC 明天再說',
  'DJ 上班打卡王',
  'MC 外送到了嗎',
  'DJ 我只聽團',
]

const FUNNY_STATION_NAMES = [
  '深夜不睡覺電台',
  '上班摸魚電台',
  '社畜療癒電台',
  '半夜肚子餓電台',
  '假裝在認真電台',
  '老闆不在電台',
  '薪水小偷放送局',
  '人生好難電台',
  '耳機裡的避難所',
  '今天也要加班電台',
]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

interface RadioPanelProps {
  open: boolean
  onClose: () => void
}

interface TabPanelProps {
  children?: React.ReactNode
  index: number
  value: number
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={`radio-panel-${index}`}
      aria-labelledby={`radio-tab-${index}`}
      hidden={value !== index}
      style={{ minHeight: 200 }}
    >
      {value === index && children}
    </div>
  )
}

const CROSSFADE_LOCALSTORAGE_KEY = 'radio-crossfade-enabled'

export default function RadioPanel({ open, onClose }: RadioPanelProps) {
  const isConnected = useSelector((state: RootState) => state.casting.isConnected)
  const [tabIndex, setTabIndex] = useState(0)
  const [stationName, setStationName] = useState('')
  const [djName, setDjName] = useState('')
  const [refreshAttempt, setRefreshAttempt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(() => {
    try {
      return localStorage.getItem(CROSSFADE_LOCALSTORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const {
    stations,
    isHost,
    myStationId,
    myStationName,
    listenerCount,
    isListener,
    currentStationName,
    hostName,
    hostDisconnected,
    hostGracePeriod,
    createStation,
    closeStation,
    joinRadio,
    joiningStationId,
    joinError,
    cancelJoin,
    clearJoinError,
    leaveRadio,
    refreshStations,
  } = useRadio()

  useEffect(() => {
    if (open) clearJoinError()
    else cancelJoin()
  }, [open, clearJoinError, cancelJoin])

  const handleClose = () => {
    cancelJoin()
    onClose()
  }

  // 開啟對話框時產生隨機預設名稱
  useEffect(() => {
    if (open) {
      if (!isHost && !isListener) {
        setStationName(pickRandom(FUNNY_STATION_NAMES))
        setDjName(pickRandom(FUNNY_DJ_NAMES))
      }
    }
  }, [open, isHost, isListener])

  // 服務沒有探索完成事件；等待窗口結束後保留手動重試，避免無限載入。
  useEffect(() => {
    if (!open || !isConnected) {
      setRefreshing(false)
      return
    }
    refreshStations()
    setRefreshing(true)
    const timeout = window.setTimeout(() => setRefreshing(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [open, isConnected, refreshStations, refreshAttempt])

  // 如果已經是 DJ 或聽眾，自動切換到對應的 tab
  useEffect(() => {
    if (isHost) {
      setTabIndex(1)
    } else if (isListener) {
      setTabIndex(0)
    }
  }, [isHost, isListener])

  const handleCreateStation = () => {
    if (!isConnected) return
    createStation(stationName || undefined, djName || undefined)
    setStationName('')
    setDjName('')
  }

  const handleCloseStation = () => {
    closeStation()
  }

  const handleJoinStation = async (stationId: string) => {
    if (!isConnected || isHost || joiningStationId) return
    if (await joinRadio(stationId)) onClose()
  }

  const handleLeaveStation = () => {
    leaveRadio()
  }

  const handleCrossfadeToggle = (checked: boolean) => {
    setCrossfadeEnabled(checked)
    try {
      localStorage.setItem(CROSSFADE_LOCALSTORAGE_KEY, String(checked))
    } catch {
      /* noop */
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="radio-dialog-title"
    >
      <DialogTitle
        id="radio-dialog-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1 }}
      >
        <RadioIcon color="primary" />
        <Box
          component="span"
          sx={{ flex: 1, minWidth: 0, fontSize: { xs: 20, sm: 24 }, fontWeight: 700 }}
        >
          一起聽電台
        </Box>
        <IconButton
          onClick={handleClose}
          aria-label="關閉電台視窗"
          sx={{ width: 44, height: 44, flexShrink: 0 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Tabs
        value={tabIndex}
        onChange={(_, newValue) => setTabIndex(newValue)}
        aria-label="電台功能"
        variant="fullWidth"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          px: { xs: 2, sm: 3 },
          '& .MuiTab-root': { minHeight: 48, minWidth: 0, fontSize: 14, whiteSpace: 'nowrap' },
        }}
      >
        <Tab label="探索電台" id="radio-tab-0" aria-controls="radio-panel-0" />
        <Tab label="我的電台" id="radio-tab-1" aria-controls="radio-panel-1" />
      </Tabs>

      <DialogContent
        sx={{
          minHeight: 300,
          px: { xs: 2, sm: 3 },
          py: 3,
          '& .MuiButton-root': { minHeight: 44, whiteSpace: 'nowrap' },
          '& .MuiTypography-caption': { fontSize: 12 },
          '& .MuiTypography-body2': { lineHeight: 1.7 },
        }}
      >
        {!isConnected && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            電台服務尚未連線。請確認網路，連線恢復後可重新整理電台。
          </Alert>
        )}
        {joinError && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button
                onClick={() => {
                  clearJoinError()
                  setRefreshAttempt((attempt) => attempt + 1)
                }}
                disabled={!isConnected || refreshing}
              >
                重新整理
              </Button>
            }
          >
            {joinError}
          </Alert>
        )}
        {joiningStationId && (
          <Alert
            severity="info"
            icon={<CircularProgress size={20} color="inherit" />}
            role="status"
            sx={{ mb: 2 }}
            action={<Button onClick={cancelJoin}>取消加入</Button>}
          >
            正在等待電台確認加入，可取消或關閉視窗。
          </Alert>
        )}
        {/* 發現電台 */}
        <TabPanel value={tabIndex} index={0}>
          {isHost && (
            <Alert severity="info" sx={{ mb: 2 }}>
              目前正在廣播。請先到「我的電台」停止廣播，再收聽其他電台。
            </Alert>
          )}
          {isListener ? (
            // 正在收聽中
            <Box sx={{ textAlign: 'center', py: 1 }}>
              <HeadphonesIcon sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
              <Typography variant="body2" color="text.secondary" gutterBottom>
                收聽中
              </Typography>
              <Typography
                variant="h5"
                gutterBottom
                sx={{ fontSize: { xs: 20, sm: 24 }, fontWeight: 700, overflowWrap: 'anywhere' }}
              >
                {currentStationName}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                gutterBottom
                sx={{ overflowWrap: 'anywhere' }}
              >
                DJ · {hostName}
              </Typography>
              {hostDisconnected && (
                <Alert severity="warning" sx={{ mt: 2, textAlign: 'left' }}>
                  DJ 暫時離線，正在等待重新連線
                  {hostGracePeriod > 0 ? `（剩餘 ${hostGracePeriod} 秒）` : ''}
                  。你也可以離開此電台。
                </Alert>
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={crossfadeEnabled}
                    onChange={(_, checked) => handleCrossfadeToggle(checked)}
                    color="primary"
                  />
                }
                label="歌曲淡入淡出"
                sx={{ mt: 2, mx: 0, minHeight: 44 }}
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                歌曲切換時 5 秒平滑音量過渡
              </Typography>
              <Button variant="outlined" color="error" onClick={handleLeaveStation} sx={{ mt: 1 }}>
                離開電台
              </Button>
            </Box>
          ) : stations.length === 0 ? (
            // 沒有電台
            <Box
              role="status"
              aria-live="polite"
              sx={{ textAlign: 'center', py: 3, px: 2, bgcolor: 'action.hover', borderRadius: 2 }}
            >
              {isConnected && refreshing ? (
                <CircularProgress size={32} sx={{ mb: 2 }} aria-label="正在探索電台" />
              ) : (
                <RadioIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 2 }} />
              )}
              <Typography sx={{ fontWeight: 600 }}>
                {!isConnected
                  ? '等待連線後探索電台'
                  : refreshing
                    ? '正在探索電台'
                    : '尚未找到開播的電台'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {isConnected
                  ? '建立自己的電台，邀請朋友一起聽。'
                  : '你可以先為自己的電台取個名字。'}
              </Typography>
              <Box
                sx={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 1, mt: 2 }}
              >
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => setRefreshAttempt((attempt) => attempt + 1)}
                  disabled={!isConnected || refreshing}
                >
                  重新整理
                </Button>
                <Button variant="contained" onClick={() => setTabIndex(1)}>
                  建立電台
                </Button>
              </Box>
            </Box>
          ) : (
            // 電台列表
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {stations.length} 個電台
                </Typography>
                <Button
                  startIcon={<RefreshIcon />}
                  onClick={() => setRefreshAttempt((attempt) => attempt + 1)}
                  disabled={!isConnected || refreshing}
                >
                  重新整理
                </Button>
              </Box>
              <List disablePadding aria-label="可收聽的電台">
                {stations.map((station) => (
                  <ListItem
                    key={station.id}
                    disablePadding
                    sx={{
                      mb: 1,
                      bgcolor: 'action.hover',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}
                  >
                    <ListItemButton
                      onClick={() => void handleJoinStation(station.id)}
                      disabled={!isConnected || isHost || Boolean(joiningStationId) || station.id === myStationId}
                      aria-label={`收聽 ${station.stationName}，DJ ${station.hostName}`}
                      sx={{ px: 1.5, py: 2, alignItems: 'flex-start', gap: 1.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 44 }}>
                        {station.currentTrack ? (
                          <Avatar
                            src={station.currentTrack.thumbnail}
                            variant="rounded"
                            alt=""
                            sx={{ width: 44, height: 44 }}
                          />
                        ) : (
                          <RadioIcon sx={{ fontSize: 40 }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <Box
                              component="span"
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 15,
                                fontWeight: 600,
                                lineHeight: 1.5,
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {station.stationName}
                            </Box>
                            {station.isPlaying ? (
                              <PlayArrowIcon
                                fontSize="small"
                                color="success"
                                titleAccess="播放中"
                                sx={{ flexShrink: 0 }}
                              />
                            ) : (
                              <PauseIcon
                                fontSize="small"
                                color="action"
                                titleAccess="暫停中"
                                sx={{ flexShrink: 0 }}
                              />
                            )}
                          </Box>
                        }
                        primaryTypographyProps={{ component: 'div' }}
                        secondary={
                          <Box>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mt: 0.5, overflowWrap: 'anywhere' }}
                            >
                              DJ · {station.hostName}
                            </Typography>
                            {station.currentTrack && (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                noWrap
                                title={station.currentTrack.title}
                              >
                                {station.currentTrack.title}
                              </Typography>
                            )}
                            <Chip
                              icon={<PeopleIcon />}
                              label={`${station.listenerCount} 位聽眾`}
                              size="small"
                              variant="outlined"
                              sx={{ mt: 1, height: 28, fontSize: 12 }}
                            />
                          </Box>
                        }
                        secondaryTypographyProps={{ component: 'div' }}
                        sx={{ minWidth: 0, my: 0 }}
                      />
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
            <Box sx={{ textAlign: 'center', py: 1 }}>
              <RadioIcon
                sx={{ display: 'block', mx: 'auto', fontSize: 40, color: 'primary.main', mb: 2 }}
              />
              <Chip
                label="廣播中"
                color="primary"
                variant="outlined"
                sx={{ mb: 2, fontWeight: 700, fontSize: 12 }}
              />
              <Typography
                variant="h5"
                gutterBottom
                sx={{ fontSize: { xs: 20, sm: 24 }, fontWeight: 700, overflowWrap: 'anywhere' }}
              >
                {myStationName}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 1,
                  mb: 2,
                }}
              >
                <PeopleIcon color="action" />
                <Typography color="text.secondary">{listenerCount} 位聽眾</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                你的播放內容會同步給所有聽眾
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={crossfadeEnabled}
                    onChange={(_, checked) => handleCrossfadeToggle(checked)}
                    color="primary"
                  />
                }
                label="歌曲淡入淡出"
                sx={{ mb: 2, mx: 0, minHeight: 44 }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mb: 2, mt: -1 }}
              >
                歌曲切換時 5 秒平滑音量過渡
              </Typography>
              <Button variant="outlined" color="error" onClick={handleCloseStation}>
                停止廣播
              </Button>
            </Box>
          ) : isListener ? (
            // 正在收聽別人的電台
            <Box
              sx={{ textAlign: 'center', py: 3, px: 2, bgcolor: 'action.hover', borderRadius: 2 }}
            >
              <HeadphonesIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 2 }} />
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                你正在收聽「{currentStationName}」
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                請先離開電台才能開台
              </Typography>
              <Button variant="outlined" onClick={handleLeaveStation} sx={{ mt: 2 }}>
                離開電台
              </Button>
            </Box>
          ) : (
            // 可以開台
            <Box sx={{ py: 1 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                開始廣播，和其他人分享你正在聽的音樂
              </Typography>
              <TextField
                fullWidth
                label="電台名稱"
                placeholder="幫你的電台取個名字吧"
                value={stationName}
                onChange={(e) => setStationName(e.target.value)}
                sx={{ mt: 2 }}
              />
              <TextField
                fullWidth
                label="DJ 名稱"
                placeholder="你的 DJ 藝名"
                value={djName}
                onChange={(e) => setDjName(e.target.value)}
                sx={{ mt: 2 }}
              />
              <Button
                fullWidth
                variant="contained"
                startIcon={<RadioIcon />}
                onClick={handleCreateStation}
                disabled={!isConnected || Boolean(joiningStationId)}
                sx={{ mt: 3, fontWeight: 700 }}
              >
                開始廣播
              </Button>
            </Box>
          )}
        </TabPanel>
      </DialogContent>

      <DialogActions
        sx={{ px: { xs: 2, sm: 3 }, py: 2, borderTop: '1px solid', borderColor: 'divider' }}
      >
        <Button onClick={handleClose} sx={{ minHeight: 44 }}>
          關閉
        </Button>
      </DialogActions>
    </Dialog>
  )
}
