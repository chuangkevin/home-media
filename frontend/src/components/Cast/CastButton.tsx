import { useState } from 'react'
import { useSelector } from 'react-redux'
import { IconButton, Badge, Tooltip } from '@mui/material'
import CastIcon from '@mui/icons-material/Cast'
import CastConnectedIcon from '@mui/icons-material/CastConnected'
import type { RootState } from '../../store'
import CastDialog from './CastDialog'

export default function CastButton() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { isController, castTargets, isConnected } = useSelector(
    (state: RootState) => state.casting
  )

  const isCasting = isController && castTargets.length > 0

  return (
    <>
      <Tooltip
        title={
          isCasting
            ? `投射中（${castTargets.length} 部裝置）`
            : isConnected
              ? '投射到裝置'
              : '投射服務尚未連線'
        }
      >
        <IconButton
          onClick={() => setDialogOpen(true)}
          aria-label={isCasting ? `投射中，${castTargets.length} 部裝置` : '投射到裝置'}
          aria-haspopup="dialog"
          aria-expanded={dialogOpen}
          color={isCasting ? 'primary' : 'default'}
          sx={{ width: 44, height: 44, flexShrink: 0 }}
        >
          <Badge
            badgeContent={isCasting ? castTargets.length : 0}
            color="primary"
            sx={{ '& .MuiBadge-badge': { fontSize: 12, height: 20, minWidth: 20 } }}
          >
            {isCasting ? <CastConnectedIcon /> : <CastIcon />}
          </Badge>
        </IconButton>
      </Tooltip>

      <CastDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  )
}
