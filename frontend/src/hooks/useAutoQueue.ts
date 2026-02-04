import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { setPlaylist } from '../store/playerSlice';
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

    // 避免重複載入同一首歌的推薦
    if (lastLoadedVideoIdRef.current === currentTrack.videoId) {
      return;
    }

    console.log(`🎵 自動佇列：剩餘 ${remainingSongs} 首，載入推薦...`);
    isLoadingRef.current = true;
    lastLoadedVideoIdRef.current = currentTrack.videoId;

    // 載入推薦歌曲
    const loadRecommendations = async () => {
      try {
        const recommendations = await apiService.getSimilarTracks(currentTrack.videoId, 10);
        
        if (recommendations && recommendations.length > 0) {
          // 過濾掉已經在播放清單中的歌曲
          const existingVideoIds = new Set(playlist.map(t => t.videoId));
          const newTracks: Track[] = recommendations
            .filter((rec: any) => !existingVideoIds.has(rec.videoId))
            .map((rec: any) => ({
              id: rec.videoId,
              videoId: rec.videoId,
              title: rec.title,
              channel: rec.channelName,
              thumbnail: rec.thumbnail,
              duration: rec.duration || 0,
            }));

          if (newTracks.length > 0) {
            console.log(`✅ 自動佇列：加入 ${newTracks.length} 首推薦歌曲`);
            // 將推薦歌曲加入播放清單末尾
            dispatch(setPlaylist([...playlist, ...newTracks]));
          } else {
            console.log(`⚠️ 自動佇列：所有推薦歌曲已在播放清單中`);
          }
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
