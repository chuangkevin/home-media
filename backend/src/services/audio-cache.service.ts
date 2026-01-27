import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import logger from '../utils/logger';

const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || path.join(process.cwd(), 'data', 'audio-cache');
const MAX_CACHE_SIZE_MB = parseInt(process.env.AUDIO_CACHE_MAX_SIZE_MB || '5000', 10); // 預設 5GB
const CACHE_FILE_EXTENSION = '.webm'; // YouTube 音訊通常是 webm 格式

// 確保快取目錄存在
if (!fs.existsSync(AUDIO_CACHE_DIR)) {
  fs.mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
  logger.info(`📁 Created audio cache directory: ${AUDIO_CACHE_DIR}`);
}

interface CacheEntry {
  videoId: string;
  filePath: string;
  fileSize: number;
  cachedAt: number;
  lastAccessed: number;
}

class AudioCacheService {
  private downloadingMap = new Map<string, Promise<string | null>>(); // 正在下載的任務

  /**
   * 獲取快取檔案路徑
   */
  getCachePath(videoId: string): string {
    return path.join(AUDIO_CACHE_DIR, `${videoId}${CACHE_FILE_EXTENSION}`);
  }

  /**
   * 檢查是否有快取
   */
  has(videoId: string): boolean {
    const cachePath = this.getCachePath(videoId);
    return fs.existsSync(cachePath);
  }

