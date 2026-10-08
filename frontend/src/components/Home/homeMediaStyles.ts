// Shared visual vocabulary for homepage shelves and compact collections.
// Keep playback interactions in the existing CardActionArea handlers.
export const homeMediaCardSx = {
  minWidth: 0,
  height: '100%',
  borderRadius: 2,
  boxShadow: 'none',
  border: '1px solid',
  borderColor: 'divider',
  '&:hover, &:focus-within': { borderColor: 'primary.main' },
} as const

export const homeMediaTitleSx = {
  fontWeight: 600,
  fontSize: 14,
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  minHeight: '3em',
} as const

export const homeMediaPlaySx = {
  width: 44,
  height: 44,
  display: 'grid',
  placeItems: 'center',
  flexShrink: 0,
  borderRadius: '50%',
  bgcolor: 'background.paper',
  color: 'primary.main',
  border: '1px solid',
  borderColor: 'divider',
  '& .MuiSvgIcon-root': { fontSize: 24 },
} as const

export const homeMediaShelfSx = {
  display: { xs: 'flex', md: 'grid' },
  gridTemplateColumns: { md: 'repeat(auto-fill, minmax(180px, 1fr))' },
  overflowX: { xs: 'auto', md: 'visible' },
  minWidth: 0,
  maxWidth: '100%',
  gap: 2,
  pb: 1,
  scrollSnapType: { xs: 'x proximity', md: 'none' },
  scrollbarWidth: 'thin',
} as const
