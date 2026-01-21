import { Box, Typography, Paper } from '@mui/material';
import type { Track } from '../../types/track.types';

interface LyricsViewProps {
  track: Track;
}

export default function LyricsView({ track }: LyricsViewProps) {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 800,
        mx: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {/* 封面圖 */}
      <Box
        component="img"
        src={track.thumbnail}
        alt={track.title}
        sx={{
          width: '100%',
          maxWidth: 400,
          aspectRatio: '16/9',
          borderRadius: 2,
          boxShadow: 6,
          objectFit: 'cover',
        }}
      />

      {/* 曲目資訊 */}
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          {track.title}
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          {track.channel}
        </Typography>
      </Box>

      {/* 歌詞區域（目前為佔位符） */}
      <Paper
        elevation={0}
        sx={{
          p: 4,
          width: '100%',
          backgroundColor: 'background.default',
          textAlign: 'center',
        }}
      >
        <Typography variant="body1" color="text.secondary">
          歌詞功能即將推出
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          將支援同步歌詞滾動顯示
        </Typography>
      </Paper>
    </Box>
  );
}
