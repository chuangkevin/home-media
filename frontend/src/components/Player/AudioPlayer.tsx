import { useEffect, useRef, useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia, CircularProgress, Button, IconButton, Snackbar } from '@mui/material';
import LyricsIcon from '@mui/icons-material/Lyrics';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext, playPrevious, confirmPendingTrack, cancelPendingTrack, setPendingTrack } from '../../store/playerSlice';
import { setCurrentLyrics, setIsLoading as setLyricsLoading, setError as setLyricsError } from '../../store/lyricsSlice';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { useAutoQueue } from '../../hooks/useAutoQueue';
import { useCrossfade } from '../../hooks/useCrossfade';
import { socketService } from '../../services/socket.service';
import type { Track } from '../../types/track.types';
import AddToPlaylistMenu from '../Playlist/AddToPlaylistMenu';

interface AudioPlayerProps {
  onOpenLyrics?: () => void;
  embedded?: boolean; // 是否為嵌入模式（用於全螢幕歌詞）
}

export default function AudioPlayer({ onOpenLyrics, embedded = false }: AudioPlayerProps) {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const secondaryAudioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, pendingTrack, isLoadingTrack, isPlaying, volume, displayMode, seekTarget, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const { isHost } = useSelector((state: RootState) => state.radio);
  // isCompactPlayer removed - mini player is always compact now
  const [isLoading, setIsLoading] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const pendingBlobUrlRef = useRef<string | null>(null);
  const wasCompletedRef = useRef(false);
  const completeSentRef = useRef(false);

  // 🎵 自動播放佇列 - 當接近播放清單尾端時自動加入推薦歌曲
  useAutoQueue(!embedded);
  const isPlayingRef = useRef(isPlaying);
  const displayModeRef = useRef(displayMode);
  const prevDisplayModeRef = useRef(displayMode);

  // 🔊 Crossfade engine
  // Use a ref to store getSecondaryBlobUrl/clearSecondaryBlobUrl to avoid circular dependency
  const crossfadeRef = useRef<ReturnType<typeof useCrossfade> | null>(null);

  const handleCrossfadeComplete = useCallback((newTrack: Track) => {
    // Swap audio element roles: secondary becomes primary
    const oldPrimaryBlobUrl = currentBlobUrlRef.current;
    const newBlobUrl = crossfadeRef.current?.getSecondaryBlobUrl() ?? null;

    // Update tracking refs
    currentVideoIdRef.current = newTrack.videoId;
    currentBlobUrlRef.current = newBlobUrl;
    crossfadeRef.current?.clearSecondaryBlobUrl();

    // Revoke old primary blob URL
    if (oldPrimaryBlobUrl) {
      URL.revokeObjectURL(oldPrimaryBlobUrl);
    }

    // Swap the audio element refs: secondary is now the active player
    // We need to copy the secondary's src to primary and reset secondary
    const primary = audioRef.current;
    const secondary = secondaryAudioRef.current;
    if (primary && secondary) {
      // Transfer secondary to primary: copy src and state
      primary.src = secondary.src;
      primary.currentTime = secondary.currentTime;
      primary.volume = volume;
      primary.play().catch(() => {});

      // Clear secondary
      secondary.pause();
      secondary.src = '';
      secondary.volume = 0;
    }

    // Update MediaSession metadata
    if ('mediaSession' in navigator) {
      const artwork = newTrack.thumbnail ? [
        { src: newTrack.thumbnail, sizes: '96x96', type: 'image/jpeg' },
        { src: newTrack.thumbnail, sizes: '192x192', type: 'image/jpeg' },
        { src: newTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' },
      ] : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: newTrack.title,
        artist: newTrack.channel,
        artwork,
      });
    }

    // Dispatch pending track to update Redux state
    dispatch(setPendingTrack({
      id: newTrack.videoId,
      videoId: newTrack.videoId,
      title: newTrack.title,
      channel: newTrack.channel,
      thumbnail: newTrack.thumbnail,
      duration: newTrack.duration,
    }));
    // Immediately confirm since audio is already playing
    dispatch(confirmPendingTrack());
    dispatch(setDuration(newTrack.duration || 0));

    // Reset completion tracking for the new track
    wasCompletedRef.current = false;
    completeSentRef.current = false;

    console.log(`🔊 [Crossfade] Transition complete: ${newTrack.title}`);
  }, [dispatch, volume]);

  const handleCrossfadeStarted = useCallback((nextTrack: Track, crossfadeDuration: number, elapsedMs: number) => {
    // Host: emit crossfade-start to listeners via socket
    if (isHost) {
      socketService.radioCrossfadeStart(
        {
          videoId: nextTrack.videoId,
          title: nextTrack.title,
          channel: nextTrack.channel,
          thumbnail: nextTrack.thumbnail,
          duration: nextTrack.duration,
        },
        crossfadeDuration,
        elapsedMs,
      );
    }
  }, [isHost]);

  const crossfade = useCrossfade({
    primaryAudioRef: audioRef,
    secondaryAudioRef,
    onCrossfadeComplete: handleCrossfadeComplete,
    onCrossfadeStarted: handleCrossfadeStarted,
  });
  crossfadeRef.current = crossfade;

  // 🔊 Warm up secondary audio element on first user interaction
  useEffect(() => {
    if (embedded) return;
    const warmUp = () => {
      crossfade.warmUpSecondary();
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
      document.removeEventListener('keydown', warmUp);
    };
    document.addEventListener('click', warmUp, { once: true });
    document.addEventListener('touchstart', warmUp, { once: true });
    document.addEventListener('keydown', warmUp, { once: true });
    return () => {
      document.removeEventListener('click', warmUp);
      document.removeEventListener('touchstart', warmUp);
      document.removeEventListener('keydown', warmUp);
    };
  }, [crossfade.warmUpSecondary]);

  // 🔊 Radio crossfade sync: Listener receives crossfade-start and executes local crossfade
  useEffect(() => {
    if (embedded) return;
    socketService.setCallbacks({
      onRadioCrossfadeStart: (data) => {
        console.log('🔊 [Crossfade] Listener received crossfade-start:', data.nextTrack?.title);
        if (crossfadeRef.current?.shouldCrossfade()) {
          crossfadeRef.current.executeCrossfadeAsListener(
            { ...data.nextTrack, id: data.nextTrack.videoId } as Track,
            data.crossfadeDuration,
            data.elapsedMs,
          );
        }
      },
    });
  }, []);

  // 快取狀態
  const [isCached, setIsCached] = useState(false);
  const [cacheToast, setCacheToast] = useState(false);

  // SponsorBlock 跳過片段
  const [skipToast, setSkipToast] = useState('');
  const skipSegmentsRef = useRef<Array<{ start: number; end: number; category: string }>>([]);
  const lastSkipRef = useRef(0); // 防止重複跳過同一段
  const skippedSegmentsRef = useRef<Set<number>>(new Set()); // 已跳過的 segment index

  // 播放清單選單狀態
  const [playlistMenuAnchor, setPlaylistMenuAnchor] = useState<null | HTMLElement>(null);

  // 保持 isPlayingRef 同步
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 保持 displayModeRef 同步
  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  // SponsorBlock: 載入跳過片段
  useEffect(() => {
    if (embedded) return;
    if (!currentTrack?.videoId) return;
    skipSegmentsRef.current = [];
    lastSkipRef.current = 0;
    skippedSegmentsRef.current = new Set();
    apiService.getSponsorBlockSegments(currentTrack.videoId).then(segments => {
      if (segments.length > 0) {
        skipSegmentsRef.current = segments;
        console.log(`🚫 [SponsorBlock] ${segments.length} skip segments for ${currentTrack.videoId}`);
      }
    });
  }, [currentTrack?.videoId]);

  // 當有 pendingTrack 時，預載音訊（不切換 UI）
  useEffect(() => {
    if (embedded) return;
    if (!pendingTrack || !audioRef.current) return;

    // 🔊 Cancel any active crossfade when a new track is requested (DJ skip during crossfade)
    if (crossfade.crossfadeActiveRef.current) {
      console.log('🔊 [Crossfade] Interrupting crossfade for new track:', pendingTrack.title);
      crossfade.cancelCrossfade();
    }
    crossfade.resetPreload();

    // Record skip signal if previous track was not completed and played less than 50%
    if (audioRef.current && currentVideoIdRef.current && !wasCompletedRef.current) {
      const audio = audioRef.current;
      const skipDur = currentTrack?.duration || audio.duration;
      if (skipDur > 0 && audio.currentTime < skipDur * 0.5) {
        apiService.recordSkip(currentVideoIdRef.current).catch(() => {});
      }
    }
    wasCompletedRef.current = false;
    completeSentRef.current = false;

    const videoId = pendingTrack.videoId;

    // 如果 pending 和 current 相同，直接確認
    if (currentTrack && currentVideoIdRef.current === videoId) {
      console.log(`⏭️ Same track, confirming: ${pendingTrack.title}`);
      dispatch(confirmPendingTrack());
      return;
    }

    console.log(`🔄 Pending track: ${pendingTrack.title} (${videoId}), preparing...`);
    setIsLoading(true);

    const loadPendingAudio = async () => {
      try {
        // 重置快取狀態
        setIsCached(false);

        // 🚀 優先檢查前端 IndexedDB 快取（最快！）
        const browserCached = await audioCacheService.get(videoId);
        
        if (browserCached) {
          // ✅ 前端有 cache，直接用 Blob URL 播放（秒開！）
          const blobUrl = URL.createObjectURL(browserCached);
          console.log(`⚡ 從瀏覽器快取播放（秒開）: ${pendingTrack.title}`);
          setIsCached(true);

          const audio = audioRef.current!;
          // 重要：更新 currentVideoIdRef，否則下一首歌會判斷錯誤
          currentVideoIdRef.current = videoId;
          if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
          currentBlobUrlRef.current = blobUrl;
          audio.src = blobUrl;
          audio.load();

          // 非阻塞載入 SponsorBlock segments（背景載入，不等待）
          apiService.getSponsorBlockSegments(videoId).then(segments => {
            if (segments.length > 0) {
              skipSegmentsRef.current = segments;
              skippedSegmentsRef.current = new Set();
              console.log(`🚫 [SponsorBlock] Pre-loaded ${segments.length} segments for cached track`);
              // 如果開頭有非音樂段落且音訊還在前 5 秒內，seek 到音樂開始處
              const introSeg = segments.find((s: any) => s.category === 'music_offtopic' && s.start < 5);
              if (introSeg && audioRef.current && audioRef.current.currentTime < introSeg.end) {
                audioRef.current.currentTime = introSeg.end;
                skippedSegmentsRef.current.add(segments.indexOf(introSeg));
                console.log(`🚫 [SponsorBlock] 快取秒開跳過: 0→${introSeg.end.toFixed(1)}s`);
              }
            }
          }).catch(() => {});

          // 等 audio ready 再播放（不等 SponsorBlock）
          const playWhenReady = () => {
            // 用 YouTube metadata duration（比 audio.duration 精確，沒有尾部靜音）
            dispatch(setDuration(pendingTrack.duration || audio.duration));

            if (isPlayingRef.current && displayModeRef.current !== 'video') {
              console.log(`▶️ 快取秒開播放: ${pendingTrack.title}`);
              audio.play().catch((error) => {
                if (error.name === 'NotAllowedError') {
                  setAutoplayBlocked(true);
                  dispatch(setIsPlaying(false)); // UI 顯示暫停，讓使用者點播放
                } else {
                  dispatch(setIsPlaying(false));
                }
              });
            }
          };
          if (audio.readyState >= 2) {
            playWhenReady();
          } else {
            audio.addEventListener('canplay', () => playWhenReady(), { once: true });
            // Fallback: 3 秒後強制嘗試
            setTimeout(() => { if (audio.paused && isPlayingRef.current) audio.play().catch(() => {}); }, 3000);
          }

          // 背景觸發後端預加載（不等待）
          apiService.preloadAudio(videoId).catch(() => {});

          // 確認切換
          dispatch(confirmPendingTrack());
          setIsLoading(false);
          
          // 🎵 快取路徑也需要載入歌詞！
          (async () => {
            dispatch(setLyricsLoading(true));
            try {
              // 1. 先檢查使用者是否有儲存特定的歌詞選擇（優先從後端 API 獲取，跨裝置同步）
              let lrclibId: number | null = null;
              let neteaseId: number | null = null;
              try {
                console.log(`🔍 查詢後端歌詞偏好: ${videoId}`);
                const backendPrefs = await apiService.getLyricsPreferences(videoId);
                console.log(`📦 後端回應:`, backendPrefs);
                if (backendPrefs?.lrclibId) {
                  lrclibId = backendPrefs.lrclibId;
                  console.log(`📝 從後端獲取 LRCLIB ID: ${lrclibId}`);
                }
                if (backendPrefs?.neteaseId) {
                  neteaseId = backendPrefs.neteaseId;
                  console.log(`📝 從後端獲取 NetEase ID: ${neteaseId}`);
                }
              } catch (error) {
                // 後端獲取失敗，fallback 到本地
                console.log(`⚠️ 後端獲取失敗，使用本地快取 preference`, error);
                const localPref = await lyricsCacheService.getPreference(videoId);
                console.log(`📦 本地快取 preference:`, localPref);
                if (localPref?.lrclibId) {
                  lrclibId = localPref.lrclibId;
                  console.log(`📝 從本地快取獲取 LRCLIB ID: ${lrclibId}`);
                }
                if (localPref?.neteaseId) {
                  neteaseId = localPref.neteaseId;
                  console.log(`📝 從本地快取獲取 NetEase ID: ${neteaseId}`);
                }
              }

              // 優先使用 LRCLIB ID
              if (lrclibId) {
                console.log(`📝 使用儲存的 LRCLIB ID: ${lrclibId}`);
                const lrcLibLyrics = await apiService.getLyricsByLRCLIBId(videoId, lrclibId);
                if (lrcLibLyrics) {
                  console.log(`📝 歌詞從 LRCLIB ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(lrcLibLyrics));
                  lyricsCacheService.set(videoId, lrcLibLyrics).catch(err => {
                    console.warn('Failed to cache lyrics:', err);
                  });
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              // 其次使用 NetEase ID
              if (neteaseId) {
                console.log(`📝 使用儲存的 NetEase ID: ${neteaseId}`);
                const neteaseLyrics = await apiService.getLyricsByNeteaseId(videoId, neteaseId);
                if (neteaseLyrics) {
                  console.log(`📝 歌詞從 NetEase ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(neteaseLyrics));
                  lyricsCacheService.set(videoId, neteaseLyrics).catch(err => {
                    console.warn('Failed to cache lyrics:', err);
                  });
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              // 2. 如果沒有使用者偏好，檢查本地快取
              const cachedLyrics = await lyricsCacheService.get(videoId);
              if (cachedLyrics) {
                console.log(`📝 歌詞從本地快取載入: ${pendingTrack.title} (來源: ${cachedLyrics.source})`);
                dispatch(setCurrentLyrics(cachedLyrics));
                dispatch(setLyricsLoading(false));
                return;
              }

              // 3. 從後端自動搜尋
              const lyrics = await apiService.getLyrics(videoId, pendingTrack.title, pendingTrack.channel);
              if (lyrics) {
                console.log(`📝 歌詞從後端載入: ${pendingTrack.title} (來源: ${lyrics.source})`);
                dispatch(setCurrentLyrics(lyrics));
                // 儲存到本地快取
                lyricsCacheService.set(videoId, lyrics).catch(err => {
                  console.warn('Failed to cache lyrics:', err);
                });
              } else {
                console.log(`⚠️ 找不到歌詞: ${pendingTrack.title}`);
                dispatch(setLyricsError('找不到歌詞'));
              }
            } catch (error) {
              console.error('獲取歌詞失敗:', error);
              dispatch(setLyricsError('獲取歌詞失敗'));
            } finally {
              dispatch(setLyricsLoading(false));
            }
          })();
          
          return; // 直接返回，不等後端
        }

        // 沒有前端 cache：直接從 server 串流（邊播邊快取）
        console.log(`🎵 串流播放: ${pendingTrack.title}`);
        const streamUrl = apiService.getStreamUrl(videoId);
        audioRef.current!.src = streamUrl;
        audioRef.current!.load();
        setIsCached(false);

        // 背景：立即開始下載到 IndexedDB → 完成後無痛切換 Blob URL
        const bgVideoId = videoId;
        const bgStreamUrl = apiService.getStreamUrl(videoId);
        (async () => {
          // 直接下載到前端 IndexedDB（不等 backend cache，邊播邊下）
          console.log(`⏬ 背景下載到 IndexedDB: ${pendingTrack.title}`);
          try {
            await audioCacheService.fetchAndCache(bgVideoId, bgStreamUrl, {
              title: pendingTrack.title, channel: pendingTrack.channel,
              thumbnail: pendingTrack.thumbnail, duration: pendingTrack.duration,
            });
            console.log(`✅ 背景下載完成: ${pendingTrack.title}`);
          } catch (err) {
            console.warn(`⚠️ 背景下載失敗，嘗試等 backend cache:`, err);
            // Fallback：等 backend cache 完成再下載
            for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 3000));
              if (currentVideoIdRef.current !== bgVideoId) return;
              const s = await apiService.getCacheStatus(bgVideoId).catch(() => ({ cached: false }));
              if (s.cached) {
                try {
                  await audioCacheService.fetchAndCache(bgVideoId, bgStreamUrl, {
                    title: pendingTrack.title, channel: pendingTrack.channel,
                    thumbnail: pendingTrack.thumbnail, duration: pendingTrack.duration,
                  });
                  break;
                } catch { continue; }
              }
            }
          }

          if (currentVideoIdRef.current !== bgVideoId) return;
          const blob = await audioCacheService.get(bgVideoId);
          if (!blob || currentVideoIdRef.current !== bgVideoId) return;

          const audio = audioRef.current;
          if (!audio) return;
          const curTime = audio.currentTime;
          const wasPlaying = !audio.paused;
          const blobUrl = URL.createObjectURL(blob);

          const preventEnded = (e: Event) => { e.stopImmediatePropagation(); };
          audio.addEventListener('ended', preventEnded, { capture: true });
          audio.addEventListener('error', preventEnded, { capture: true });

          audio.src = blobUrl;
          audio.load();
          await new Promise<void>(r => { audio.addEventListener('canplay', () => r(), { once: true }); setTimeout(r, 5000); });

          audio.removeEventListener('ended', preventEnded, { capture: true });
          audio.removeEventListener('error', preventEnded, { capture: true });

          if (currentVideoIdRef.current !== bgVideoId) { URL.revokeObjectURL(blobUrl); return; }
          if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
          currentBlobUrlRef.current = blobUrl;
          try { audio.currentTime = curTime; } catch {}
          if (wasPlaying) audio.play().catch(() => {});
          setIsCached(true);
          setCacheToast(true);
        })();

        // 音訊準備好了，現在確認切換
        console.log(`✅ Pending track ready: ${pendingTrack.title}`);

        // 保存舊的 blob URL，稍後釋放
        const oldBlobUrl = currentBlobUrlRef.current;
        const audio = audioRef.current!;

        // 停止舊音訊（避免舊音訊繼續播放）
        audio.pause();
        audio.currentTime = 0;

        // 在影片模式下，不設置音訊源（避免音訊和影片同時播放）
        if (displayModeRef.current === 'video') {
          console.log(`🎬 影片模式：不設置音訊源，等待 VideoPlayer 初始化`);
          currentVideoIdRef.current = videoId;
          currentBlobUrlRef.current = null;
        } else {
          currentVideoIdRef.current = videoId;
          // audio.src 已在上面的流程中設定
          if (audio.src && audio.src.startsWith('blob:')) {
            currentBlobUrlRef.current = audio.src;
          } else {
            currentBlobUrlRef.current = null;
          }
        }
        pendingBlobUrlRef.current = null;

        // 釋放舊的 blob URL（如果有的話）
        if (oldBlobUrl && oldBlobUrl.startsWith('blob:')) {
          setTimeout(() => {
            console.log(`🗑️ Revoking old blob URL`);
            URL.revokeObjectURL(oldBlobUrl);
          }, 1000);
        }

        // 等待音訊準備好再確認切換
        // 使用多重事件監聽和 timeout fallback 確保手機端可以正常播放
        let hasConfirmed = false;
        let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

        const confirmAndPlay = (eventSource: string) => {
          if (hasConfirmed) return;
          hasConfirmed = true;

          // 清除 fallback timeout
          if (fallbackTimeoutId) {
            clearTimeout(fallbackTimeoutId);
            fallbackTimeoutId = null;
          }

          const shouldPlay = isPlayingRef.current;
          console.log(`🎵 Audio ready (${eventSource}): ${pendingTrack.title}, isPlaying: ${shouldPlay}`);
          setIsLoading(false);

          // 確認切換（UI 現在更新）
          dispatch(confirmPendingTrack());

          // Trigger background style analysis for current track
          if (pendingTrack) {
            // Style analysis 移到背景低優先級，不在播放時消耗 Gemini quota
            // apiService.analyzeTrackStyle(videoId, pendingTrack.title, pendingTrack.channel).catch(() => {});
          }

          // 自動播放（影片模式下由 VideoPlayer 控制，不播放音訊）
          if (shouldPlay && displayModeRef.current !== 'video') {
            console.log(`▶️ Auto-playing audio: ${pendingTrack.title}`);
            audio.play().catch((error) => {
              console.error('Failed to auto-play:', error);
              if (error.name === 'NotAllowedError') {
                // 瀏覽器阻擋自動播放，顯示點擊播放按鈕
                setAutoplayBlocked(true);
              } else {
                dispatch(setIsPlaying(false));
              }
            });
          } else if (displayModeRef.current === 'video') {
            console.log(`🎬 影片模式下不播放音訊，由 VideoPlayer 控制`);
          }

          // 🎵 播放成功後才開始搜尋歌詞
          dispatch(setLyricsLoading(true));
          (async () => {
            try {
              // 1. 先檢查使用者是否有儲存特定的歌詞選擇
              let lrclibId: number | null = null;
              let neteaseId: number | null = null;
              try {
                console.log(`🔍 查詢後端歌詞偏好: ${videoId}`);
                const backendPrefs = await apiService.getLyricsPreferences(videoId);
                if (backendPrefs?.lrclibId) {
                  lrclibId = backendPrefs.lrclibId;
                }
                if (backendPrefs?.neteaseId) {
                  neteaseId = backendPrefs.neteaseId;
                }
              } catch (error) {
                console.log(`⚠️ 後端獲取失敗，使用本地快取 preference`, error);
                const localPref = await lyricsCacheService.getPreference(videoId);
                if (localPref?.lrclibId) lrclibId = localPref.lrclibId;
                if (localPref?.neteaseId) neteaseId = localPref.neteaseId;
              }

              if (lrclibId) {
                const lrcLibLyrics = await apiService.getLyricsByLRCLIBId(videoId, lrclibId);
                if (lrcLibLyrics) {
                  console.log(`📝 歌詞從 LRCLIB ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(lrcLibLyrics));
                  lyricsCacheService.set(videoId, lrcLibLyrics).catch(err => console.warn('Failed to cache lyrics:', err));
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              if (neteaseId) {
                const neteaseLyrics = await apiService.getLyricsByNeteaseId(videoId, neteaseId);
                if (neteaseLyrics) {
                  console.log(`📝 歌詞從 NetEase ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(neteaseLyrics));
                  lyricsCacheService.set(videoId, neteaseLyrics).catch(err => console.warn('Failed to cache lyrics:', err));
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              // 2. 檢查本地快取（只用 AI 生成的快取，跳過傳統來源）
              const cachedLyrics = await lyricsCacheService.get(videoId);
              if (cachedLyrics && cachedLyrics.source === 'manual') {
                // AI 生成的快取，直接用
                console.log(`📝 歌詞從 AI 快取載入: ${pendingTrack.title}`);
                dispatch(setCurrentLyrics(cachedLyrics));
                dispatch(setLyricsLoading(false));
                return;
              }

              // 3. 傳統來源為主（時間戳準確），用 SponsorBlock offset 對齊
              const lyrics = await apiService.getLyrics(videoId, pendingTrack.title, pendingTrack.channel);
              if (lyrics && lyrics.lines?.length > 3) {
                // 用 SponsorBlock music_offtopic 計算 offset
                // 如果影片前面有非音樂段落，歌詞時間戳需要加上 offset
                const segments = skipSegmentsRef.current;
                const introSegment = segments.find(s => s.category === 'music_offtopic' && s.start < 5);
                if (introSegment && lyrics.isSynced) {
                  const offset = introSegment.end;
                  // 只在歌詞第一行 time 比 offset 小很多時才 offset（避免誤判）
                  const firstLineTime = lyrics.lines[0]?.time || 0;
                  if (firstLineTime < offset * 0.5) {
                    console.log(`🔧 SponsorBlock offset: +${offset.toFixed(1)}s (非音樂段落 0-${offset.toFixed(1)}s)`);
                    lyrics.lines = lyrics.lines.map(line => ({
                      ...line,
                      time: line.time + offset,
                    }));
                  }
                }

                console.log(`📝 歌詞載入: ${pendingTrack.title} (${lyrics.source}, ${lyrics.lines.length} 行, synced: ${lyrics.isSynced})`);
                dispatch(setCurrentLyrics(lyrics));
                lyricsCacheService.set(videoId, lyrics).catch(() => {});
              } else {
                dispatch(setLyricsError('找不到歌詞'));
              }
            } catch (error) {
              console.error('獲取歌詞失敗:', error);
              dispatch(setLyricsError('獲取歌詞失敗'));
            } finally {
              dispatch(setLyricsLoading(false));
            }
          })();
        };

        const handleCanPlay = () => confirmAndPlay('canplay');
        const handleCanPlayThrough = () => confirmAndPlay('canplaythrough');
        const handleLoadedData = () => confirmAndPlay('loadeddata');

        const handleLoadedMetadata = () => {
          dispatch(setDuration(pendingTrack.duration || audio.duration));
          // 在手機端，有時只有 loadedmetadata 會觸發，延遲 500ms 後確認
          setTimeout(() => {
            if (!hasConfirmed && audio.readyState >= 1) {
              confirmAndPlay('loadedmetadata-delayed');
            }
          }, 500);
        };

        // 多重事件監聽確保相容性（手機瀏覽器可能只觸發部分事件）
        audio.addEventListener('canplay', handleCanPlay, { once: true });
        audio.addEventListener('canplaythrough', handleCanPlayThrough, { once: true });
        audio.addEventListener('loadeddata', handleLoadedData, { once: true });
        audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

        // Timeout fallback：10秒後如果還沒觸發任何事件，根據 readyState 決定
        fallbackTimeoutId = setTimeout(() => {
          if (!hasConfirmed) {
            if (audio.readyState >= 2) {
              // readyState >= 2 表示有足夠數據可以播放
              console.warn(`⚠️ Audio events timeout (readyState: ${audio.readyState}), confirming: ${pendingTrack.title}`);
              confirmAndPlay('timeout-fallback');
            } else if (audio.readyState >= 1) {
              // readyState 1 表示有元數據但數據不足，再等 5 秒
              console.warn(`⚠️ Audio not ready (readyState: ${audio.readyState}), waiting 5 more seconds...`);
              setTimeout(() => {
                if (!hasConfirmed) {
                  console.warn(`⚠️ Extended timeout, forcing confirm (readyState: ${audio.readyState})`);
                  confirmAndPlay('extended-timeout');
                }
              }, 5000);
            } else {
              // readyState 0 表示還沒開始加載，再等 15 秒
              // （設定 src 後瀏覽器需要時間開始載入）
              console.warn(`⚠️ Audio not started loading (readyState: 0), waiting 15 more seconds...`);
              setTimeout(() => {
                if (!hasConfirmed) {
                  if (audio.readyState >= 1) {
                    console.warn(`⚠️ Audio started loading after delay, confirming...`);
                    confirmAndPlay('delayed-start-confirm');
                  } else {
                    // readyState 仍是 0：觸發重試而不是放棄
                    console.warn(`⚠️ Audio readyState still 0 after 25s, triggering retry for: ${pendingTrack.title}`);
                    const vid = currentVideoIdRef.current;
                    if (vid) {
                      const freshUrl = `${apiService.getStreamUrl(vid)}?_retry=timeout&_t=${Date.now()}`;
                      audio.src = freshUrl;
                      audio.load();
                      audio.play().catch(() => {});
                    } else {
                      setIsLoading(false);
                      dispatch(cancelPendingTrack());
                      dispatch(setIsPlaying(false));
                    }
                  }
                }
              }, 15000);
            }
          }
        }, 10000);

        console.log(`🔄 Calling audio.load() for: ${pendingTrack.title}`);
        audio.load();
        console.log(`✅ audio.load() completed, readyState: ${audio.readyState}`);

      } catch (error) {
        console.error('Failed to load pending audio:', error);
        setIsLoading(false);
        dispatch(cancelPendingTrack());
        dispatch(setIsPlaying(false));
      }
    };

    loadPendingAudio();

    // 清理函數
    return () => {
      // 如果有未使用的 pending blob URL，釋放它
      if (pendingBlobUrlRef.current) {
        URL.revokeObjectURL(pendingBlobUrlRef.current);
        pendingBlobUrlRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTrack?.videoId, dispatch]);

  // 當播放狀態改變時（影片模式下不播放音訊）
  useEffect(() => {
    if (embedded) return;
    if (!audioRef.current) return;

    let playWhenReadyHandler: (() => void) | null = null;
    const audio = audioRef.current;

    if (displayMode === 'video') {
      // 🎬 影片模式：audio element 持續正常播放（背景播放 + 鎖屏控制需要）
      // YouTube iframe 會被靜音（在 VideoPlayer 裡處理），audio element 是唯一音源
      // 重要：不能 pause/mute audio，否則 iOS 鎖屏或切到背景時音樂會斷
      console.log('🎬 影片模式：audio element 持續播放，YouTube iframe 靜音');
      if (isPlaying && audio.paused && audio.src) {
        audio.play().catch(() => {});
      }
    } else if (prevDisplayModeRef.current === 'video') {
      // 🎵 從影片模式切回：確保 audio 狀態正確（防禦性恢復）
      audio.muted = false;
      audio.volume = volume;
      console.log(`🔄 從影片模式切回，音訊時間: ${audio.currentTime.toFixed(1)}s, volume: ${volume}`);
      if (isPlaying && audio.paused && audio.src) {
        audio.play().catch(() => {});
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    } else {
      // 普通 play/pause toggle（非影片模式切換）
      if (isPlaying && audio.paused && audio.readyState >= 2 && audio.src && !isLoadingTrack) {
        audio.play().catch(() => {});
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    }

    // 記錄上一次的 displayMode，下次 effect 用來判斷是否從影片模式切回
    prevDisplayModeRef.current = displayMode;

    return () => {
      if (playWhenReadyHandler && audioRef.current) {
        audioRef.current.removeEventListener('canplay', playWhenReadyHandler);
      }
    };
  }, [displayMode, isPlaying, isLoadingTrack, dispatch]);

  // 當音量改變時（crossfade 進行中不直接設定 volume，由 crossfade engine 處理）
  useEffect(() => {
    if (embedded) return;
    if (audioRef.current && !crossfade.crossfadeActiveRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // 當需要 seek 時（所有模式，audio element 是唯一音源）
  useEffect(() => {
    if (embedded) return;
    if (seekTarget !== null && audioRef.current && !isLoadingTrack) {
      audioRef.current.currentTime = seekTarget;
      dispatch(clearSeekTarget());
    }
  }, [seekTarget, displayMode, isLoadingTrack, dispatch]);

  // 定期檢查快取狀態（串流播放中，背景下載完成後更新 tag）
  useEffect(() => {
    if (embedded) return;
    if (isCached || !currentTrack?.videoId) return;
    const check = setInterval(async () => {
      const cached = await audioCacheService.get(currentTrack.videoId);
      if (cached) { setIsCached(true); clearInterval(check); }
    }, 5000);
    return () => clearInterval(check);
  }, [currentTrack?.videoId, isCached]);

  // 預加載接下來 3 首：先 backend 下載，再前端 IndexedDB 快取
  useEffect(() => {
    if (embedded) return;
    if (!currentTrack || playlist.length === 0 || currentIndex < 0) return;

    const PRELOAD_AHEAD = 3;
    let cancelled = false;

    const preloadTasks = [];
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const idx = currentIndex + i;
      if (idx >= playlist.length) break;

      const track = playlist[idx];
      preloadTasks.push((async () => {
        try {
          // 已在前端快取？跳過
          const cached = await audioCacheService.get(track.videoId);
          if (cached || cancelled) return;

          // 直接下載到前端 IndexedDB（不等 backend cache，不等播放進度）
          console.log(`⏬ 預載第 +${i} 首 (前端): ${track.title}`);
          // 同時觸發 backend 預載（背景，不阻塞）
          apiService.preloadAudio(track.videoId).catch(() => {});

          const streamUrl = apiService.getStreamUrl(track.videoId);
          await audioCacheService.fetchAndCache(track.videoId, streamUrl, {
            title: track.title,
            channel: track.channel,
            thumbnail: track.thumbnail,
            duration: track.duration,
          });
          if (!cancelled) {
            console.log(`✅ 預載完成 (+${i}): ${track.title}`);
          }
        } catch (err) {
          if (!cancelled) {
            console.warn(`⚠️ 預載失敗 (+${i}): ${track.title}`, err);
          }
        }
      })());
    }

    // Fire-and-forget: don't await Promise.all
    Promise.all(preloadTasks).catch(() => {});

    return () => { cancelled = true; };
  }, [currentTrack?.videoId, currentIndex, playlist]);

  // 音訊事件處理（在有曲目時添加）
  useEffect(() => {
    if (embedded) return;
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    let stalledTimeout: ReturnType<typeof setTimeout> | null = null;
    let endFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastTimeUpdate = Date.now();
    let lastCurrentTime = 0;
    let streamRetryCount = 0;
    const MAX_STREAM_RETRIES = 3;
    const STREAM_RETRY_DELAYS = [1000, 3000, 7000]; // exponential backoff

    const handleTimeUpdate = () => {
      // audio element 是唯一音源，所有模式都更新時間
      // 用 trackDuration clamp，避免尾部靜音時進度條跑超過
      const td = currentTrack?.duration;
      const clampedTime = (td && td > 0 && audio.currentTime > td) ? td : audio.currentTime;
      dispatch(setCurrentTime(clampedTime));
      // Record complete when 90% reached (用 YouTube metadata duration)
      const completeDur = currentTrack?.duration || audio.duration;
      if (!completeSentRef.current && completeDur > 0 && audio.currentTime >= completeDur * 0.9) {
        completeSentRef.current = true;
        // Note: wasCompletedRef is NOT set here — it gates the time-based end detection
        // and must only be set when actually triggering playNext()
        if (currentVideoIdRef.current) {
          apiService.recordComplete(currentVideoIdRef.current).catch(() => {});
        }
        // iOS 背景 fallback：設定 setTimeout 在 trackDuration + 3s 後強制跳下一首
        // 因為 iOS 鎖屏時 timeupdate 事件會被暫停，時間偵測無法觸發
        if (!endFallbackTimeout && currentTrack?.duration) {
          const remainingMs = (currentTrack.duration - audio.currentTime + 3) * 1000;
          endFallbackTimeout = setTimeout(() => {
            if (!wasCompletedRef.current && displayMode !== 'video') {
              console.log('⏰ iOS fallback: timeupdate 未觸發結尾偵測，強制跳下一首');
              wasCompletedRef.current = true;
              dispatch(playNext());
            }
          }, Math.max(remainingMs, 1000));
        }
      }
      // SponsorBlock: 自動跳過片段
      const t = audio.currentTime;
      for (let i = 0; i < skipSegmentsRef.current.length; i++) {
        const seg = skipSegmentsRef.current[i];
        // 已跳過的 segment 不再處理
        if (skippedSegmentsRef.current.has(i)) continue;
        if (t >= seg.start && t < seg.end) {
          // 快取模式跳過 buffer 檢查（整首歌都在記憶體中）
          if (!isCached) {
            // 串流模式：檢查 seek 目標是否在已 buffer 範圍內
            let canSeek = false;
            for (let b = 0; b < audio.buffered.length; b++) {
              if (audio.buffered.start(b) <= seg.end && audio.buffered.end(b) >= seg.end) {
                canSeek = true;
                break;
              }
            }
            if (!canSeek) {
              console.log(`⏳ [SponsorBlock] 等待緩衝到 ${seg.end.toFixed(1)}s 再跳過`);
              break;
            }
          }
          const skipDuration = Math.round(seg.end - seg.start);
          const labels: Record<string, string> = {
            music_offtopic: '非音樂段落', sponsor: '工商廣告',
            intro: '片頭', outro: '片尾',
            selfpromo: '自我推廣', interaction: '訂閱提醒',
          };
          console.log(`🚫 [SponsorBlock] Skipping ${seg.category}: ${seg.start.toFixed(1)}→${seg.end.toFixed(1)}`);
          skippedSegmentsRef.current.add(i);
          audio.currentTime = seg.end;
          lastSkipRef.current = seg.end;
          setSkipToast(`已跳過${labels[seg.category] || seg.category} ${skipDuration}s`);
          break;
        }
      }
      // 用 YouTube metadata duration 偵測實際結尾（必須在 crossfade 之前，避免被跳過）
      const trackDuration = currentTrack?.duration;
      if (trackDuration && trackDuration > 0 && t >= trackDuration - 0.5 && !wasCompletedRef.current) {
        // crossfade 活躍時由 crossfade 處理跳曲，不重複觸發
        if (!crossfade.crossfadeActiveRef.current) {
          console.log(`⏭️ 到達 YouTube 原始長度 ${trackDuration}s，跳下一首（audio.duration=${audio.duration.toFixed(1)}s）`);
          wasCompletedRef.current = true;
          if (endFallbackTimeout) { clearTimeout(endFallbackTimeout); endFallbackTimeout = null; }
          if (displayMode !== 'video') dispatch(playNext());
          return;
        }
      }

      // 🔊 Crossfade: check if we should preload/start crossfade
      if (trackDuration && trackDuration > 0 && !crossfade.crossfadeActiveRef.current) {
        const crossfadeHandling = crossfade.checkTimeForCrossfade(t, trackDuration);
        if (crossfadeHandling) {
          lastTimeUpdate = Date.now();
          lastCurrentTime = audio.currentTime;
          return;
        }
      }

      // If crossfade is active, let it handle everything
      if (crossfade.crossfadeActiveRef.current) {
        lastTimeUpdate = Date.now();
        lastCurrentTime = audio.currentTime;
        return;
      }

      // 追蹤時間更新，用於偵測假播放
      lastTimeUpdate = Date.now();
      lastCurrentTime = audio.currentTime;
    };

    const handleDurationChange = () => {
      // 影片模式時不更新時長（由 VideoPlayer 負責）
      if (displayMode !== 'video') {
        // 用 YouTube metadata duration（沒有尾部靜音）
        const trackDur = currentTrack?.duration;
        dispatch(setDuration(trackDur && trackDur > 0 ? trackDur : audio.duration));
      }
    };

    const handleEnded = () => {
      // If crossfade is active, the outgoing element naturally ended — ignore
      if (crossfade.crossfadeActiveRef.current) return;

      if (endFallbackTimeout) { clearTimeout(endFallbackTimeout); endFallbackTimeout = null; }
      wasCompletedRef.current = true;
      // Record complete signal (only if not already sent at 90%)
      if (!completeSentRef.current && currentVideoIdRef.current) {
        completeSentRef.current = true;
        apiService.recordComplete(currentVideoIdRef.current).catch(() => {});
      }
      // 影片模式時由 VideoPlayer 處理播放結束
      if (displayMode !== 'video') {
        dispatch(playNext());
      }
    };

    const handleError = async (e: Event) => {
      const error = (e.target as HTMLAudioElement).error;
      console.error('Audio error:', error?.code, error?.message);

      const videoId = currentVideoIdRef.current;
      if (!videoId || isCached) {
        console.warn(`⚠️ Audio error on ${isCached ? 'cached' : 'unknown'} track, skipping to next`);
        dispatch(setIsPlaying(false));
        dispatch(playNext());
        return;
      }

      streamRetryCount++;
      if (streamRetryCount > MAX_STREAM_RETRIES) {
        console.error(`❌ All ${MAX_STREAM_RETRIES} retries failed for ${videoId}, skipping to next`);
        dispatch(setIsPlaying(false));
        dispatch(playNext());
        return;
      }

      const delay = STREAM_RETRY_DELAYS[streamRetryCount - 1] || 7000;
      console.log(`🔄 Retry ${streamRetryCount}/${MAX_STREAM_RETRIES}: waiting ${delay}ms, checking cache first...`);

      await new Promise(r => setTimeout(r, delay));
      if (currentVideoIdRef.current !== videoId) return;

      // 先檢查背景下載是否已完成
      const status = await apiService.getCacheStatus(videoId).catch(() => ({ cached: false }));
      if (status.cached) {
        console.log(`✅ 背景下載已完成，從快取播放: ${videoId}`);
        setIsCached(true);
      } else {
        console.log(`⏳ 快取未完成，重試串流: ${videoId}`);
      }

      const freshUrl = `${apiService.getStreamUrl(videoId)}?_retry=${streamRetryCount}&_t=${Date.now()}`;
      audio.src = freshUrl;
      audio.load();
      audio.play().catch(() => {});
    };

    // 手機端特殊處理：偵測假播放（進度在跑但沒聲音）
    let stalledRetryCount = 0;
    const MAX_STALLED_RETRIES = 3;
    const handleStalled = () => {
      if (stalledRetryCount >= MAX_STALLED_RETRIES) return; // 不再重試
      console.warn(`⚠️ Audio stalled (${stalledRetryCount + 1}/${MAX_STALLED_RETRIES})`);
      if (stalledTimeout) clearTimeout(stalledTimeout);
      stalledTimeout = setTimeout(() => {
        if (audio.paused === false && audio.currentTime === lastCurrentTime && displayModeRef.current !== 'video') {
          stalledRetryCount++;
          console.log(`🔄 嘗試重新載入音訊 (${stalledRetryCount}/${MAX_STALLED_RETRIES})...`);
          const currentSrc = audio.src;
          const currentPosition = audio.currentTime;
          audio.src = '';
          audio.src = currentSrc;
          audio.currentTime = currentPosition;
          audio.play().catch(() => {});
        }
      }, 3000);
    };

    const handleWaiting = () => {
      console.log('⏳ Audio waiting - 等待緩衝...');
      // 设置超时自动恢复播放，防止卡住
      setTimeout(() => {
        if (audio && !audio.paused && audio.readyState >= 2 && isPlaying) {
          console.log('🔄 Waiting 超时，尝试恢复播放...');
          audio.play().catch(err => console.error('恢复播放失败:', err));
        }
      }, 3000); // 3秒后尝试恢复
    };

    const handleSeeked = () => {
      console.log('✅ Seeked 完成');
      // Seek 完成后，如果应该在播放状态，确保继续播放
      if (isPlaying && audio.paused && audio.readyState >= 2) {
        console.log('🔄 Seek 后恢复播放...');
        audio.play().catch(() => {
          // 瀏覽器 autoplay 限制 — 使用者需要點一下播放按鈕
        });
      }
    };

    // 偵測假播放：播放中但時間沒有更新
    let fakePlaybackRetryCount = 0;
    const MAX_FAKE_PLAYBACK_RETRIES = 3;

    const checkFakePlayback = setInterval(() => {
      if (!audio.paused && isPlaying && displayMode !== 'video') {
        const timeSinceUpdate = Date.now() - lastTimeUpdate;
        // 如果超過 4 秒沒有時間更新，可能是假播放
        if (timeSinceUpdate > 4000 && audio.currentTime === lastCurrentTime && audio.currentTime > 0) {
          fakePlaybackRetryCount++;
          console.warn(`⚠️ 偵測到假播放 (第 ${fakePlaybackRetryCount} 次)，嘗試恢復...`);

          // 多策略恢復
          const recoveryStrategies = [
            // 策略 1: seek 到當前位置觸發重新載入
            () => {
              console.log('🔄 策略 1: Seek 恢復');
              audio.currentTime = audio.currentTime + 0.1;
              return audio.play();
            },
            // 策略 2: 暫停後重新播放
            () => {
              console.log('🔄 策略 2: 暫停重播');
              audio.pause();
              return new Promise<void>((resolve) => {
                setTimeout(() => {
                  audio.play().then(resolve).catch(() => resolve());
                }, 200);
              });
            },
            // 策略 3: 重新載入音訊源
            () => {
              console.log('🔄 策略 3: 重新載入');
              const src = audio.src;
              const pos = audio.currentTime;
              audio.src = '';
              audio.src = src;
              audio.currentTime = pos;
              return audio.play();
            },
          ];

          const strategyIndex = Math.min(fakePlaybackRetryCount - 1, recoveryStrategies.length - 1);
          recoveryStrategies[strategyIndex]().catch((err) => {
            console.error('恢復失敗:', err);
            if (fakePlaybackRetryCount >= MAX_FAKE_PLAYBACK_RETRIES) {
              console.error('❌ 已達最大重試次數，停止播放');
              dispatch(setIsPlaying(false));
              fakePlaybackRetryCount = 0;
            }
          });
        } else if (timeSinceUpdate < 2000) {
          // 正常播放中，重置重試計數
          fakePlaybackRetryCount = 0;
          stalledRetryCount = 0;
        }
      }
    }, 3000); // 改為 3 秒檢查一次

    // 影片模式：audio element 是唯一音源，不可靜音
    // YouTube iframe 已被靜音（event.target.mute()），audio 必須正常播放
    const handlePlaying = () => {
      // no-op：不再靜音 audio（舊架構遺留已移除）
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('seeked', handleSeeked);

    // iOS 鎖屏恢復：頁面回到前台時自動恢復播放 + 檢查是否已超過歌曲結尾
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // 檢查是否已超過 trackDuration（iOS 背景中 timeupdate 可能被暫停）
        const trackDur = currentTrack?.duration;
        if (trackDur && trackDur > 0 && audio.currentTime >= trackDur - 0.5 && !wasCompletedRef.current) {
          console.log('📱 回到前台：偵測到已超過歌曲結尾，跳下一首');
          wasCompletedRef.current = true;
          if (!completeSentRef.current && currentVideoIdRef.current) {
            completeSentRef.current = true;
            apiService.recordComplete(currentVideoIdRef.current).catch(() => {});
          }
          if (displayMode !== 'video') {
            dispatch(playNext());
            return;
          }
        }
        // 恢復暫停的播放
        if (isPlayingRef.current && audio.paused && audio.src) {
          console.log('📱 頁面回到前台，恢復音訊播放');
          audio.play().catch((err) => {
            console.warn('恢復播放失敗:', err);
          });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (stalledTimeout) clearTimeout(stalledTimeout);
      if (endFallbackTimeout) clearTimeout(endFallbackTimeout);
      clearInterval(checkFakePlayback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('seeked', handleSeeked);
    };
  }, [currentTrack, displayMode, isPlaying, dispatch]);

  // Media Session API - 支援手機鎖屏播放控制與背景播放
  useEffect(() => {
    if (embedded) return;
    if (!currentTrack || !('mediaSession' in navigator)) {
      return;
    }

    // 設定媒體元資料（鎖屏顯示）
    const artwork = currentTrack.thumbnail ? [
      { src: currentTrack.thumbnail, sizes: '96x96', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '128x128', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '192x192', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '256x256', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '384x384', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' },
    ] : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.channel,
      artwork,
    });

    // 設定播放控制按鈕回調
    navigator.mediaSession.setActionHandler('play', () => {
      dispatch(setIsPlaying(true));
      if (displayModeRef.current !== 'video') {
        audioRef.current?.play();
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      dispatch(setIsPlaying(false));
      audioRef.current?.pause();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      dispatch(playPrevious());
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      dispatch(playNext());
    });

    // 明確移除 seekbackward/seekforward，iOS 才會顯示上/下首按鈕而非前進後退 10 秒
    try {
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    } catch {
      // 部分瀏覽器不支援設為 null
    }

    // 設定正確的播放位置與時長（覆蓋 audio.duration 的尾部靜音）
    const updatePositionState = () => {
      try {
        const duration = currentTrack.duration && currentTrack.duration > 0
          ? currentTrack.duration : audioRef.current?.duration || 0;
        if (duration > 0 && audioRef.current) {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate: audioRef.current.playbackRate || 1,
            position: Math.min(audioRef.current.currentTime, duration),
          });
        }
      } catch { /* 部分瀏覽器不支援 */ }
    };

    // 初始設定 + 定期更新（鎖屏進度條）
    updatePositionState();
    const positionInterval = setInterval(updatePositionState, 5000);

    console.log('🎵 Media Session API 已設定:', currentTrack.title);

    return () => {
      clearInterval(positionInterval);
      // 清理 action handlers
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      } catch {
        // 忽略清理錯誤
      }
    };
  }, [currentTrack, dispatch]);

  // 沒有 currentTrack 也沒有 pendingTrack 時，仍需渲染隱藏的 audio 元素
  // 以便 pendingTrack 可以使用它來載入音訊
  if (!currentTrack && !pendingTrack) {
    if (embedded) return null;
    return (<>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
      <audio ref={secondaryAudioRef} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
    </>);
  }

  // 有 pendingTrack 但沒有 currentTrack 時，顯示載入狀態
  const displayTrack = currentTrack || pendingTrack;

  if (!displayTrack) {
    if (embedded) return null;
    return (<>
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
      <audio ref={secondaryAudioRef} preload="auto" crossOrigin="anonymous" style={{ display: 'none' }} />
    </>);
  }

  return (
    <Card
      sx={{
        ...(!embedded && {
          flexShrink: 0, // 不被壓縮
        }),
        borderRadius: 0,
        height: embedded ? '100%' : 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {embedded ? (
        /* ===== EMBEDDED 模式（全螢幕歌詞內）===== */
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', pb: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'flex-start', pt: 2, alignItems: 'center' }}>
            <CardMedia
              component="img"
              sx={{ width: '100%', height: 'auto', aspectRatio: '1', maxWidth: 280, borderRadius: 1 }}
              image={displayTrack.thumbnail}
              alt={displayTrack.title}
            />
            <Box sx={{ width: '100%', mt: 1 }}>
              <Box sx={{ overflow: 'hidden', width: '100%' }}>
                <Typography
                  variant="subtitle1"
                  noWrap
                  sx={{
                    fontWeight: 600,
                    width: '100%',
                    textAlign: 'center',
                    display: 'inline-block',
                    whiteSpace: 'nowrap',
                    animation: displayTrack.title.length > 25 ? 'marquee 12s linear infinite' : 'none',
                    '@keyframes marquee': {
                      '0%': { transform: 'translateX(0%)' },
                      '30%': { transform: 'translateX(0%)' },
                      '70%': { transform: 'translateX(calc(-100% + 250px))' },
                      '100%': { transform: 'translateX(0%)' },
                    },
                  }}
                >
                  {displayTrack.title}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ textAlign: 'center', mb: 1 }}>
                {displayTrack.channel}
              </Typography>
              <PlayerControls embedded />
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2 }}>
                {autoplayBlocked && (
                  <Button variant="contained" color="primary" size="small" startIcon={<PlayArrowIcon />}
                    onClick={() => { audioRef.current?.play().then(() => setAutoplayBlocked(false)).catch(console.error); }}
                  >點擊播放</Button>
                )}
                {!autoplayBlocked && onOpenLyrics && (
                  <IconButton onClick={onOpenLyrics}><LyricsIcon /></IconButton>
                )}
                {!autoplayBlocked && (
                  <IconButton onClick={(e) => setPlaylistMenuAnchor(e.currentTarget)}><PlaylistAddIcon /></IconButton>
                )}
              </Box>
            </Box>
          </Box>
        </CardContent>
      ) : (
        /* ===== 迷你播放器模式（固定在底部）===== */
        <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
          {/* 第一行：封面 + 標題/頻道 + 功能按鈕 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
            {/* 點擊封面/標題展開歌詞 */}
            <Box
              onClick={onOpenLyrics}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexGrow: 1, minWidth: 0, cursor: 'pointer' }}
            >
            {/* 封面圖：播放時帶琥珀光暈 */}
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <CardMedia
                component="img"
                sx={{
                  width: 46,
                  height: 46,
                  borderRadius: 1.5,
                  display: 'block',
                  boxShadow: isPlaying
                    ? '0 0 0 2px rgba(245,166,35,0.35), 0 4px 16px rgba(0,0,0,0.45)'
                    : '0 2px 10px rgba(0,0,0,0.4)',
                  transition: 'box-shadow 0.4s ease',
                  animation: isPlaying ? 'pulse-glow 2.8s ease-in-out infinite' : 'none',
                }}
                image={displayTrack.thumbnail}
                alt={displayTrack.title}
              />
              {/* 正在播放均衡器動畫 */}
              {isPlaying && !isLoading && !isLoadingTrack && (
                <Box sx={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: '2px',
                  height: 14,
                }}>
                  {[
                    { anim: 'eq-bar1 0.7s ease-in-out infinite' },
                    { anim: 'eq-bar2 0.85s ease-in-out infinite 0.1s' },
                    { anim: 'eq-bar3 0.75s ease-in-out infinite 0.2s' },
                  ].map((bar, i) => (
                    <Box key={i} sx={{
                      width: 2,
                      borderRadius: 1,
                      backgroundColor: '#F5A623',
                      animation: bar.anim,
                    }} />
                  ))}
                </Box>
              )}
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Box sx={{ overflow: 'hidden', width: '100%' }}>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{
                    fontWeight: 600,
                    fontFamily: '"Outfit", sans-serif',
                    fontSize: '0.85rem',
                    lineHeight: 1.3,
                    display: 'inline-block',
                    whiteSpace: 'nowrap',
                    animation: displayTrack.title.length > 20 ? 'marquee 12s linear infinite' : 'none',
                    '@keyframes marquee': {
                      '0%': { transform: 'translateX(0%)' },
                      '30%': { transform: 'translateX(0%)' },
                      '70%': { transform: 'translateX(calc(-100% + 200px))' },
                      '100%': { transform: 'translateX(0%)' },
                    },
                  }}
                >
                  {displayTrack.title}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1, minWidth: 0, fontFamily: '"Outfit", sans-serif', fontSize: '0.72rem' }}
                >
                  {displayTrack.channel}
                </Typography>
                {/* 快取狀態：小圓點取代 Chip */}
                {!isLoading && !isLoadingTrack && (
                  <Box
                    title={isCached ? '本機快取' : '串流播放'}
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: isCached ? '#4ADE80' : '#40C4FF',
                      boxShadow: isCached
                        ? '0 0 4px rgba(74,222,128,0.7)'
                        : '0 0 4px rgba(64,196,255,0.7)',
                    }}
                  />
                )}
                {(isLoading || isLoadingTrack) && <CircularProgress size={12} />}
              </Box>
            </Box>
            </Box>{/* end clickable area */}
            {/* 功能按鈕 */}
            {autoplayBlocked ? (
              <IconButton size="small" color="primary"
                onClick={() => { audioRef.current?.play().then(() => setAutoplayBlocked(false)).catch(console.error); }}
              ><PlayArrowIcon /></IconButton>
            ) : (
              <>
                {onOpenLyrics && (
                  <IconButton size="small" onClick={onOpenLyrics} sx={{ color: 'text.secondary' }}>
                    <LyricsIcon fontSize="small" />
                  </IconButton>
                )}
                <IconButton size="small" onClick={(e) => setPlaylistMenuAnchor(e.currentTarget)} sx={{ color: 'text.secondary' }}>
                  <PlaylistAddIcon fontSize="small" />
                </IconButton>
              </>
            )}
          </Box>
          {/* 第二行：進度條 + 控制按鈕 */}
          <PlayerControls isCompact />
        </CardContent>
      )}

      {/* 隱藏的 audio 元素 - 放在 CardContent 外面確保不受條件渲染影響 */}
      {/* embedded 模式不渲染 audio 元素，避免多音訊同時播放 */}
      {!embedded && (<>
        <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />
        {/* 🔊 Secondary audio element for crossfade */}
        <audio ref={secondaryAudioRef} preload="auto" crossOrigin="anonymous" />
      </>)}

      {/* 加入播放清單選單 */}
      {currentTrack && (
        <AddToPlaylistMenu
          anchorEl={playlistMenuAnchor}
          open={Boolean(playlistMenuAnchor)}
          track={currentTrack}
          onClose={() => setPlaylistMenuAnchor(null)}
        />
      )}
      <Snackbar
        open={cacheToast}
        autoHideDuration={2000}
        onClose={() => setCacheToast(false)}
        message="✅ 已切換到快取播放"
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      />
      <Snackbar
        open={!!skipToast}
        autoHideDuration={2000}
        onClose={() => setSkipToast('')}
        message={`🚫 ${skipToast}`}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      />
    </Card>
  );
}
