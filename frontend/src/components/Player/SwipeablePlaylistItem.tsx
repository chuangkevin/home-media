/**
 * SwipeablePlaylistItem
 * Gmail-style swipe gestures on playlist items:
 * - Swipe right (→): green background, toggle favorite on release
 * - Swipe left (←): red background, show remove/block options
 */
import { useRef, useState, useCallback } from 'react';
import { Box, Typography, Slide } from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import BlockIcon from '@mui/icons-material/Block';

interface SwipeablePlaylistItemProps {
  children: React.ReactNode;
  onSwipeRight: () => void; // toggle favorite
  onRemove: () => void;
  onBlock: () => void;
  isFavorited: boolean;
  disabled?: boolean; // disable for current playing track
}

const SWIPE_THRESHOLD = 80;

export default function SwipeablePlaylistItem({
  children,
  onSwipeRight,
  onRemove,
  onBlock,
  isFavorited,
  disabled = false,
}: SwipeablePlaylistItemProps) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const directionLockRef = useRef<'none' | 'horizontal' | 'vertical'>('none');

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    directionLockRef.current = 'none';
    setIsSwiping(false);
  }, [disabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
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
  }, [disabled]);

  const handleTouchEnd = useCallback(() => {
    if (disabled || !isSwiping) {
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
  }, [disabled, isSwiping, offsetX, onSwipeRight]);

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
        }}
      >
        {children}
      </Box>

      {/* Action menu after left swipe */}
      {showActions && (
        <Slide direction="left" in={showActions} mountOnEnter unmountOnExit>
          <Box sx={{
            position: 'absolute', right: 0, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center', gap: 0, zIndex: 2,
            backgroundColor: 'background.paper',
          }}>
            <Box
              onClick={() => { onRemove(); setShowActions(false); }}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                px: 2, py: 1, cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <DeleteOutlineIcon sx={{ color: 'warning.main', fontSize: 20 }} />
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>移除</Typography>
            </Box>
            <Box
              onClick={() => { onBlock(); setShowActions(false); }}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                px: 2, py: 1, cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <BlockIcon sx={{ color: 'error.main', fontSize: 20 }} />
              <Typography variant="caption" sx={{ fontSize: '0.65rem' }}>封鎖</Typography>
            </Box>
            <Box
              onClick={() => setShowActions(false)}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                px: 1.5, py: 1, cursor: 'pointer',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>取消</Typography>
            </Box>
          </Box>
        </Slide>
      )}
    </Box>
  );
}
