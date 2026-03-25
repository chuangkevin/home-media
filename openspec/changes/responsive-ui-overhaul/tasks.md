## 1. Z-index & Bottom Spacing

- [ ] 1.1 Fix z-index: AudioPlayer 1100, BottomNav 1200 in App.tsx
- [ ] 1.2 Replace hardcoded pb='250px' with dynamic calc() based on viewport
- [ ] 1.3 Verify stacking order works on all devices

## 2. Compact Player

- [ ] 2.1 Add useMediaQuery for short viewport detection (max-height: 768px)
- [ ] 2.2 Implement compact player mode: hide thumbnail, single-line title, smaller icons
- [ ] 2.3 Keep play button >= 48px in compact mode
- [ ] 2.4 Verify on mobile and 1920x720 tablet

## 3. Fullscreen Lyrics Responsive

- [ ] 3.1 Replace 30vh padding with max(60px, 10vh) for short / max(120px, 20vh) for tall
- [ ] 3.2 Make LyricsView height responsive: min(500px, 60vh) instead of fixed 500px

## 4. Desktop Grid Optimization

- [ ] 4.1 SearchResults: add lg={3} breakpoint for 4 columns on desktop
- [ ] 4.2 ChannelSection cards: responsive minWidth (240px mobile, 280px+ desktop)
- [ ] 4.3 AdminSettings: increase maxWidth to 1600px on xl screens

## 5. Final Verification

- [ ] 5.1 TypeScript compilation check
- [ ] 5.2 Visual test on mobile (375px), tablet (1920x720), desktop (1920x1080)
- [ ] 5.3 Commit, push
