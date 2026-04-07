/**
 * 音訊快取服務
 * 使用 IndexedDB 儲存音訊 blob，實現離線播放和快速重播
 */

export interface CachedAudioMetadata {
  title: string;
  channel: string;
  thumbnail: string;
  duration?: number;
}

interface CachedAudio {
  videoId: string;
  blob: Blob;
  timestamp: number;
  size: number;
  metadata?: CachedAudioMetadata; // 可選，向後相容舊快取
}

export interface CacheListItem {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  size: number;
  timestamp: number;
  duration?: number;
}

class AudioCacheService {
  private dbName = 'AudioCacheDB';
  private storeName = 'audioCache';
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private inFlightDownloads = new Map<string, Promise<string>>();
  private inFlightControllers = new Map<string, AbortController>();

  // 快取設置（預設值）
  private MAX_CACHE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB 最大快取
  private MAX_ENTRIES = 200; // 最多儲存 200 首歌曲
  private CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天快取期限
  private readonly PRELOAD_ENABLED = true;
  private settingsLoaded = false;

  /**
   * 從後端載入快取設定
   */
  private async loadSettings(): Promise<void> {
    try {
      const response = await fetch('/api/settings');
      if (response.ok) {
        const settings = await response.json();
        
        if (settings.audio_cache_ttl_days) {
          this.CACHE_TTL = settings.audio_cache_ttl_days * 24 * 60 * 60 * 1000;
        }
        if (settings.audio_cache_max_size_gb) {
          this.MAX_CACHE_SIZE = settings.audio_cache_max_size_gb * 1024 * 1024 * 1024;
        }
        if (settings.audio_cache_max_entries) {
          this.MAX_ENTRIES = settings.audio_cache_max_entries;
        }
        
        console.log(`📊 Audio cache settings: TTL=${settings.audio_cache_ttl_days}d, Size=${settings.audio_cache_max_size_gb}GB, Entries=${settings.audio_cache_max_entries}`);
        this.settingsLoaded = true;
      }
    } catch (error) {
      console.warn('Failed to load audio cache settings, using defaults:', error);
    }
  }

  /**
   * 初始化資料庫
   * 注意：不指定版本，讓 IndexedDB 自動使用現有版本或創建版本 1
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    // 載入快取設定
    if (!this.settingsLoaded) {
      await this.loadSettings();
    }

    this.initPromise = new Promise((resolve, reject) => {
      // 不指定版本號，使用現有版本
      const request = indexedDB.open(this.dbName);

      request.onerror = () => {
        console.error('❌ Failed to open IndexedDB:', request.error);
        this.initPromise = null;
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;

        // 檢查 store 是否存在
        if (!this.db.objectStoreNames.contains(this.storeName)) {
          // 需要創建 store，關閉連接並重新以更高版本打開
          const currentVersion = this.db.version;
          this.db.close();
          this.db = null;
          this.upgradeDatabase(currentVersion + 1).then(resolve).catch(reject);
        } else {
          console.log(`✅ AudioCache IndexedDB initialized (version ${this.db.version}, ${this.storeName} exists)`);
          resolve();
        }
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStoreIfNeeded(db);
      };

      request.onblocked = () => {
        console.warn('⚠️ IndexedDB upgrade blocked - close other tabs');
      };
    });

    return this.initPromise;
  }

  /**
   * 升級資料庫版本以創建 store
   */
  private async upgradeDatabase(newVersion: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, newVersion);

