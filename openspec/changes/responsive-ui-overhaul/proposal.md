## Why

The UI has critical layout issues across all device types: on mobile, the player bar + navigation consume 236px (33%+ of viewport), leaving minimal content space. On the user's tablet (1920x720), only 484px remains for content. On desktop (1920px+), search results are capped at 3 columns wasting horizontal space. Z-index conflicts cause the navigation bar to overlap the player controls. Since the app is primarily for singing along with lyrics, these layout issues directly impact the core experience.

## What Changes

- Fix z-index stacking: BottomNav 1100, AudioPlayer 1150, Drawer 1300
- Compress player bar height on mobile/tablet (180px → 120px compact mode)
- Adapt fullscreen lyrics 30vh padding to viewport-aware values
- Make LyricsView height responsive (remove fixed 500px)
- Add lg/xl Grid breakpoints for search results (4-5 columns on desktop)
- Optimize recommendation cards responsive sizing
- Reduce bottom padding from 250px to dynamic calculation

## Capabilities

### New Capabilities
- `responsive-layout`: Fix z-index stacking, dynamic bottom spacing, viewport-aware padding
- `adaptive-player`: Compact player mode for short viewports, responsive height
- `desktop-optimization`: lg/xl Grid breakpoints, wider content utilization

### Modified Capabilities

## Impact

- **Frontend**: App.tsx, AudioPlayer.tsx, PlayerControls.tsx, FullscreenLyrics.tsx, LyricsView.tsx, SearchResults.tsx, ChannelSection.tsx, AdminSettings.tsx
- **No backend changes**
- **No API changes**
- **Risk**: Layout changes affect all devices; must test on mobile, tablet 1920x720, and desktop
