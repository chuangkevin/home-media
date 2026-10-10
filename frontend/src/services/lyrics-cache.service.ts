/**
 * 歌詞快取服務
 * 使用 IndexedDB 儲存歌詞，避免重複請求後端
 */

import type { Lyrics } from '../types/lyrics.types';

interface CachedLyrics {
  videoId: string;
  lyrics: Lyrics;
  timestamp: number;
}

// 使用者的歌詞偏好設定（永久儲存）
interface LyricsPreference {
  videoId: string;
  lrclibId?: number; // 使用者選擇的 LRCLIB 歌詞 ID
  neteaseId?: number; // 使用者選擇的 NetEase 歌詞 ID
  timeOffset?: number; // 時間偏移（秒）
  updatedAt: number;
}

class LyricsCacheService {
  private dbName = 'LyricsCacheDB';
  private storeName = 'lyricsCache';
  private prefsStoreName = 'lyricsPrefs'; // 使用者偏好設定
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  // 歌詞永久保存；timestamp 僅作紀錄，不作 TTL 或自動淘汰依據。

  /**
   * 初始化資料庫
   * 注意：不指定版本，讓 IndexedDB 自動使用現有版本或創建版本 1
   */
  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      // 不指定版本號，使用現有版本
      const request = indexedDB.open(this.dbName);

      request.onerror = () => {
        console.error('❌ Failed to open LyricsCache IndexedDB:', request.error);
        this.initPromise = null;
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;

        // 檢查兩個 store 是否都存在
        const hasCache = this.db.objectStoreNames.contains(this.storeName);
        const hasPrefs = this.db.objectStoreNames.contains(this.prefsStoreName);

        if (!hasCache || !hasPrefs) {
          // 需要創建 store，關閉連接並重新以更高版本打開
          const currentVersion = this.db.version;
          this.db.close();
          this.db = null;
          this.upgradeDatabase(currentVersion + 1).then(resolve).catch(reject);
        } else {
          console.log(`✅ LyricsCache IndexedDB initialized (version ${this.db.version})`);
          resolve();
        }
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStoresIfNeeded(db);
      };

      request.onblocked = () => {
        console.warn('⚠️ LyricsCache IndexedDB upgrade blocked - close other tabs');
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
        console.error('❌ Failed to upgrade LyricsCache IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log(`✅ LyricsCache IndexedDB upgraded to version ${this.db.version}`);
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStoresIfNeeded(db);
      };

      request.onblocked = () => {
        console.warn('⚠️ LyricsCache IndexedDB upgrade blocked - close other tabs');
      };
    });
  }

  /**
   * 創建 object stores（如果不存在）
   */
  private createStoresIfNeeded(db: IDBDatabase): void {
    if (!db.objectStoreNames.contains(this.storeName)) {
      const objectStore = db.createObjectStore(this.storeName, { keyPath: 'videoId' });
      objectStore.createIndex('timestamp', 'timestamp', { unique: false });
      console.log('✅ Created lyricsCache object store');
    }

    if (!db.objectStoreNames.contains(this.prefsStoreName)) {
      db.createObjectStore(this.prefsStoreName, { keyPath: 'videoId' });
      console.log('✅ Created lyricsPrefs object store');
    }
  }

  /**
   * 從快取獲取歌詞
   */
  async get(videoId: string): Promise<Lyrics | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(videoId);

      request.onsuccess = () => {
        const cached = request.result as CachedLyrics | undefined;

        if (!cached) {
          resolve(null);
          return;
        }

        console.log(`✅ Lyrics cache hit: ${videoId} (source: ${cached.lyrics.source})`);
        resolve(cached.lyrics);
      };

      request.onerror = () => {
        console.error('Failed to get from lyrics cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 儲存歌詞到快取
   */
  async set(videoId: string, lyrics: Lyrics): Promise<void> {
    await this.init();
    if (!this.db) return;

    const cached: CachedLyrics = {
      videoId,
      lyrics,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(cached);

      request.onsuccess = () => {
        console.log(`💾 Cached lyrics: ${videoId} (${lyrics.lines.length} lines, source: ${lyrics.source})`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to cache lyrics:', request.error);
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
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to delete lyrics cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 獲取所有快取項目
   */
  async getAll(): Promise<CachedLyrics[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result as CachedLyrics[]);
      };

      request.onerror = () => {
        console.error('Failed to get all lyrics cache:', request.error);
        reject(request.error);
      };
    });
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
        console.log('🗑️ Cleared all lyrics cache');
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to clear lyrics cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 獲取快取統計資訊
   */
  async getStats(): Promise<{ count: number }> {
    const all = await this.getAll();
    return {
      count: all.length,
    };
  }

  /**
   * 檢查歌詞是否已快取（不載入完整資料）
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
   * 批量檢查多個影片的歌詞快取狀態
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

  // ==================== 使用者偏好設定 ====================

  /**
   * 獲取使用者的歌詞偏好
   */
  async getPreference(videoId: string): Promise<LyricsPreference | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.prefsStoreName], 'readonly');
      const store = transaction.objectStore(this.prefsStoreName);
      const request = store.get(videoId);

      request.onsuccess = () => {
        const pref = request.result as LyricsPreference | undefined;
        if (pref) {
          console.log(`✅ Loaded lyrics preference for ${videoId}: lrclibId=${pref.lrclibId}, neteaseId=${pref.neteaseId}, offset=${pref.timeOffset}`);
        }
        resolve(pref || null);
      };

      request.onerror = () => {
        console.error('Failed to get lyrics preference:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 儲存使用者選擇的 LRCLIB ID
   */
  async setLrclibId(videoId: string, lrclibId: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    const existing = await this.getPreference(videoId);
    const pref: LyricsPreference = {
      videoId,
      lrclibId,
      timeOffset: existing?.timeOffset,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.prefsStoreName], 'readwrite');
      const store = transaction.objectStore(this.prefsStoreName);
      const request = store.put(pref);

      request.onsuccess = () => {
        console.log(`💾 Saved lrclibId ${lrclibId} for ${videoId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to save lrclibId:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 儲存使用者選擇的 NetEase ID
   */
  async setNeteaseId(videoId: string, neteaseId: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    const existing = await this.getPreference(videoId);
    const pref: LyricsPreference = {
      videoId,
      neteaseId,
      timeOffset: existing?.timeOffset,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.prefsStoreName], 'readwrite');
      const store = transaction.objectStore(this.prefsStoreName);
      const request = store.put(pref);

      request.onsuccess = () => {
        console.log(`💾 Saved neteaseId ${neteaseId} for ${videoId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to save neteaseId:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 儲存時間偏移值
   */
  async setTimeOffset(videoId: string, timeOffset: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    const existing = await this.getPreference(videoId);
    const pref: LyricsPreference = {
      videoId,
      lrclibId: existing?.lrclibId,
      timeOffset,
      updatedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.prefsStoreName], 'readwrite');
      const store = transaction.objectStore(this.prefsStoreName);
      const request = store.put(pref);

      request.onsuccess = () => {
        console.log(`💾 Saved timeOffset ${timeOffset}s for ${videoId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to save timeOffset:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * 清除特定影片的偏好設定
   */
  async clearPreference(videoId: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.prefsStoreName], 'readwrite');
      const store = transaction.objectStore(this.prefsStoreName);
      const request = store.delete(videoId);

      request.onsuccess = () => {
        console.log(`🗑️ Cleared preference for ${videoId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to clear preference:', request.error);
        reject(request.error);
      };
    });
  }
}

export default new LyricsCacheService();
