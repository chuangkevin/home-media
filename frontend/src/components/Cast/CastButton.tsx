import { useState } from 'react';
import { useSelector } from 'react-redux';
import { IconButton, Badge, Tooltip } from '@mui/material';
import CastIcon from '@mui/icons-material/Cast';
import CastConnectedIcon from '@mui/icons-material/CastConnected';
import type { RootState } from '../../store';
import CastDialog from './CastDialog';

export default function CastButton() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { isController, castTargets, isConnected } = useSelector(
    (state: RootState) => state.casting
  );

  const isCasting = isController && castTargets.length > 0;

  return (
    <>
      <Tooltip title={isCasting ? `投射中 (${castTargets.length} 裝置)` : '投射'}>
        <span>
          <IconButton
            onClick={() => setDialogOpen(true)}
            disabled={!isConnected}
            color={isCasting ? 'primary' : 'default'}
            size="small"
          >
            <Badge
              badgeContent={isCasting ? castTargets.length : 0}
              color="primary"
              sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}
            >
              {isCasting ? <CastConnectedIcon /> : <CastIcon />}
            </Badge>
          </IconButton>
        </span>
      </Tooltip>

      <CastDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
