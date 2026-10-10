import { useId } from 'react'
import { Box, Button, Slider, Stack, Typography } from '@mui/material'
import {
  DEFAULT_LYRICS_TYPOGRAPHY,
  MAX_LYRICS_FONT_SCALE,
  MIN_LYRICS_FONT_SCALE,
  normalizeLyricsTypography,
} from '../../utils/lyricsTypography'
import type { LyricsTypographySettings as TypographyPreferences } from '../../utils/lyricsTypography'

export interface LyricsTypographySettingsProps {
  settings: TypographyPreferences
  /** Receives the complete next preference, never a partial patch. */
  onChange: (settings: TypographyPreferences) => void
}

const presets = [
  { label: '標準', scale: 1 },
  { label: '大字', scale: 1.5 },
  { label: '特大', scale: 2 },
  { label: '最大', scale: 2.5 },
]

/** Presentation only: no player, Redux, media elements, or playback effects. */
export default function LyricsTypographySettings({
  settings,
  onChange,
}: LyricsTypographySettingsProps) {
  const id = useId()
  const normalized = normalizeLyricsTypography(settings)
  return (
    <Box
      component="section"
      aria-labelledby={`${id}-title`}
      data-testid="lyrics-typography-settings"
      sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 2, minWidth: 0 }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Typography id={`${id}-title`} variant="subtitle1" fontWeight={700}>
          歌詞字體大小
        </Typography>
        <Button
          type="button"
          onClick={() => onChange({ ...DEFAULT_LYRICS_TYPOGRAPHY })}
          sx={{ minHeight: 44, minWidth: 44, flexShrink: 0 }}
        >
          還原預設
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        原文與中文翻譯可分別調整；設定會保留在此裝置，換歌不會重設。
      </Typography>
      <Stack gap={2}>
        {(
          [
            ['originalScale', '原文歌詞'],
            ['translationScale', '中文翻譯'],
          ] as const
        ).map(([key, label]) => {
          const percent = Math.round(normalized[key] * 100)
          const labelId = `${id}-${key}`
          return (
            <Box key={key}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography id={labelId} fontWeight={600}>
                  {label}
                </Typography>
                <Typography component="output" aria-live="off">
                  {percent}%
                </Typography>
              </Stack>
              <Box sx={{ px: 1.5 }}>
                <Slider
                  aria-labelledby={labelId}
                  getAriaValueText={(value) => `${value}%`}
                  value={percent}
                  min={MIN_LYRICS_FONT_SCALE * 100}
                  max={MAX_LYRICS_FONT_SCALE * 100}
                  step={5}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(value) => `${value}%`}
                  onChange={(_, value) => {
                    if (typeof value === 'number') onChange({ ...normalized, [key]: value / 100 })
                  }}
                  sx={{
                    py: '22px',
                    '& .MuiSlider-thumb': {
                      width: 24,
                      height: 24,
                      '&::after': { width: 44, height: 44 },
                    },
                  }}
                />
              </Box>
              <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
                {presets.map(({ label: presetLabel, scale }) => (
                  <Button
                    key={scale}
                    type="button"
                    size="small"
                    variant={normalized[key] === scale ? 'contained' : 'outlined'}
                    aria-label={`${label}：${presetLabel} ${scale * 100}%`}
                    aria-pressed={normalized[key] === scale}
                    onClick={() => onChange({ ...normalized, [key]: scale })}
                    sx={{ minHeight: 44, minWidth: 64 }}
                  >
                    {presetLabel} {scale * 100}%
                  </Button>
                ))}
              </Stack>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
