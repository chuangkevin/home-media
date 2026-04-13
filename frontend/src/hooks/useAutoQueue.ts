import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { appendToPlaylist } from '../store/playerSlice';
import apiService from '../services/api.service';
import type { Track } from '../types/track.types';
import type { BlockedItem } from '../store/blockSlice';
import { buildTrackIdentity } from '../utils/trackIdentity';

/**
 * 自動播放佇列 Hook
 * 當播放接近清單尾端時，自動加入推薦歌曲
 */
export function useAutoQueue(enabled = true) {
  const dispatch = useDispatch();
  const { currentTrack, pendingTrack, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const blockedItems = useSelector((state: RootState) => state.block.items);
  const isLoadingRef = useRef(false);
  const lastLoadedVideoIdRef = useRef<string | null>(null);

  // 用 pendingTrack（正在載入的）優先，否則用 currentTrack
  // 解決：playNow 時 currentTrack 還是舊歌，推薦用錯 artist
  const activeTrack = pendingTrack || currentTrack;
  const activeVideoId = activeTrack?.videoId;
  const remainingSongs = playlist.length - currentIndex - 1;

  useEffect(() => {
    if (!enabled) return;
    if (!activeVideoId || playlist.length === 0) return;

    // 等 metadata 載入完才推薦（避免用空 artist 推薦）
    if (!activeTrack?.channel || activeTrack.title === '載入中...') return;

    const shouldLoadMore = remainingSongs <= 2;
    if (!shouldLoadMore || isLoadingRef.current) return;

    // 防止同一首歌在同一個 playlist 長度下重複載入
    const key = `${activeVideoId}:${playlist.length}`;
    if (lastLoadedVideoIdRef.current === key) return;

    console.log(`🎵 自動佇列：剩餘 ${remainingSongs} 首，載入推薦（${activeTrack?.channel}）...`);
    isLoadingRef.current = true;
    lastLoadedVideoIdRef.current = key;

    // 載入推薦歌曲
    const loadRecommendations = async () => {
      try {
        // 載入推薦：同歌手 10 首 + AI 推薦 10 首
        let recommendations = await apiService.getSimilarTracks(
          activeVideoId, 20, activeTrack?.channel, activeTrack?.title
        );
        
        console.log(`📥 收到推薦:`, recommendations);
        console.log(`推薦數量: ${recommendations?.length || 0}`);
        
        if (recommendations && recommendations.length > 0) {
          // 過濾掉已經在播放清單中的歌曲和 24/7 直播流
          const existingVideoIds = new Set(playlist.map(t => t.videoId));
          // 同藝人+歌名去重（不同 videoId 但實質相同的歌，如 official MV vs lyric video）
          const existingTitleKeys = new Set(
            playlist.map(t => buildTrackIdentity(t.title || '', t.channel || ''))
          );
          const newTracks: Track[] = recommendations
            .filter((rec: any) => {
              // 過濾掉已存在的 videoId
              if (existingVideoIds.has(rec.videoId)) return false;
              // 過濾掉同藝人+歌名（忽略大小寫）
              const titleKey = buildTrackIdentity(rec.title || '', rec.channelName || rec.channel || '');
              if (existingTitleKeys.has(titleKey)) {
                console.log(`⏭️ 跳過重複歌曲: ${rec.title} (同藝人+歌名)`);
                return false;
              }
              existingTitleKeys.add(titleKey); // 防止同批推薦內重複
              // 過濾掉直播流和合輯（duration 為 0 或超過 10 分鐘 = 600 秒）
              const duration = rec.duration || 0;
              if (duration === 0 || duration > 600) {
                console.log(`⏭️ 跳過直播流: ${rec.title} (${duration}s)`);
                return false;
              }
              // 過濾掉被封鎖的歌曲和頻道
              const isBlockedItem = blockedItems.some((b: BlockedItem) =>
                (b.type === 'song' && b.video_id === rec.videoId) ||
                (b.type === 'channel' && b.channel_name === (rec.channelName || rec.channel))
              );
              if (isBlockedItem) {
                console.log(`⏭️ 跳過封鎖項目: ${rec.title}`);
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
            // 全部加入（backend 已經控制數量：同歌手 10 + AI 推薦 10）
            const tracksToAdd = newTracks;
            console.log(`✅ 自動佇列：加入 ${tracksToAdd.length} 首推薦歌曲`);
            // 將推薦歌曲加入播放清單末尾（不打斷現有順序）
            dispatch(appendToPlaylist(tracksToAdd));

            // 預熱推薦歌曲的音訊 URL（backend 快取 yt-dlp URL，加速後續播放）
            apiService.prewarmUrls(newTracks.map(t => t.videoId)).catch(() => {});
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, activeVideoId, currentIndex, playlist.length]);
}
