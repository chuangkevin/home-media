import { Box, Typography, Avatar, Chip, Card, CardMedia, CardContent, IconButton } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteIcon from '@mui/icons-material/Delete';
import { ChannelRecommendation } from '../../store/recommendationSlice';
import type { Track } from '../../types/track.types';

interface ChannelSectionProps {
  channel: ChannelRecommendation;
  onPlay: (track: Track) => void;
  onHideChannel?: (channelName: string) => void;
  cacheStatus?: Map<string, boolean>; // videoId -> isCached
}

export default function ChannelSection({ channel, onPlay, onHideChannel, cacheStatus }: ChannelSectionProps) {
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const isSimilarRecommendation = channel.type === 'similar';

  return (
    <Box sx={{ mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        {isSimilarRecommendation ? (
          <Box
            sx={{
              mr: 2,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: '50%',
            }}
          >
            <AutoAwesomeIcon sx={{ color: 'white', fontSize: 24 }} />
          </Box>
        ) : (
          channel.channelThumbnail && (
            <Avatar src={channel.channelThumbnail} sx={{ mr: 2, width: 40, height: 40 }} />
          )
        )}
        <Typography
          variant="h6"
          sx={{
            fontWeight: 600,
            background: isSimilarRecommendation
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              : 'inherit',
            WebkitBackgroundClip: isSimilarRecommendation ? 'text' : 'inherit',
            WebkitTextFillColor: isSimilarRecommendation ? 'transparent' : 'inherit',
            flex: 1,
          }}
        >
          {channel.channelName}
        </Typography>
        {!isSimilarRecommendation && (
          <Chip
            label={`${channel.watchCount} 次觀看`}
            size="small"
            sx={{ ml: 2 }}
            color="primary"
            variant="outlined"
          />
        )}
        {isSimilarRecommendation && (
          <Chip
            label="智慧推薦"
            size="small"
            sx={{
              ml: 2,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              fontWeight: 600,
            }}
          />
        )}
        {onHideChannel && (
          <IconButton
            onClick={() => onHideChannel(channel.channelName)}
            size="small"
            sx={{
              ml: 1,
              color: 'error.main',
              '&:hover': {
                backgroundColor: 'error.light',
                color: 'white',
              },
            }}
            title="隱藏此頻道"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box
        sx={{
          display: 'flex',
          overflowX: 'auto',
          gap: 2,
          pb: 2,
          '&::-webkit-scrollbar': {
            height: 8,
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'rgba(0,0,0,0.1)',
            borderRadius: 4,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,0.3)',
            borderRadius: 4,
            '&:hover': {
              backgroundColor: 'rgba(0,0,0,0.5)',
            },
          },
        }}
      >
        {channel.videos.map((video) => (
          <Card
            key={video.videoId}
            sx={{
              minWidth: 280,
              maxWidth: 280,
              flexShrink: 0,
              cursor: 'pointer',
              position: 'relative',
              transition: 'transform 0.2s, box-shadow 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 4,
                '& .play-overlay': {
                  opacity: 1,
                },
              },
            }}
            onClick={() => onPlay(video)}
          >
            <Box sx={{ position: 'relative' }}>
              <CardMedia
                component="img"
                height="160"
                image={video.thumbnail}
                alt={video.title}
              />
              <Box
                className="play-overlay"
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  opacity: 0,
                  transition: 'opacity 0.2s',
                }}
              >
                <IconButton
                  sx={{
                    backgroundColor: 'primary.main',
                    color: 'white',
                    width: 56,
                    height: 56,
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                  }}
                >
                  <PlayArrowIcon sx={{ fontSize: 32 }} />
                </IconButton>
              </Box>
              <Chip
                label={formatDuration(video.duration)}
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  color: 'white',
                  fontWeight: 600,
                }}
              />
              {/* 快取狀態指示 */}
              <Chip
                icon={cacheStatus?.get(video.videoId) ? <StorageIcon sx={{ fontSize: 14 }} /> : <CloudIcon sx={{ fontSize: 14 }} />}
                label={cacheStatus?.get(video.videoId) ? '快取' : '網路'}
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  backgroundColor: cacheStatus?.get(video.videoId) ? 'rgba(76, 175, 80, 0.9)' : 'rgba(33, 150, 243, 0.9)',
                  color: 'white',
                  fontWeight: 500,
                  height: 22,
                  '& .MuiChip-icon': { color: 'white', marginLeft: '4px' },
                  '& .MuiChip-label': { paddingLeft: '4px', paddingRight: '8px' },
                }}
              />
            </Box>
            <CardContent sx={{ p: 1.5 }}>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: 1.4,
                  minHeight: '2.8em',
                }}
              >
                {video.title}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
