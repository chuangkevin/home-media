import { useState } from 'react';
import { IconButton, Badge, Tooltip } from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import RadioPanel from './RadioPanel';

export default function RadioButton() {
  const [open, setOpen] = useState(false);
  const { isHost, isListener, listenerCount } = useSelector(
    (state: RootState) => state.radio
  );

  const getTooltip = () => {
    if (isHost) return `電台播放中 (${listenerCount} 位聽眾)`;
    if (isListener) return '正在收聽電台';
    return '電台';
  };

  const getColor = () => {
    if (isHost) return 'success';
    if (isListener) return 'primary';
    return 'default';
  };

  return (
    <>
      <Tooltip title={getTooltip()}>
        <IconButton
          onClick={() => setOpen(true)}
          color={getColor()}
          sx={{
            animation: isHost || isListener ? 'pulse 2s infinite' : 'none',
            '@keyframes pulse': {
              '0%': { opacity: 1 },
              '50%': { opacity: 0.6 },
              '100%': { opacity: 1 },
            },
          }}
        >
          <Badge
            badgeContent={isHost ? listenerCount : 0}
            color="error"
            max={99}
          >
            <RadioIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <RadioPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
