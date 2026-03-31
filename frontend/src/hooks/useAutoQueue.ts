import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { appendToPlaylist } from '../store/playerSlice';
import apiService from '../services/api.service';
import type { Track } from '../types/track.types';

/**
 * 自動播放佇列 Hook
 * 當播放接近清單尾端時，自動加入推薦歌曲
 */
export function useAutoQueue() {
  const dispatch = useDispatch();
  const { currentTrack, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const isLoadingRef = useRef(false);
  const lastLoadedVideoIdRef = useRef<string | null>(null);

  useEffect(() => {
    // 沒有當前歌曲或播放清單，不執行
    if (!currentTrack || playlist.length === 0) {
      return;
    }

    // 計算剩餘歌曲數量
    const remainingSongs = playlist.length - currentIndex - 1;

    // 當剩餘歌曲少於 3 首時，自動加載推薦
    const shouldLoadMore = remainingSongs <= 2;

    if (!shouldLoadMore || isLoadingRef.current) {
      return;
    }

    // 避免重複載入同一首歌的推薦（但如果是最後一首歌 loop 回來，要重新載入）
    if (lastLoadedVideoIdRef.current === currentTrack.videoId && remainingSongs > 0) {
      return;
    }

    console.log(`🎵 自動佇列：剩餘 ${remainingSongs} 首，載入推薦...`);
    isLoadingRef.current = true;
    lastLoadedVideoIdRef.current = currentTrack.videoId;

    // 載入推薦歌曲
    const loadRecommendations = async () => {
      try {
        // 先嘗試載入 20 首推薦
        let recommendations = await apiService.getSimilarTracks(currentTrack.videoId, 20);
        
        console.log(`📥 收到推薦:`, recommendations);
        console.log(`推薦數量: ${recommendations?.length || 0}`);
        
        if (recommendations && recommendations.length > 0) {
          // 過濾掉已經在播放清單中的歌曲和 24/7 直播流
          const existingVideoIds = new Set(playlist.map(t => t.videoId));
          const newTracks: Track[] = recommendations
            .filter((rec: any) => {
              // 過濾掉已存在的
              if (existingVideoIds.has(rec.videoId)) return false;
              // 過濾掉直播流（duration 為 0 或超過 2 小時 = 7200 秒）
              const duration = rec.duration || 0;
              if (duration === 0 || duration > 7200) {
                console.log(`⏭️ 跳過直播流: ${rec.title} (${duration}s)`);
                return false;
              }
              return true;
            })
            .map((rec: any) => ({
              id: rec.videoId,
              videoId: rec.videoId,
              title: rec.title,
              channel: rec.channelName,
              thumbnail: rec.thumbnail,
              duration: rec.duration || 0,
            }));

          if (newTracks.length > 0) {
            // 只取前 10 首加入播放清單
            const tracksToAdd = newTracks.slice(0, 10);
            console.log(`✅ 自動佇列：加入 ${tracksToAdd.length} 首推薦歌曲`);
            // 將推薦歌曲加入播放清單末尾（不打斷現有順序）
            dispatch(appendToPlaylist(tracksToAdd));
          } else {
            console.warn(`⚠️ 自動佇列：所有 ${recommendations.length} 首推薦都被過濾（直播流或重複）`);
            console.log(`💡 建議：嘗試播放不同類型的歌曲以獲得更多元的推薦`);
          }
        } else {
          console.warn('⚠️ 自動佇列：沒有獲取到推薦歌曲');
        }
      } catch (error) {
        console.error('❌ 自動佇列載入失敗:', error);
      } finally {
        isLoadingRef.current = false;
      }
    };

    loadRecommendations();
  }, [currentTrack, playlist, currentIndex, dispatch]);
}
