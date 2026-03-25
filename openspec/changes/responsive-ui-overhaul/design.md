## Context

Home-media runs on mobile phones, a 1920x720 tablet, and desktop browsers. The current layout uses fixed heights (player ~180px, nav 56px) and hardcoded padding (250px bottom), creating severe space issues on short viewports. Z-index values are inconsistent, causing overlapping UI elements.

## Goals / Non-Goals

**Goals:**
- Fix z-index stacking order across all components
- Maximize content area on short viewports (720px)
- Utilize full width on desktop (1920px+)
- Maintain touch-friendly targets on mobile

**Non-Goals:**
- Complete UI redesign or theme changes
- Adding new UI components or pages
- Changing the navigation structure (keep 3-tab bottom nav)

## Decisions

### D1: Z-index hierarchy
```
Content:          z-index auto (0)
AudioPlayer:      z-index 1100
BottomNavigation: z-index 1200
Lyrics Drawer:    z-index 1300
Dialogs:          z-index 1400 (MUI default)
```

### D2: Dynamic bottom spacing
Replace hardcoded `pb: '250px'` with CSS `calc()`:
- Mobile: `calc(120px + 56px + 16px)` = 192px (compact player + nav + gap)
- Tablet/Desktop: `calc(140px + 56px + 16px)` = 212px

### D3: Compact player for short viewports
When `window.innerHeight <= 768px`:
- Hide album art thumbnail
- Single-line title (text-overflow: ellipsis)
- Smaller controls (40px → 32px icons except play)
- Estimated height: 120px (down from ~180px)

### D4: Responsive fullscreen lyrics padding
Replace `height: '30vh'` padding with:
- `max(60px, 10vh)` for short viewports
- `max(120px, 20vh)` for tall viewports

### D5: Desktop grid optimization
Search results: `xs={12} sm={6} md={4} lg={3} xl={2.4}`
- 1920px: 5 columns
- 1280px: 4 columns
- 960px: 3 columns

### D6: LyricsView responsive height
Replace fixed `500px` with `calc(100vh - 300px)` clamped to `min(500px, 60vh)`.

## Risks / Trade-offs

- **[Risk] Compact player too small on some phones** → Mitigation: Only activate below 768px height; keep play button large
- **[Risk] Grid column changes affect card aspect ratio** → Mitigation: Use minWidth on cards, let them flex