      request.onerror = () => {
        console.error('❌ Failed to upgrade IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log(`✅ AudioCache IndexedDB upgraded to version ${this.db.version}`);
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStoreIfNeeded(db);
      };

      request.onblocked = () => {
        console.warn('⚠️ IndexedDB upgrade blocked - close other tabs');
      };
    });
  }

  /**
   * 創建 object store（如果不存在）
   */
  private createStoreIfNeeded(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(this.storeName)) {
      const objectStore = db.createObjectStore(this.storeName, { keyPath: 'videoId' });
      objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      console.log('✅ Created audioCache object store');
    }
  }

  /**
   * 從快取獲取音訊
   */
  async get(videoId: string): Promise<Blob | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(videoId);

      request.onsuccess = () => {
        const cached = request.result as CachedAudio | undefined;

        if (!cached) {
          resolve(null);
          return;
        }

        // 檢查是否過期
        const age = Date.now() - cached.timestamp;
        if (age > this.CACHE_TTL) {
          console.log(`⏰ Cache expired for ${videoId} (age: ${Math.floor(age / 1000 / 60 / 60)}h)`);
          this.delete(videoId); // 異步刪除
          resolve(null);
          return;
        }

        const ageMinutes = Math.floor(age / 1000 / 60);
        const sizeMB = (cached.size / 1024 / 1024).toFixed(2);
        console.log(`✅ Cache hit: ${videoId} (age: ${ageMinutes}min, size: ${sizeMB}MB)`);
        resolve(cached.blob);
      };

      request.onerror = () => {
        console.error('Failed to get from cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 取得快取的 metadata（不讀 Blob，速度快）
   */
  async getMetadata(videoId: string): Promise<CachedAudioMetadata | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(videoId);

      request.onsuccess = () => {
        const cached = request.result as CachedAudio | undefined;
        resolve(cached?.metadata || null);
      };

      request.onerror = () => resolve(null);
    });
  }

  /**
   * 儲存音訊到快取
   */
  async set(videoId: string, blob: Blob, metadata?: CachedAudioMetadata): Promise<void> {
    await this.init();
    if (!this.db) return;

    const cached: CachedAudio = {
      videoId,
      blob,
      timestamp: Date.now(),
      size: blob.size,
      metadata,
    };

    // 檢查快取大小限制
    await this.enforceLimit(blob.size);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(cached);

      request.onsuccess = () => {
        const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
        console.log(`💾 Cached audio: ${videoId} (size: ${sizeMB}MB)`);
        // 發送自定義事件通知快取狀態變更
        window.dispatchEvent(new CustomEvent('audio-cache-updated', { detail: { videoId } }));
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to cache audio:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 刪除快取
   */
  async delete(videoId: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(videoId);

      request.onsuccess = () => {
        console.log(`🗑️ Deleted cache: ${videoId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to delete cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 獲取所有快取項目
   */
  async getAll(): Promise<CachedAudio[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result as CachedAudio[]);
      };

      request.onerror = () => {
        console.error('Failed to get all cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 獲取總快取大小
   */
  async getTotalSize(): Promise<number> {
    const all = await this.getAll();
    return all.reduce((total, item) => total + item.size, 0);
  }

  /**
   * 強制執行快取限制（數量和大小）
   * 如果超過限制，刪除最舊的項目
   */
  private async enforceLimit(newSize: number): Promise<void> {
    const all = await this.getAll();
    const totalSize = all.reduce((total, item) => total + item.size, 0);
    const entryCount = all.length;

    // 檢查是否需要清理（數量超過 200 或空間超過 2GB）
    const needsSizeCleanup = totalSize + newSize > this.MAX_CACHE_SIZE;
    const needsCountCleanup = entryCount >= this.MAX_ENTRIES;

    if (!needsSizeCleanup && !needsCountCleanup) {
      return;
    }

    console.log(`⚠️ Cache limit exceeded (${entryCount} entries, ${(totalSize / 1024 / 1024).toFixed(2)}MB), cleaning old entries...`);

    // 按時間排序（最舊的在前）
    all.sort((a, b) => a.timestamp - b.timestamp);

    let freedSize = 0;
    let deletedCount = 0;

    // 刪除最舊的項目直到符合限制
    for (const item of all) {
      // 計算刪除後的狀態
      const remainingCount = entryCount - deletedCount - 1;
      const remainingSize = totalSize - freedSize - item.size;

      // 檢查是否已經符合限制
      const sizeOk = remainingSize + newSize <= this.MAX_CACHE_SIZE;
      const countOk = remainingCount < this.MAX_ENTRIES;

      if (sizeOk && countOk) {
        break;
      }

      await this.delete(item.videoId);
      freedSize += item.size;
      deletedCount++;
    }

    const freedMB = (freedSize / 1024 / 1024).toFixed(2);
    console.log(`✅ Freed ${freedMB}MB by removing ${deletedCount} old entries`);
  }

  /**
   * 清空所有快取
   */
  async clear(): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('🗑️ Cleared all audio cache');
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to clear cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 檢查音訊是否已快取（不載入 blob）
   */
  async has(videoId: string): Promise<boolean> {
    await this.init();
    if (!this.db) return false;

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getKey(videoId);

      request.onsuccess = () => {
        resolve(request.result !== undefined);
      };

      request.onerror = () => {
        resolve(false);
      };
    });
  }

  /**
   * 批量檢查多個影片的快取狀態
   */
  async hasMany(videoIds: string[]): Promise<Map<string, boolean>> {
    await this.init();
    const result = new Map<string, boolean>();

    if (!this.db) {
      videoIds.forEach(id => result.set(id, false));
      return result;
    }

    const transaction = this.db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    const promises = videoIds.map(videoId => {
      return new Promise<void>((resolve) => {
        const request = store.getKey(videoId);
        request.onsuccess = () => {
          result.set(videoId, request.result !== undefined);
          resolve();
        };
        request.onerror = () => {
          result.set(videoId, false);
          resolve();
        };
      });
    });

    await Promise.all(promises);
    return result;
  }

  /**
   * 獲取快取統計資訊
   */
  async getStats(): Promise<{
    count: number;
    maxCount: number;
    totalSize: number;
    totalSizeMB: string;
    maxSizeMB: string;
  }> {
    const all = await this.getAll();
    const totalSize = all.reduce((total, item) => total + item.size, 0);

    return {
      count: all.length,
      maxCount: this.MAX_ENTRIES,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
      maxSizeMB: (this.MAX_CACHE_SIZE / 1024 / 1024).toFixed(0),
    };
  }

  /**
   * 下載並快取音訊
   * @param videoId 影片 ID
   * @param streamUrl 串流 URL (server side URL)
   * @param metadata 曲目資訊（標題、頻道等）
   * @returns 返回伺服器 stream URL（支持 Range request）
   * 
   * 注意：我們不再返回 Blob URL，因為瀏覽器 audio 元素的 Range 請求
   * 在 Blob URL 上不支持。改用伺服器端快取優先策略。
   */
  /**
   * 取消正在進行的預載下載（讓 audio element 可以立即串流）
   */
  abortDownload(videoId: string): void {
    const controller = this.inFlightControllers.get(videoId);
    if (controller) {
      console.log(`🚫 Aborting preload download for ${videoId} (immediate playback requested)`);
      controller.abort();
      this.inFlightControllers.delete(videoId);
      this.inFlightDownloads.delete(videoId);
    }
  }

  async fetchAndCache(videoId: string, streamUrl: string, metadata?: CachedAudioMetadata): Promise<string> {
    if (this.inFlightDownloads.has(videoId)) {
      return this.inFlightDownloads.get(videoId)!;
    }

    const controller = new AbortController();
    this.inFlightControllers.set(videoId, controller);

    const downloadPromise = (async () => {
      try {
        console.log(`⏬ Downloading audio: ${videoId}`);
        const startTime = Date.now();

        // 下載完整音訊到後端並快取
        const response = await fetch(streamUrl, {
          redirect: 'follow',
          mode: 'cors',
          credentials: 'omit',
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const blob = await response.blob();
        const downloadTime = ((Date.now() - startTime) / 1000).toFixed(2);
        const sizeMB = (blob.size / 1024 / 1024).toFixed(2);

        console.log(`✅ Downloaded: ${videoId} (${sizeMB}MB in ${downloadTime}s)`);

        // 檢查是否下載到有效資料
        if (blob.size === 0) {
          throw new Error(`Downloaded empty audio for ${videoId}`);
        }

        // 儲存到 IndexedDB 快取（非同步，用於離線/快速重播）
        this.set(videoId, blob, metadata).catch(err => {
          console.error(`Failed to cache in IndexedDB ${videoId}:`, err);
        });

        // 返回伺服器 stream URL（支持 Range request）而不是 Blob URL
        // 伺服器端快取會在下次請求時自動使用
        return streamUrl;
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log(`⏹️ Download aborted for ${videoId}`);
        } else {
          console.error(`Failed to fetch audio for ${videoId}:`, error);
        }
        throw error;
      } finally {
        this.inFlightDownloads.delete(videoId);
        this.inFlightControllers.delete(videoId);
      }
    })();

    this.inFlightDownloads.set(videoId, downloadPromise);
    return downloadPromise;
  }

  /**
   * 預加載音訊（背景下載並快取）
   */
  async preload(videoId: string, streamUrl: string, metadata?: CachedAudioMetadata): Promise<void> {
    if (!this.PRELOAD_ENABLED) return;

    try {
      // 檢查是否已經快取
      const cached = await this.get(videoId);
      if (cached) {
        console.log(`⏭️ Already cached: ${videoId}`);
        return;
      }

      console.log(`🔄 Preloading: ${videoId}`);
      await this.fetchAndCache(videoId, streamUrl, metadata);
    } catch (error) {
      // 預載失敗不影響主流程
      console.warn(`Preload failed for ${videoId}:`, error);
    }
  }

  /**
   * 獲取快取列表（含 metadata，供 UI 顯示）
   */
  async getCacheList(): Promise<CacheListItem[]> {
    const all = await this.getAll();
    return all.map(item => ({
      videoId: item.videoId,
      title: item.metadata?.title || '未知曲目',
      channel: item.metadata?.channel || '未知頻道',
      thumbnail: item.metadata?.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/default.jpg`,
      size: item.size,
      timestamp: item.timestamp,
      duration: item.metadata?.duration,
    })).sort((a, b) => b.timestamp - a.timestamp); // 最新的在前面
  }
}

export default new AudioCacheService();
