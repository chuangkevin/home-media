import { useDispatch, useSelector } from 'react-redux';
import { ToggleButtonGroup, ToggleButton, Box, Tooltip } from '@mui/material';
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import { RootState } from '../../store';
import { setDisplayMode, DisplayMode } from '../../store/playerSlice';

export default function DisplayModeToggle() {
  const dispatch = useDispatch();
  const displayMode = useSelector((state: RootState) => state.player.displayMode);
  const isListener = useSelector((state: RootState) => state.radio.isListener);

  const handleChange = (_event: React.MouseEvent<HTMLElement>, newMode: DisplayMode | null) => {
    if (newMode && !isListener) {
      dispatch(setDisplayMode(newMode));
    }
  };

  const toggle = (
    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
      <ToggleButtonGroup
        value={displayMode}
        exclusive
        onChange={handleChange}
        size="small"
        color="primary"
        disabled={isListener}
      >
        <ToggleButton value="video">
          <OndemandVideoIcon sx={{ mr: 0.5 }} fontSize="small" />
          影片
        </ToggleButton>
        <ToggleButton value="visualizer">
          <EqualizerIcon sx={{ mr: 0.5 }} fontSize="small" />
          視覺化
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );

  if (isListener) {
    return <Tooltip title="由 DJ 控制">{toggle}</Tooltip>;
  }

  return toggle;
}
