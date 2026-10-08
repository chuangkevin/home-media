import { Box, Typography, IconButton, Tooltip } from '@mui/material'
import HeadphonesIcon from '@mui/icons-material/Headphones'
import CloseIcon from '@mui/icons-material/Close'
import { useSelector } from 'react-redux'
import type { RootState } from '../../store'
import { useRadio } from '../../hooks/useRadio'

export default function RadioIndicator() {
  const { isListener, currentStationName, hostName } = useSelector(
    (state: RootState) => state.radio
  )
  const { leaveRadio } = useRadio()

  if (!isListener) return null

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        maxWidth: '100%',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        pl: 1.5,
        pr: 0.5,
        py: 0.5,
        borderRadius: 2,
      }}
    >
      <HeadphonesIcon fontSize="small" sx={{ flexShrink: 0 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          noWrap
          title={currentStationName || undefined}
          sx={{ fontWeight: 600 }}
        >
          收聽中：{currentStationName}
        </Typography>
        <Typography variant="caption" component="p" noWrap sx={{ fontSize: 12 }}>
          DJ · {hostName}
        </Typography>
      </Box>
      <Tooltip title="離開電台">
        <IconButton
          aria-label="離開電台"
          onClick={leaveRadio}
          sx={{ color: 'inherit', width: 44, height: 44, flexShrink: 0 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
