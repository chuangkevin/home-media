import { Chip } from '@mui/material';
import CastConnectedIcon from '@mui/icons-material/CastConnected';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store';

export default function CastIndicator() {
  const { isController, isReceiver, castTargets, sourceDeviceName } = useSelector(
    (state: RootState) => state.casting
  );

  if (isController && castTargets.length > 0) {
    return (
      <Chip
        icon={<CastConnectedIcon />}
        label={`投射中 (${castTargets.length})`}
        color="primary"
        size="small"
        sx={{ ml: 1 }}
      />
    );
  }

  if (isReceiver) {
    return (
      <Chip
        icon={<CastConnectedIcon />}
        label={`接收自 ${sourceDeviceName || '未知裝置'}`}
        color="secondary"
        size="small"
        sx={{ ml: 1 }}
      />
    );
  }

  return null;
}