  /**
   * 獲取快取檔案資訊
   */
  getInfo(videoId: string): CacheEntry | null {
    const cachePath = this.getCachePath(videoId);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const stats = fs.statSync(cachePath);
      return {
        videoId,
        filePath: cachePath,
        fileSize: stats.size,
        cachedAt: stats.birthtimeMs,
        lastAccessed: stats.atimeMs,
      };
    } catch (error) {
      logger.error(`Failed to get cache info for ${videoId}:`, error);
      return null;
    }
  }

  /**
   * 建立讀取串流（支援 Range requests）
   */
  createReadStream(videoId: string, range?: { start: number; end?: number }): fs.ReadStream | null {
    const cachePath = this.getCachePath(videoId);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const options: { start?: number; end?: number } = {};
    if (range) {
      options.start = range.start;
      if (range.end !== undefined) {
        options.end = range.end;
      }
    }

    return fs.createReadStream(cachePath, options);
  }

  /**
   * 獲取檔案大小
   */
  getFileSize(videoId: string): number | null {
    const cachePath = this.getCachePath(videoId);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    try {
      const stats = fs.statSync(cachePath);
      return stats.size;
    } catch {
      return null;
    }
  }

  /**
   * 下載並快取音訊（背景執行，不阻塞串流）
   */
  async downloadAndCache(videoId: string, audioUrl: string): Promise<string | null> {
    // 如果已經在下載中，等待該任務完成
    if (this.downloadingMap.has(videoId)) {
      console.log(`⏳ [AudioCache] Already downloading: ${videoId}`);
      return this.downloadingMap.get(videoId)!;
    }

    // 如果已經有快取，直接返回
    if (this.has(videoId)) {
      console.log(`✅ [AudioCache] Already cached: ${videoId}`);
      return this.getCachePath(videoId);
    }

    // 開始下載任務
    const downloadPromise = this.doDownload(videoId, audioUrl);
    this.downloadingMap.set(videoId, downloadPromise);

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.downloadingMap.delete(videoId);
    }
  }

  /**
   * 執行下載
   */
  private async doDownload(videoId: string, audioUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      const cachePath = this.getCachePath(videoId);
      const tempPath = `${cachePath}.tmp`;

      console.log(`⬇️ [AudioCache] Starting download: ${videoId}`);
      logger.info(`Starting audio download for ${videoId}`);

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      };

      const makeRequest = (url: string, redirectCount = 0): void => {
        if (redirectCount > 5) {
          console.error(`❌ [AudioCache] Too many redirects: ${videoId}`);
          resolve(null);
          return;
        }

        const requestUrl = new URL(url);
        const reqModule = requestUrl.protocol === 'https:' ? https : http;

        const req = reqModule.get(url, { headers }, (res) => {
          // 處理重定向
          if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
            const location = res.headers.location;
            if (location) {
              res.resume();
              makeRequest(location, redirectCount + 1);
              return;
            }
          }

          if (res.statusCode !== 200) {
            console.error(`❌ [AudioCache] Download failed (${res.statusCode}): ${videoId}`);
            res.resume();
            resolve(null);
            return;
          }

          const writeStream = fs.createWriteStream(tempPath);

          res.pipe(writeStream);

          writeStream.on('finish', () => {
            // 下載完成，重命名檔案
            try {
              fs.renameSync(tempPath, cachePath);
              const stats = fs.statSync(cachePath);
              console.log(`✅ [AudioCache] Downloaded: ${videoId} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
              logger.info(`Audio cached: ${videoId} (${stats.size} bytes)`);

              // 檢查快取大小，必要時清理
              this.cleanupIfNeeded();

              resolve(cachePath);
            } catch (error) {
              console.error(`❌ [AudioCache] Failed to save: ${videoId}`, error);
              resolve(null);
            }
          });

          writeStream.on('error', (error) => {
            console.error(`❌ [AudioCache] Write error: ${videoId}`, error);
            // 清理臨時檔案
            try {
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
            } catch {}
            resolve(null);
          });
        });

        req.on('error', (error) => {
          console.error(`❌ [AudioCache] Request error: ${videoId}`, error);
          resolve(null);
        });

        req.setTimeout(300000, () => { // 5 分鐘超時
          console.error(`❌ [AudioCache] Download timeout: ${videoId}`);
          req.destroy();
          resolve(null);
        });
      };

      makeRequest(audioUrl);
    });
  }

  /**
   * 清理快取（LRU 策略）
   */
  private cleanupIfNeeded(): void {
    try {
      const files = fs.readdirSync(AUDIO_CACHE_DIR);
      let totalSize = 0;
      const entries: Array<{ path: string; size: number; atime: number }> = [];

      for (const file of files) {
        if (!file.endsWith(CACHE_FILE_EXTENSION)) continue;

        const filePath = path.join(AUDIO_CACHE_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
          entries.push({
            path: filePath,
            size: stats.size,
            atime: stats.atimeMs,
          });
        } catch {}
      }

      const maxSizeBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;

      if (totalSize > maxSizeBytes) {
        console.log(`🧹 [AudioCache] Cache cleanup needed: ${(totalSize / 1024 / 1024).toFixed(2)} MB > ${MAX_CACHE_SIZE_MB} MB`);

        // 按存取時間排序（最舊的先刪除）
        entries.sort((a, b) => a.atime - b.atime);

        let deletedSize = 0;
        const targetSize = maxSizeBytes * 0.8; // 清理到 80%

        for (const entry of entries) {
          if (totalSize - deletedSize <= targetSize) break;

          try {
            fs.unlinkSync(entry.path);
            deletedSize += entry.size;
            console.log(`🗑️ [AudioCache] Deleted: ${path.basename(entry.path)}`);
          } catch (error) {
            logger.error(`Failed to delete cache file: ${entry.path}`, error);
          }
        }

        console.log(`✅ [AudioCache] Cleanup done, freed ${(deletedSize / 1024 / 1024).toFixed(2)} MB`);
      }
    } catch (error) {
      logger.error('Cache cleanup error:', error);
    }
  }

  /**
   * 刪除特定快取
   */
  delete(videoId: string): boolean {
    const cachePath = this.getCachePath(videoId);
    if (fs.existsSync(cachePath)) {
      try {
        fs.unlinkSync(cachePath);
        return true;
      } catch (error) {
        logger.error(`Failed to delete cache for ${videoId}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * 獲取快取統計
   */
  getStats(): { totalFiles: number; totalSizeMB: number; maxSizeMB: number } {
    try {
      const files = fs.readdirSync(AUDIO_CACHE_DIR);
      let totalSize = 0;
      let totalFiles = 0;

      for (const file of files) {
        if (!file.endsWith(CACHE_FILE_EXTENSION)) continue;

        const filePath = path.join(AUDIO_CACHE_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
          totalFiles++;
        } catch {}
      }

      return {
        totalFiles,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        maxSizeMB: MAX_CACHE_SIZE_MB,
      };
    } catch {
      return { totalFiles: 0, totalSizeMB: 0, maxSizeMB: MAX_CACHE_SIZE_MB };
    }
  }
}

export default new AudioCacheService();
