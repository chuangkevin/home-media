import { useDispatch, useSelector } from 'react-redux';
import { ToggleButtonGroup, ToggleButton, Box } from '@mui/material';
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import { RootState } from '../../store';
import { setDisplayMode, DisplayMode } from '../../store/playerSlice';

export default function DisplayModeToggle() {
  const dispatch = useDispatch();
  const displayMode = useSelector((state: RootState) => state.player.displayMode);

  const handleChange = (_event: React.MouseEvent<HTMLElement>, newMode: DisplayMode | null) => {
    if (newMode) {
      dispatch(setDisplayMode(newMode));
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
      <ToggleButtonGroup
        value={displayMode}
        exclusive
        onChange={handleChange}
        size="small"
        color="primary"
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
}
