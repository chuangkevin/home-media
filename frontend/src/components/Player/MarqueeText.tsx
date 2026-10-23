import { useEffect, useRef, useState } from 'react'
import { Box, type SxProps, type Theme } from '@mui/material'

interface MarqueeTextProps {
  children: string
  sx?: SxProps<Theme>
}

// A one-line label that scrolls (跑馬燈) only when the text is wider than its
// box, so long song titles stay readable in the bottom player.
export default function MarqueeText({ children, sx = {} }: MarqueeTextProps) {
  const outerRef = useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children])

  return (
    <Box
      ref={outerRef}
      sx={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        minWidth: 0,
        position: 'relative',
        '&:hover [data-marquee-track]': { animationPlayState: 'paused' },
        ...sx,
      }}
    >
      <Box
        data-marquee-track
        sx={{
          display: 'inline-block',
          whiteSpace: 'nowrap',
          willChange: 'transform',
          animation: overflowing ? 'marquee-scroll 14s linear infinite' : 'none',
          '@keyframes marquee-scroll': {
            '0%, 15%': { transform: 'translateX(0)' },
            '85%, 100%': { transform: 'translateX(-50%)' },
          },
        }}
      >
        <span>{children}</span>
        {overflowing && <span aria-hidden="true">{'\u2003\u2003' + children}</span>}
      </Box>
    </Box>
  )
}
