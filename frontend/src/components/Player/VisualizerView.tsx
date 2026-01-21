import { Box, Typography, Paper } from '@mui/material';
import type { Track } from '../../types/track.types';

interface VisualizerViewProps {
  track: Track;
}

export default function VisualizerView({ track }: VisualizerViewProps) {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 800,
        mx: 'auto',
        textAlign: 'center',
      }}
    >
      {/* 封面圖作為背景 */}
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16/9',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: 6,
        }}
      >
        <Box
          component="img"
          src={track.thumbnail}
          alt={track.title}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(10px) brightness(0.5)',
          }}
        />

        <Paper
          elevation={0}
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            p: 4,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Typography variant="h6" color="white">
            視覺化效果即將推出
          </Typography>
          <Typography variant="body2" color="rgba(255, 255, 255, 0.7)" sx={{ mt: 1 }}>
            將支援即時頻譜分析與動態效果
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
