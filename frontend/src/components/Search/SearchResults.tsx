import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Typography,
  IconButton,
  Grid,
  Chip,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import type { Track } from '../../types/track.types';
import { formatDuration, formatNumber } from '../../utils/formatTime';

interface SearchResultsProps {
  results: Track[];
  onPlay: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  currentTrackId?: string;
}

export default function SearchResults({
  results,
  onPlay,
  onAddToQueue,
  currentTrackId,
}: SearchResultsProps) {
  if (results.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          沒有找到結果
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          試試其他關鍵字
        </Typography>
      </Box>
    );
  }

  return (
    <Grid container spacing={2}>
      {results.map((track) => (
        <Grid item xs={12} sm={6} md={4} key={track.id}>
          <Card
            sx={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6,
              },
              border: currentTrackId === track.videoId ? '2px solid' : 'none',
              borderColor: 'primary.main',
            }}
          >
            <Box sx={{ position: 'relative' }}>
              <CardMedia
                component="img"
                height="180"
                image={track.thumbnail}
                alt={track.title}
                sx={{ objectFit: 'cover' }}
              />
              <Chip
                label={formatDuration(track.duration)}
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                }}
              />
            </Box>

            <CardContent sx={{ flexGrow: 1, pb: 1 }}>
              <Typography
                variant="subtitle1"
                component="div"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  mb: 1,
                }}
              >
                {track.title}
              </Typography>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {track.channel}
              </Typography>

              {track.views && (
                <Typography variant="caption" color="text.secondary">
                  {formatNumber(track.views)} 次觀看
                </Typography>
              )}
            </CardContent>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', p: 1, pt: 0 }}>
              <IconButton
                color="primary"
                onClick={() => onPlay(track)}
                sx={{ flexGrow: 1 }}
              >
                <PlayArrowIcon />
              </IconButton>
              {onAddToQueue && (
                <IconButton
                  color="default"
                  onClick={() => onAddToQueue(track)}
                  sx={{ ml: 1 }}
                >
                  <AddIcon />
                </IconButton>
              )}
            </Box>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
