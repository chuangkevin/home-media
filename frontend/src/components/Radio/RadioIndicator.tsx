import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import CloseIcon from '@mui/icons-material/Close';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { useRadio } from '../../hooks/useRadio';

export default function RadioIndicator() {
  const { isListener, currentStationName, hostName } = useSelector(
    (state: RootState) => state.radio
  );
  const { leaveRadio } = useRadio();

  if (!isListener) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        px: 2,
        py: 0.5,
        borderRadius: 1,
        animation: 'pulse 2s infinite',
        '@keyframes pulse': {
          '0%': { opacity: 1 },
          '50%': { opacity: 0.8 },
          '100%': { opacity: 1 },
        },
      }}
    >
      <HeadphonesIcon fontSize="small" />
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        收聽中: {currentStationName}
      </Typography>
      <Typography variant="caption" sx={{ opacity: 0.8 }}>
        ({hostName})
      </Typography>
      <Tooltip title="離開電台">
        <IconButton
          size="small"
          onClick={leaveRadio}
          sx={{ color: 'inherit', ml: 0.5 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
