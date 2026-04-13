## 1. Desktop layout and player ergonomics

- [x] 1.1 Widen the desktop playlist side panel and ensure the embedded left player keeps favorite controls.
- [x] 1.2 Remove desktop-only horizontal-scroll dependence for homepage sections; keep touch-oriented mobile/tablet behavior unchanged.
- [x] 1.3 Adjust desktop personalized/channel section item counts: recently played + favorites up to 20, other sections 10.

## 2. Video / lyrics behavior

- [x] 2.1 Ensure seek operations in video mode always drive the audio time source and keep iframe/cached video aligned.
- [x] 2.2 When LRCLIB preference/source is unsynced or unavailable, fall back to NetEase before surfacing no-lyrics state.
- [x] 2.3 Remove duplicated lyric overlays in video mode.
- [x] 2.4 Set immersive mode default effect to `focus` and persist user overrides in localStorage.

## 3. Casting behavior

- [x] 3.1 Change cast start to fire-and-forget: receivers get initial track/position and then play independently.
- [x] 3.2 Remove ongoing sender-driven control syncing for cast sessions.

## 4. Verification and handoff

- [x] 4.1 Run frontend/backend concrete verification commands.
- [x] 4.2 Update memory + docs + version.
- [ ] 4.3 Commit and push app/docs changes.
