import { useDispatch, useSelector } from 'react-redux'
import { ToggleButtonGroup, ToggleButton, Box, Tooltip } from '@mui/material'
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo'
import EqualizerIcon from '@mui/icons-material/Equalizer'
import { RootState } from '../../store'
import { setDisplayMode, DisplayMode } from '../../store/playerSlice'

export default function DisplayModeToggle() {
  const dispatch = useDispatch()
  const displayMode = useSelector((state: RootState) => state.player.displayMode)
  const isListener = useSelector((state: RootState) => state.radio.isListener)

  const handleChange = (_event: React.MouseEvent<HTMLElement>, newMode: DisplayMode | null) => {
    if (newMode && !isListener) {
      dispatch(setDisplayMode(newMode))
    }
  }

  const toggle = (
    <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0, mb: 2 }}>
      <ToggleButtonGroup
        aria-label="播放畫面"
        value={displayMode}
        exclusive
        onChange={handleChange}
        size="small"
        color="primary"
        disabled={isListener}
        sx={{
          width: { xs: '100%', sm: 'auto' },
          '& .MuiToggleButton-root': {
            flex: 1,
            minHeight: 44,
            gap: 1,
            whiteSpace: 'nowrap',
            px: 2,
          },
        }}
      >
        <ToggleButton value="video">
          <OndemandVideoIcon fontSize="small" />
          影片
        </ToggleButton>
        <ToggleButton value="visualizer">
          <EqualizerIcon fontSize="small" />
          視覺化
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  )

  if (isListener) {
    return <Tooltip title="由 DJ 控制">{toggle}</Tooltip>
  }

  return toggle
}
