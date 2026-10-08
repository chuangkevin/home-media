import { useState } from 'react'
import { IconButton, Badge, Tooltip } from '@mui/material'
import RadioIcon from '@mui/icons-material/Radio'
import { useSelector } from 'react-redux'
import type { RootState } from '../../store'
import RadioPanel from './RadioPanel'

export default function RadioButton() {
  const [open, setOpen] = useState(false)
  const { isHost, isListener, listenerCount } = useSelector((state: RootState) => state.radio)

  const getTooltip = () => {
    if (isHost) return `廣播中（${listenerCount} 位聽眾）`
    if (isListener) return '收聽中'
    return '電台'
  }

  const getColor = () => {
    if (isHost) return 'success'
    if (isListener) return 'primary'
    return 'default'
  }

  return (
    <>
      <Tooltip title={getTooltip()}>
        <IconButton
          onClick={() => setOpen(true)}
          aria-label={getTooltip()}
          aria-haspopup="dialog"
          aria-expanded={open}
          color={getColor()}
          sx={{
            width: 44,
            height: 44,
            flexShrink: 0,
            bgcolor: isHost || isListener ? 'action.selected' : 'transparent',
          }}
        >
          <Badge badgeContent={isHost ? listenerCount : 0} color="error" max={99}>
            <RadioIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <RadioPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}
