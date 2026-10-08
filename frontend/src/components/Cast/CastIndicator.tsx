import { Chip } from '@mui/material'
import CastConnectedIcon from '@mui/icons-material/CastConnected'
import { useSelector } from 'react-redux'
import type { RootState } from '../../store'

export default function CastIndicator() {
  const { isController, isReceiver, castTargets, sourceDeviceName } = useSelector(
    (state: RootState) => state.casting
  )

  if (isController && castTargets.length > 0) {
    return (
      <Chip
        icon={<CastConnectedIcon />}
        label={`投射中 · ${castTargets.length} 部裝置`}
        color="primary"
        size="small"
        sx={{
          ml: 1,
          maxWidth: '100%',
          minWidth: 0,
          height: 28,
          fontSize: 12,
          '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
        }}
      />
    )
  }

  if (isReceiver) {
    return (
      <Chip
        icon={<CastConnectedIcon />}
        label={`接收自 ${sourceDeviceName || '未知裝置'}`}
        title={`接收自 ${sourceDeviceName || '未知裝置'}`}
        color="secondary"
        size="small"
        sx={{
          ml: 1,
          maxWidth: '100%',
          minWidth: 0,
          height: 28,
          fontSize: 12,
          '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
        }}
      />
    )
  }

  return null
}
