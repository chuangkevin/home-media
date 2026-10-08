import { useEffect, useState } from 'react'
import { useSelector, useStore } from 'react-redux'
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
  Alert,
  IconButton,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import CastIcon from '@mui/icons-material/Cast'
import RefreshIcon from '@mui/icons-material/Refresh'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import ComputerIcon from '@mui/icons-material/Computer'
import TvIcon from '@mui/icons-material/Tv'
import type { RootState } from '../../store'
import { socketService } from '../../services/socket.service'
import { startDraftCast, stopActiveCast, toggleDraftCastTarget } from './castDialogActions'

interface CastDialogProps {
  open: boolean
  onClose: () => void
}

export default function CastDialog({ open, onClose }: CastDialogProps) {
  const store = useStore<RootState>()
  const { devices, castTargets, isController, isConnected } = useSelector(
    (state: RootState) => state.casting
  )
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0)
  const [discovering, setDiscovering] = useState(false)
  const [draftTargets, setDraftTargets] = useState<string[]>([])
  const { currentTrack } = useSelector((state: RootState) => state.player)
  const selectedTargets = isController ? castTargets : draftTargets

  useEffect(() => {
    setDraftTargets([])
  }, [open])

  // 開啟對話框時發現裝置
  useEffect(() => {
    if (!open || !isConnected) {
      setDiscovering(false)
      return
    }
    socketService.discoverDevices()
    setDiscovering(true)
    const timeout = window.setTimeout(() => setDiscovering(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [open, isConnected, discoveryAttempt])

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'mobile':
        return <PhoneAndroidIcon />
      case 'tv':
        return <TvIcon />
      default:
        return <ComputerIcon />
    }
  }

  const handleToggleDevice = (deviceId: string) => {
    setDraftTargets((targets) =>
      toggleDraftCastTarget(targets, deviceId, store.getState().casting.isController)
    )
  }

  const handleClose = () => {
    setDraftTargets([])
    onClose()
  }

  const handleStartCast = () => {
    if (startDraftCast(store, socketService, draftTargets)) handleClose()
  }

  const handleStopCast = () => {
    if (stopActiveCast(store, socketService)) handleClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="cast-dialog-title"
    >
      <DialogTitle
        id="cast-dialog-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pr: 1 }}
      >
        <CastIcon color="primary" />
        <Box
          component="span"
          sx={{ flex: 1, minWidth: 0, fontSize: { xs: 20, sm: 24 }, fontWeight: 700 }}
        >
          {isController ? '管理投射裝置' : '投射到裝置'}
        </Box>
        <IconButton
          onClick={handleClose}
          aria-label="關閉投射視窗"
          sx={{ width: 44, height: 44, flexShrink: 0 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.7 }}>
          在其他裝置開啟 Home Media，即可一起播放。可選擇多部裝置。
        </Typography>
        {isController && (
          <Alert severity="info" sx={{ mb: 2 }}>
            目前正在投射。如需更換裝置，請先停止投射，再重新選擇。
          </Alert>
        )}
        {!isConnected ? (
          <Alert
            severity="warning"
            sx={{ alignItems: 'center', '& .MuiAlert-message': { minWidth: 0 } }}
          >
            投射服務尚未連線。請確認網路，連線恢復後會自動重新搜尋。
          </Alert>
        ) : devices.length === 0 ? (
          <Box
            role="status"
            aria-live="polite"
            sx={{ textAlign: 'center', py: 3, px: 2, bgcolor: 'action.hover', borderRadius: 2 }}
          >
            {discovering ? (
              <CircularProgress size={28} sx={{ mb: 2 }} aria-label="搜尋投射裝置" />
            ) : (
              <CastIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 2 }} />
            )}
            <Typography sx={{ fontWeight: 600, mb: 1 }}>
              {discovering ? '正在搜尋裝置' : '尚未找到可用裝置'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              請確認接收裝置已連上同一個 Home Media，並保持頁面開啟。
            </Typography>
            {!discovering && (
              <Button
                startIcon={<RefreshIcon />}
                onClick={() => setDiscoveryAttempt((attempt) => attempt + 1)}
                sx={{ mt: 2, minHeight: 44 }}
              >
                重新搜尋
              </Button>
            )}
          </Box>
        ) : (
          <List disablePadding aria-label="可投射的裝置">
            {devices.map((device) => (
              <ListItem key={device.id} disablePadding sx={{ mb: 1 }}>
                <ListItemButton
                  onClick={() => handleToggleDevice(device.id)}
                  disabled={isController}
                  role="checkbox"
                  aria-checked={selectedTargets.includes(device.id)}
                  aria-label={device.name}
                  selected={selectedTargets.includes(device.id)}
                  sx={{
                    minHeight: 72,
                    px: 1.5,
                    gap: 1.5,
                    border: '1px solid',
                    borderColor: selectedTargets.includes(device.id) ? 'primary.main' : 'divider',
                    borderRadius: 2,
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    <Checkbox
                      checked={selectedTargets.includes(device.id)}
                      disabled={isController}
                      tabIndex={-1}
                      inputProps={{ 'aria-hidden': true }}
                      disableRipple
                      sx={{ p: 0, pointerEvents: 'none' }}
                    />
                  </ListItemIcon>
                  <ListItemIcon sx={{ minWidth: 24, color: 'text.secondary' }}>
                    {getDeviceIcon(device.type)}
                  </ListItemIcon>
                  <ListItemText
                    primary={device.name}
                    primaryTypographyProps={{
                      sx: {
                        fontWeight: 600,
                        fontSize: 15,
                        overflowWrap: 'anywhere',
                        lineHeight: 1.5,
                      },
                    }}
                    secondaryTypographyProps={{ sx: { fontSize: 12, mt: 0.5 } }}
                    sx={{ minWidth: 0, my: 0 }}
                    secondary={
                      device.type === 'mobile' ? '手機' : device.type === 'tv' ? '電視' : '電腦'
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
        {isConnected && !currentTrack && !isController && (
          <Alert severity="info" sx={{ mt: 2 }}>
            先播放一首歌曲，再選擇裝置開始投射。
          </Alert>
        )}
      </DialogContent>

      <DialogActions
        sx={{
          px: { xs: 2, sm: 3 },
          py: 2,
          gap: 1,
          flexWrap: 'wrap',
          borderTop: '1px solid',
          borderColor: 'divider',
          '& .MuiButton-root': { minHeight: 44, whiteSpace: 'nowrap', ml: 0 },
        }}
      >
        <Button onClick={handleClose}>{isController ? '關閉' : '取消'}</Button>
        {isController ? (
          <Button onClick={handleStopCast} color="error">
            停止投射
          </Button>
        ) : (
          <Button
            onClick={handleStartCast}
            variant="contained"
            disabled={!isConnected || draftTargets.length === 0 || !currentTrack}
          >
            開始投射{draftTargets.length > 0 ? `（${draftTargets.length}）` : ''}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
