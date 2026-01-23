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

class LyricsCacheService {
  private dbName = 'LyricsCacheDB';
  private storeName = 'lyricsCache';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  // 快取設置
  private readonly CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天快取期限
  private readonly MAX_ENTRIES = 500; // 最多儲存 500 首歌的歌詞

  /**
   * 初始化資料庫
   */
  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('Failed to open LyricsCache IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ LyricsCache IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'videoId' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('✅ Created lyricsCache object store');
        }
      };
    });
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

        // 檢查是否過期
        const age = Date.now() - cached.timestamp;
        if (age > this.CACHE_TTL) {
          console.log(`⏰ Lyrics cache expired for ${videoId}`);
          this.delete(videoId);
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

    // 檢查數量限制
    await this.enforceLimit();

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
   * 強制執行數量限制
   * 如果超過限制，刪除最舊的項目
   */
  private async enforceLimit(): Promise<void> {
    const all = await this.getAll();

    if (all.length < this.MAX_ENTRIES) {
      return;
    }

    console.log(`⚠️ Lyrics cache limit reached, cleaning old entries...`);

    // 按時間排序
    all.sort((a, b) => a.timestamp - b.timestamp);

    // 刪除最舊的 10%
    const toDelete = Math.floor(all.length * 0.1);
    for (let i = 0; i < toDelete; i++) {
      await this.delete(all[i].videoId);
    }

    console.log(`✅ Removed ${toDelete} old lyrics entries`);
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
}

export default new LyricsCacheService();
