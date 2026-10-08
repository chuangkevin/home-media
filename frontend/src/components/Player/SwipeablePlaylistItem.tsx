/**
 * SwipeablePlaylistItem
 * Gmail-style swipe gestures on playlist items (mobile):
 * - Swipe right (→): green background, toggle favorite on release
 * - Swipe left (←): red background, show remove/block options
 * Desktop: show action icons directly (no swipe needed)
 */
import { useRef, useState, useCallback } from 'react';
import { Box, Typography, IconButton, Menu, MenuItem, ListItemIcon } from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BlockIcon from '@mui/icons-material/Block';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';

interface SwipeablePlaylistItemProps {
  children: React.ReactNode;
  trackTitle: string;
  onSwipeRight: () => void; // toggle favorite
  onRemove: () => void;
  onBlock: () => void;
  isFavorited: boolean;
  isDesktop?: boolean;
}

const SWIPE_THRESHOLD = 80;

export default function SwipeablePlaylistItem({
  children,
  trackTitle,
  onSwipeRight,
  onRemove,
  onBlock,
  isFavorited,
  isDesktop = false,
}: SwipeablePlaylistItemProps) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const directionLockRef = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isDesktop) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    directionLockRef.current = 'none';
    setIsSwiping(false);
  }, [isDesktop]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isDesktop) return;
    const dx = e.touches[0].clientX - startXRef.current;
    const dy = e.touches[0].clientY - startYRef.current;

    // Lock direction on first significant movement
    if (directionLockRef.current === 'none') {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        directionLockRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
    }

    // Only handle horizontal swipe
    if (directionLockRef.current !== 'horizontal') return;

    e.stopPropagation(); // prevent drag-and-drop from firing
    setIsSwiping(true);
    // Clamp: right max +120px, left max -120px
    setOffsetX(Math.max(-120, Math.min(120, dx)));
  }, [isDesktop]);

  const handleTouchEnd = useCallback(() => {
    if (isDesktop || !isSwiping) {
      setOffsetX(0);
      setIsSwiping(false);
      return;
    }

    if (offsetX > SWIPE_THRESHOLD) {
      // Swipe right → toggle favorite
      onSwipeRight();
    } else if (offsetX < -SWIPE_THRESHOLD) {
      // Swipe left → show action menu
      setShowActions(true);
    }

    setOffsetX(0);
    setIsSwiping(false);
    directionLockRef.current = 'none';
  }, [isDesktop, isSwiping, offsetX, onSwipeRight]);

  // Keep swipe gestures, with the same visible, keyboard-accessible menu on every device.
  return (
    <Box sx={{ position: 'relative', overflow: 'hidden' }}>
      {/* Background indicators */}
      {isSwiping && offsetX > 20 && (
        <Box sx={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: Math.abs(offsetX),
          backgroundColor: isFavorited ? 'grey.700' : 'success.main',
          display: 'flex', alignItems: 'center', pl: 2,
          transition: 'none',
        }}>
          <FavoriteIcon sx={{ color: '#fff', fontSize: 24 }} />
          <Typography variant="caption" sx={{ color: '#fff', ml: 0.5, fontWeight: 600 }}>
            {isFavorited ? '取消收藏' : '收藏'}
          </Typography>
        </Box>
      )}
      {isSwiping && offsetX < -20 && (
        <Box sx={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: Math.abs(offsetX),
          backgroundColor: 'error.main',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', pr: 2,
          transition: 'none',
        }}>
          <Typography variant="caption" sx={{ color: '#fff', mr: 0.5, fontWeight: 600 }}>
            更多
          </Typography>
          <BlockIcon sx={{ color: '#fff', fontSize: 24 }} />
        </Box>
      )}

      {/* Content with swipe offset */}
      <Box
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        sx={{
          transform: isSwiping ? `translateX(${offsetX}px)` : 'translateX(0)',
          transition: isSwiping ? 'none' : 'transform 0.2s ease',
          position: 'relative',
          zIndex: 1,
          backgroundColor: 'background.paper',
          touchAction: 'pan-y', // 允許垂直滾動，攔截水平滑動
          display: 'flex',
          alignItems: 'center',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
        <IconButton
          ref={moreButtonRef}
          aria-label={`更多操作：${trackTitle}`}
          aria-haspopup="menu"
          aria-expanded={showActions}
          onClick={(event) => { event.stopPropagation(); setShowActions(true); }}
          sx={{ width: 44, height: 44, flexShrink: 0, mr: 0.5 }}
        >
          <MoreHorizIcon />
        </IconButton>
      </Box>

      <Menu anchorEl={moreButtonRef.current} open={showActions} onClose={() => setShowActions(false)}
        MenuListProps={{ 'aria-label': '歌曲操作' }} sx={{ '& .MuiMenuItem-root': { minHeight: 44 } }}>
        <MenuItem onClick={() => { onSwipeRight(); setShowActions(false); }}>
          <ListItemIcon>{isFavorited ? <FavoriteIcon color="error" /> : <FavoriteBorderIcon />}</ListItemIcon>
          {isFavorited ? '取消收藏' : '收藏歌曲'}
        </MenuItem>
        <MenuItem onClick={() => { setShowActions(false); onRemove(); }}>
          <ListItemIcon><DeleteOutlineIcon /></ListItemIcon>從待播移除
        </MenuItem>
        <MenuItem onClick={() => { setShowActions(false); onBlock(); }}>
          <ListItemIcon><BlockIcon /></ListItemIcon>不再推薦這首歌
        </MenuItem>
      </Menu>
    </Box>
  );
}
