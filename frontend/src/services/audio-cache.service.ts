/**
 * 音訊快取服務
 * 使用 IndexedDB 儲存音訊 blob，實現離線播放和快速重播
 */

interface CachedAudio {
  videoId: string;
  blob: Blob;
  timestamp: number;
  size: number;
}

class AudioCacheService {
  private dbName = 'AudioCacheDB';
  private storeName = 'audioCache';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  // 快取設置
  private readonly MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB 最大快取
  private readonly CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天快取期限
  private readonly PRELOAD_ENABLED = true;

  /**
   * 初始化資料庫
   */
  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ AudioCache IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 創建 object store
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'videoId' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('✅ Created audioCache object store');
        }
      };
    });
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
   * 儲存音訊到快取
   */
  async set(videoId: string, blob: Blob): Promise<void> {
    await this.init();
    if (!this.db) return;

    const cached: CachedAudio = {
      videoId,
      blob,
      timestamp: Date.now(),
      size: blob.size,
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
   * 強制執行快取大小限制
   * 如果超過限制，刪除最舊的項目
   */
  private async enforceLimit(newSize: number): Promise<void> {
    const totalSize = await this.getTotalSize();

    if (totalSize + newSize <= this.MAX_CACHE_SIZE) {
      return;
    }

    console.log(`⚠️ Cache size limit exceeded, cleaning old entries...`);

    // 獲取所有項目，按時間排序
    const all = await this.getAll();
    all.sort((a, b) => a.timestamp - b.timestamp);

    let freedSize = 0;
    let i = 0;

    // 刪除最舊的項目直到有足夠空間
    while (freedSize < newSize && i < all.length) {
      await this.delete(all[i].videoId);
      freedSize += all[i].size;
      i++;
    }

    const freedMB = (freedSize / 1024 / 1024).toFixed(2);
    console.log(`✅ Freed ${freedMB}MB by removing ${i} old entries`);
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
   * 獲取快取統計資訊
   */
  async getStats(): Promise<{ count: number; totalSize: number; totalSizeMB: string }> {
    const all = await this.getAll();
    const totalSize = all.reduce((total, item) => total + item.size, 0);

    return {
      count: all.length,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
    };
  }

  /**
   * 下載並快取音訊
   * @param videoId 影片 ID
   * @param streamUrl 串流 URL
   * @returns Blob URL 供 audio 元素使用
   */
  async fetchAndCache(videoId: string, streamUrl: string): Promise<string> {
    try {
      // 先檢查快取
      const cached = await this.get(videoId);
      if (cached) {
        return URL.createObjectURL(cached);
      }

      console.log(`⏬ Downloading audio: ${videoId}`);
      const startTime = Date.now();

      // 下載音訊（禁用自動重定向，使用代理模式）
      const response = await fetch(streamUrl, {
        redirect: 'follow', // 跟隨重定向
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      const downloadTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);

      console.log(`✅ Downloaded: ${videoId} (${sizeMB}MB in ${downloadTime}s)`);

      // 儲存到快取（異步，不阻塞播放）
      this.set(videoId, blob).catch(err => {
        console.error(`Failed to cache ${videoId}:`, err);
      });

      // 返回 blob URL
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error(`Failed to fetch audio for ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * 預加載音訊（背景下載並快取）
   */
  async preload(videoId: string, streamUrl: string): Promise<void> {
    if (!this.PRELOAD_ENABLED) return;

    try {
      // 檢查是否已經快取
      const cached = await this.get(videoId);
      if (cached) {
        console.log(`⏭️ Already cached: ${videoId}`);
        return;
      }

      console.log(`🔄 Preloading: ${videoId}`);
      await this.fetchAndCache(videoId, streamUrl);
    } catch (error) {
      // 預載失敗不影響主流程
      console.warn(`Preload failed for ${videoId}:`, error);
    }
  }
}

export default new AudioCacheService();
