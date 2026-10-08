import { useState } from 'react'
import { useSelector } from 'react-redux'
import { Box, IconButton, Slider, Typography } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import VolumeDownIcon from '@mui/icons-material/VolumeDown'
import VolumeOffIcon from '@mui/icons-material/VolumeOff'
import { RootState } from '../../store'
import { formatDuration } from '../../utils/formatTime'
import { CastButton } from '../Cast'
import { useCastingControls } from '../../hooks/useCastingControls'

interface PlayerControlsProps {
  embedded?: boolean
  isCompact?: boolean
}

function readableTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

export default function PlayerControls({
  embedded = false,
  isCompact = false,
}: PlayerControlsProps) {
  const [isSeeking, setIsSeeking] = useState(false)
  const [seekValue, setSeekValue] = useState(0)
  const { isPlaying, currentTime, duration, volume, playlist, currentIndex } = useSelector(
    (state: RootState) => state.player
  )
  const { handlePlayPause, handleSeek, handleVolume, handleNext, handlePrevious } =
    useCastingControls()

  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const elapsed = Math.max(0, Math.min(safeDuration, isSeeking ? seekValue : currentTime))
  const VolumeIcon = volume === 0 ? VolumeOffIcon : volume < 0.5 ? VolumeDownIcon : VolumeUpIcon
  const muteLabel = volume > 0 ? '靜音' : '取消靜音'
  const compact = isCompact && !embedded

  const onSeekChange = (_event: Event, value: number | number[]) => {
    setIsSeeking(true)
    setSeekValue(value as number)
  }

  const onSeekCommit = (_event: React.SyntheticEvent | Event, value: number | number[]) => {
    handleSeek(value as number)
    setIsSeeking(false)
  }

  const transport = (
    <Box
      role="group"
      aria-label="播放控制"
      sx={{ display: 'flex', alignItems: 'center', gap: compact ? 0 : 1, flexShrink: 0 }}
    >
      <IconButton
        aria-label={currentTime > 3 ? '從頭播放' : '上一首'}
        title={currentTime > 3 ? '從頭播放' : '上一首'}
        onClick={handlePrevious}
        disabled={playlist.length === 0 || (currentIndex <= 0 && currentTime <= 3)}
      >
        <SkipPreviousIcon />
      </IconButton>
      <IconButton
        aria-label={isPlaying ? '暫停' : '播放'}
        title={isPlaying ? '暫停' : '播放'}
        onClick={() => handlePlayPause(!isPlaying)}
        sx={{
          width: compact ? 44 : 56,
          height: compact ? 44 : 56,
          color: 'primary.contrastText',
          bgcolor: 'primary.main',
          borderRadius: '50%',
          '&:hover': { bgcolor: 'primary.dark' },
        }}
      >
        {isPlaying ? (
          <PauseIcon sx={{ fontSize: compact ? 26 : 32 }} />
        ) : (
          <PlayArrowIcon sx={{ fontSize: compact ? 26 : 32 }} />
        )}
      </IconButton>
      <IconButton
        aria-label="下一首"
        title="下一首"
        onClick={handleNext}
        disabled={playlist.length === 0}
      >
        <SkipNextIcon />
      </IconButton>
    </Box>
  )

  const soundControls = (
    <Box
      role="group"
      aria-label="音量與投射"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 0 : 1,
        minWidth: 0,
        width: compact ? 'auto' : '100%',
        flexShrink: compact ? 0 : 1,
      }}
    >
      <IconButton
        aria-label={muteLabel}
        aria-pressed={volume === 0}
        title={muteLabel}
        onClick={() => handleVolume(volume > 0 ? 0 : 0.7)}
      >
        <VolumeIcon />
      </IconButton>
      {!compact && (
        <Slider
          aria-label="音量"
          getAriaValueText={(value) => `${Math.round(value * 100)}%`}
          value={volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(_event, value) => handleVolume(value as number)}
          sx={{ flex: 1, minWidth: 0 }}
        />
      )}
      <CastButton />
    </Box>
  )

  return (
    <Box sx={{ width: '100%', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 0.5 }}>
        <Typography
          component="span"
          variant="caption"
          aria-hidden="true"
          sx={{
            minWidth: 36,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'right',
          }}
        >
          {formatDuration(Math.floor(elapsed))}
        </Typography>
        <Slider
          aria-label="播放進度"
          getAriaValueText={(value) => `${readableTime(value)}，共 ${readableTime(safeDuration)}`}
          value={elapsed}
          min={0}
          max={safeDuration || 1}
          disabled={safeDuration === 0}
          onChange={onSeekChange}
          onChangeCommitted={onSeekCommit}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Typography
          component="span"
          variant="caption"
          aria-hidden="true"
          sx={{ minWidth: 36, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatDuration(Math.floor(safeDuration))}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: compact ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: compact ? 'space-between' : 'center',
          gap: compact ? 1 : 0.5,
          minWidth: 0,
          minHeight: 44,
        }}
      >
        {transport}
        {soundControls}
      </Box>
    </Box>
  )
}
