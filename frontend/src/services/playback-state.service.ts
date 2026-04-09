/**
 * 播放狀態持久化服務
 * 將播放清單、索引、時間、音量等狀態儲存至 localStorage
 * 讓 PWA 在 iOS 終止並重載後可以恢復播放
 */

export interface PersistedPlaybackState {
  playlist: Array<{
    id: string;
    videoId: string;
    title: string;
    channel: string;
    thumbnail: string;
    duration: number;
  }>;
  currentIndex: number;
  currentTime: number;
  volume: number;
  isPlaying: boolean;
  savedAt: number; // Date.now()
}

const STORAGE_KEY = 'hm-playback-state';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const AUTO_SAVE_INTERVAL_MS = 5000; // 5 seconds

class PlaybackStateService {
  private pendingState: PersistedPlaybackState | null = null;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private recoverySeekTarget: number | null = null;

  /**
   * 儲存狀態到記憶體（由 React 頻繁呼叫）
   */
  save(state: Omit<PersistedPlaybackState, 'savedAt'>): void {
    this.pendingState = {
      ...state,
      savedAt: Date.now(),
    };
  }

  /**
   * 立即將記憶體中的狀態寫入 localStorage
   */
  flush(): void {
    if (!this.pendingState) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pendingState));
    } catch (error) {
      console.warn('[PlaybackState] Failed to flush to localStorage:', error);
    }
  }

  /**
   * 啟動自動儲存：每 5 秒寫入一次 + 頁面隱藏時立即寫入
   */
  startAutoSave(): void {
    this.stopAutoSave();

    this.autoSaveTimer = setInterval(() => {
      this.flush();
    }, AUTO_SAVE_INTERVAL_MS);

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * 停止自動儲存，清理計時器與事件監聽
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * 從 localStorage 讀取並驗證持久化狀態
   * 若超過 24 小時或播放清單為空則丟棄，回傳 null
   */
  restore(): PersistedPlaybackState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const state = JSON.parse(raw) as PersistedPlaybackState;

      // 驗證必要欄位
      if (
        !state ||
        typeof state.savedAt !== 'number' ||
        !Array.isArray(state.playlist)
      ) {
        console.warn('[PlaybackState] Invalid persisted state, discarding.');
        this.clear();
        return null;
      }

      // 丟棄超過 24 小時的狀態
      const age = Date.now() - state.savedAt;
      if (age > MAX_AGE_MS) {
        console.log(`[PlaybackState] State expired (age: ${Math.floor(age / 1000 / 60)}min), discarding.`);
        this.clear();
        return null;
      }

      // 丟棄空播放清單
      if (state.playlist.length === 0) {
        console.log('[PlaybackState] Empty playlist, discarding.');
        this.clear();
        return null;
      }

      console.log(
        `[PlaybackState] Restored: ${state.playlist.length} tracks, index=${state.currentIndex}, time=${state.currentTime.toFixed(1)}s`
      );
      return state;
    } catch (error) {
      console.warn('[PlaybackState] Failed to restore from localStorage:', error);
      this.clear();
      return null;
    }
  }

  /**
   * 從 localStorage 移除持久化狀態
   */
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn('[PlaybackState] Failed to clear localStorage:', error);
    }
    this.pendingState = null;
  }

  /**
   * 設定一次性的 crash recovery seek 目標時間
   * 由 App.tsx 在恢復播放後呼叫
   */
  setRecoverySeekTarget(time: number): void {
    this.recoverySeekTarget = time;
  }

  /**
   * 取出並消耗 seek 目標（只能讀取一次）
   * 由 AudioPlayer.tsx 在播放準備好後呼叫
   */
  consumeRecoverySeekTarget(): number | null {
    const target = this.recoverySeekTarget;
    this.recoverySeekTarget = null;
    return target;
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.flush();
    }
  };
}

export default new PlaybackStateService();
