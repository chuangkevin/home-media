import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { spawn, execFile } from 'child_process';
import { createAudioCacheWriter } from './audio-cache-writer';
import { promisify } from 'util';
import { URL } from 'url';
import logger from '../utils/logger';
import youtubeService from './youtube.service';

const execFileAsync = promisify(execFile);
// Resolve lazily and asynchronously; even the first remux leaves HTTP/Socket.IO responsive.
let ffmpegPath: Promise<string | null> | undefined;
function getFfmpegPath(): Promise<string | null> {
  if (!ffmpegPath) {
    ffmpegPath = execFileAsync('ffmpeg', ['-version'], { timeout: 5000, killSignal: 'SIGKILL' })
      .then(() => 'ffmpeg')
      .catch(() => {
        try { return require('ffmpeg-static') as string | null; } catch { return null; }
      });
  }
  return ffmpegPath;
}

const AUDIO_CACHE_DIR = process.env.AUDIO_CACHE_DIR || path.join(process.cwd(), 'data', 'audio-cache');
const MAX_CACHE_SIZE_MB = parseInt(process.env.AUDIO_CACHE_MAX_SIZE_MB || '10000', 10); // 預設 10GB
const CACHE_FILE_EXTENSION = '.m4a'; // yt-dlp 優先下載 m4a 格式（Safari/iOS 相容）
const LEGACY_CACHE_EXTENSION = '.webm'; // 舊版快取副檔名，保持向下相容
const AUDIO_EXTENSIONS = [CACHE_FILE_EXTENSION, LEGACY_CACHE_EXTENSION];

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

// 下載進度追蹤
interface DownloadProgress {
  videoId: string;
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number;
  status: 'downloading' | 'completed' | 'failed';
  startedAt: number;
}

const MAX_CONCURRENT_DOWNLOADS = 3; // 最大同時下載數量

class AudioCacheService {
  private downloadingMap = new Map<string, Promise<string | null>>(); // 正在下載的任務
  private downloadProgressMap = new Map<string, DownloadProgress>(); // 下載進度追蹤
  private downloadQueue: Array<{ videoId: string; audioUrl: string; resolve: (value: string | null) => void }> = []; // 等待下載的佇列
  private activeDownloads = 0; // 當前正在下載的數量

  /**
   * 修正 DASH m4a 容器為標準 m4a（Safari/iOS 相容）
   * yt-dlp 用 -o - 管道輸出時不會執行 FixupM4a，需手動 remux
   */
  async remuxIfNeeded(filePath: string, signal?: AbortSignal): Promise<void> {
    const handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(12);
    try {
      const { bytesRead } = await handle.read(buf, 0, 12, 0);
      if (bytesRead < 12) throw new Error('Incomplete audio cache header');
    } finally {
      await handle.close();
    }
    if (buf.toString('ascii', 8, 12) !== 'dash') return;
    const executable = await getFfmpegPath();
    if (!executable) throw new Error('ffmpeg unavailable for DASH audio');
    const tmpOut = `${filePath}.remux.tmp`;
    const startedAt = Date.now();
    logger.info(`[Remux] Started: ${path.basename(filePath)}`);
    try {
      await execFileAsync(executable, [
        '-i', filePath, '-c', 'copy', '-movflags', '+faststart',
        '-f', 'mp4', '-y', tmpOut,
      ], { timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, signal });
      if (signal?.aborted) throw new Error('Remux cancelled');
      const stats = await fs.promises.stat(tmpOut);
      if (stats.size < 12) throw new Error('Empty remux output');
      await fs.promises.rename(tmpOut, filePath);
      logger.info(`[Remux] Completed in ${Date.now() - startedAt}ms: ${path.basename(filePath)}`);
    } catch (error) {
      logger.warn(`[Remux] Failed after ${Date.now() - startedAt}ms: ${path.basename(filePath)}`);
      throw error;
    } finally {
      await fs.promises.unlink(tmpOut).catch(() => {});
    }
  }

  /**
   * 獲取快取檔案路徑（優先新格式 .m4a，向下相容舊 .webm）
   */
  getCacheDir(): string {
    return AUDIO_CACHE_DIR;
  }

  getCachePath(videoId: string): string {
    const newPath = path.join(AUDIO_CACHE_DIR, `${videoId}${CACHE_FILE_EXTENSION}`);
    if (fs.existsSync(newPath)) return newPath;
    // 向下相容舊的 .webm 快取
    const legacyPath = path.join(AUDIO_CACHE_DIR, `${videoId}.webm`);
    if (fs.existsSync(legacyPath)) return legacyPath;
    return newPath; // 新檔案用新副檔名
  }

  /**
   * 檢查是否有快取
   */
  has(videoId: string): boolean {
    const newPath = path.join(AUDIO_CACHE_DIR, `${videoId}${CACHE_FILE_EXTENSION}`);
    if (fs.existsSync(newPath)) return true;
    // 向下相容舊的 .webm 快取
    const legacyPath = path.join(AUDIO_CACHE_DIR, `${videoId}.webm`);
    return fs.existsSync(legacyPath);
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
   * 使用佇列限制同時下載數量
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

    // 建立 Promise 並加入佇列
    const downloadPromise = new Promise<string | null>((resolve) => {
      this.downloadQueue.push({ videoId, audioUrl, resolve });
    });

    this.downloadingMap.set(videoId, downloadPromise);

    // 嘗試處理佇列
    this.processQueue();

    try {
      const result = await downloadPromise;
      return result;
    } finally {
      this.downloadingMap.delete(videoId);
    }
  }

  /**
   * 處理下載佇列
   */
  private processQueue(): void {
    while (this.activeDownloads < MAX_CONCURRENT_DOWNLOADS && this.downloadQueue.length > 0) {
      const task = this.downloadQueue.shift();
      if (!task) break;

      this.activeDownloads++;
      console.log(`📥 [AudioCache] Starting download (${this.activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}): ${task.videoId}`);

      this.doDownload(task.videoId, task.audioUrl)
        .then((result) => {
          task.resolve(result);
        })
        .catch(() => {
          task.resolve(null);
        })
        .finally(() => {
          this.activeDownloads--;
          console.log(`📤 [AudioCache] Download slot freed (${this.activeDownloads}/${MAX_CONCURRENT_DOWNLOADS})`);
          // 繼續處理佇列中的下一個
          this.processQueue();
        });
    }

    if (this.downloadQueue.length > 0) {
      console.log(`⏳ [AudioCache] ${this.downloadQueue.length} downloads waiting in queue`);
    }
  }

  /**
   * 執行下載（支援重試，失敗時重新取得 URL）
   */
  private async doDownload(videoId: string, audioUrl: string): Promise<string | null> {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 3000, 5000]; // 1秒, 3秒, 5秒
    let currentUrl = audioUrl;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAYS[attempt - 1] || 5000;
        console.log(`🔄 [AudioCache] Retry ${attempt}/${MAX_RETRIES} for ${videoId} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));

        // 第二次重試時，清除 URL 快取並重新取得
        if (attempt >= 2) {
          console.log(`🔄 [AudioCache] Clearing URL cache and getting fresh URL for ${videoId}...`);
          youtubeService.clearUrlCache(videoId);
          try {
            currentUrl = await youtubeService.getAudioStreamUrl(videoId);
            console.log(`✅ [AudioCache] Got fresh URL for ${videoId}`);
          } catch (err) {
            console.error(`❌ [AudioCache] Failed to get fresh URL for ${videoId}:`, err);
          }
        }
      }

      const result = await this.doDownloadAttempt(videoId, currentUrl);
      if (result !== null) {
        return result;
      }

      // 檢查是否為可重試的錯誤
      const progress = this.downloadProgressMap.get(videoId);
      if (progress && progress.status === 'failed') {
        // 重置狀態以便重試
        this.downloadProgressMap.set(videoId, {
          videoId,
          downloadedBytes: 0,
          totalBytes: null,
          percentage: 0,
          status: 'downloading',
          startedAt: Date.now(),
        });
      }
    }

    console.error(`❌ [AudioCache] All ${MAX_RETRIES} retries failed for: ${videoId}`);
    // 清除 URL 快取，下次會重新取得
    youtubeService.clearUrlCache(videoId);
    this.downloadProgressMap.set(videoId, {
      ...this.downloadProgressMap.get(videoId)!,
      status: 'failed',
    });
    setTimeout(() => this.downloadProgressMap.delete(videoId), 30000);
    return null;
  }

  /**
   * 單次下載嘗試
   */
  private async doDownloadAttempt(videoId: string, audioUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
      const cachePath = this.getCachePath(videoId);
      const tempPath = `${cachePath}.tmp`;

      console.log(`⬇️ [AudioCache] Starting download: ${videoId}`);
      logger.info(`Starting audio download for ${videoId}`);

      // 初始化下載進度
      this.downloadProgressMap.set(videoId, {
        videoId,
        downloadedBytes: 0,
        totalBytes: null,
        percentage: 0,
        status: 'downloading',
        startedAt: Date.now(),
      });

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
          this.downloadProgressMap.set(videoId, {
            ...this.downloadProgressMap.get(videoId)!,
            status: 'failed',
          });
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
            this.downloadProgressMap.set(videoId, {
              ...this.downloadProgressMap.get(videoId)!,
              status: 'failed',
            });
            resolve(null);
            return;
          }

          // 獲取總大小
          const contentLength = res.headers['content-length'];
          const totalBytes = contentLength ? parseInt(contentLength, 10) : null;
          let downloadedBytes = 0;

          // 更新總大小
          this.downloadProgressMap.set(videoId, {
            ...this.downloadProgressMap.get(videoId)!,
            totalBytes,
          });

          const writeStream = fs.createWriteStream(tempPath);

          // 追蹤下載進度
          res.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            const percentage = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : 0;

            this.downloadProgressMap.set(videoId, {
              ...this.downloadProgressMap.get(videoId)!,
              downloadedBytes,
              percentage,
            });
          });

          res.pipe(writeStream);

          writeStream.on('finish', () => {
            // 下載完成，重命名檔案
            try {
              fs.renameSync(tempPath, cachePath);
              const stats = fs.statSync(cachePath);
              console.log(`✅ [AudioCache] Downloaded: ${videoId} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
              logger.info(`Audio cached: ${videoId} (${stats.size} bytes)`);

              // 更新進度為完成
              this.downloadProgressMap.set(videoId, {
                ...this.downloadProgressMap.get(videoId)!,
                downloadedBytes: stats.size,
                totalBytes: stats.size,
                percentage: 100,
                status: 'completed',
              });

              // 30 秒後清除進度記錄
              setTimeout(() => this.downloadProgressMap.delete(videoId), 30000);

              // 檢查快取大小，必要時清理
              this.cleanupIfNeeded();

              resolve(cachePath);
            } catch (error) {
              console.error(`❌ [AudioCache] Failed to save: ${videoId}`, error);
              this.downloadProgressMap.set(videoId, {
                ...this.downloadProgressMap.get(videoId)!,
                status: 'failed',
              });
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
            this.downloadProgressMap.set(videoId, {
              ...this.downloadProgressMap.get(videoId)!,
              status: 'failed',
            });
            resolve(null);
          });
        });

        req.on('error', (error: NodeJS.ErrnoException) => {
          console.error(`❌ [AudioCache] Request error (${error.code || 'unknown'}): ${videoId}`, error.message);

          this.downloadProgressMap.set(videoId, {
            ...this.downloadProgressMap.get(videoId)!,
            status: 'failed',
          });

          // 清理臨時檔案
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch {}

          resolve(null); // 返回 null 以便重試邏輯判斷
        });

        req.setTimeout(300000, () => { // 5 分鐘超時
          console.error(`❌ [AudioCache] Download timeout: ${videoId}`);
          req.destroy();
          this.downloadProgressMap.set(videoId, {
            ...this.downloadProgressMap.get(videoId)!,
            status: 'failed',
          });

          // 清理臨時檔案
          try {
            if (fs.existsSync(tempPath)) {
              fs.unlinkSync(tempPath);
            }
          } catch {}

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
        if (!AUDIO_EXTENSIONS.some(ext => file.endsWith(ext))) continue;

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
   * 清空所有快取
   */
  clearAll(): { deletedCount: number; deletedSizeMB: number } {
    try {
      const files = fs.readdirSync(AUDIO_CACHE_DIR);
      let deletedCount = 0;
      let deletedSize = 0;

      for (const file of files) {
        if (!AUDIO_EXTENSIONS.some(ext => file.endsWith(ext))) continue;
        
        const filePath = path.join(AUDIO_CACHE_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          fs.unlinkSync(filePath);
          deletedCount++;
          deletedSize += stats.size;
          console.log(`🗑️ [AudioCache] Deleted: ${file}`);
        } catch (error) {
          logger.error(`Failed to delete cache file: ${filePath}`, error);
        }
      }

      const deletedSizeMB = parseFloat((deletedSize / 1024 / 1024).toFixed(2));
      console.log(`✅ [AudioCache] Clear all done, deleted ${deletedCount} files (${deletedSizeMB} MB)`);
      return { deletedCount, deletedSizeMB };
    } catch (error) {
      logger.error('Failed to clear all cache:', error);
      return { deletedCount: 0, deletedSizeMB: 0 };
    }
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
        if (!AUDIO_EXTENSIONS.some(ext => file.endsWith(ext))) continue;

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

  /**
   * 獲取下載進度
   */
  getDownloadProgress(videoId: string): DownloadProgress | null {
    return this.downloadProgressMap.get(videoId) || null;
  }

  /**
   * 檢查是否正在下載中
   */
  isDownloading(videoId: string): boolean {
    return this.downloadingMap.has(videoId);
  }

  /**
   * 批量預快取多個影片（搜尋結果出來後背景下載全部）
   * 會自動跳過已快取和正在下載的項目
   */
  async precacheVideos(videoIds: string[]): Promise<void> {
    const uncachedIds = videoIds.filter(id => !this.has(id) && !this.downloadingMap.has(id));

    if (uncachedIds.length === 0) {
      console.log(`✅ [AudioCache] All ${videoIds.length} videos already cached or downloading`);
      return;
    }

    console.log(`📦 [AudioCache] Pre-caching ${uncachedIds.length}/${videoIds.length} videos (sequential, low priority)...`);

    // 逐個下載，避免同時產生大量 yt-dlp 搶佔串流資源
    for (const videoId of uncachedIds) {
      // 再次檢查，可能在等待期間已被串流快取
      if (this.has(videoId) || this.downloadingMap.has(videoId)) continue;
      try {
        await this.precacheSingle(videoId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️ [AudioCache] Pre-cache failed for ${videoId}: ${msg}`);
      }
    }
  }

  /**
   * 使用 yt-dlp 直接下載音訊到快取（避免 403）
   */
  async downloadWithYtDlp(videoId: string): Promise<string | null> {
    // 如果已經有快取，直接返回
    if (this.has(videoId)) {
      return this.getCachePath(videoId);
    }

    // 如果已經在下載中，等待
    if (this.downloadingMap.has(videoId)) {
      console.log(`⏳ [AudioCache] Already downloading: ${videoId}`);
      return this.downloadingMap.get(videoId)!;
    }

    const downloadPromise = this.doDownloadWithYtDlp(videoId);
    this.downloadingMap.set(videoId, downloadPromise);

    try {
      return await downloadPromise;
    } finally {
      this.downloadingMap.delete(videoId);
    }
  }

  /**
   * 執行 yt-dlp 直接下載（內部方法）
   */
  private async doDownloadWithYtDlp(videoId: string): Promise<string | null> {
    const cachePath = this.getCachePath(videoId);
    const proc = spawn(youtubeService.getYtDlpPath(), [
      ...youtubeService.getYtDlpBaseArgs(),
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
      '-o', '-', `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    this.downloadProgressMap.set(videoId, {
      videoId, downloadedBytes: 0, totalBytes: null, percentage: 0,
      status: 'downloading', startedAt: Date.now(),
    });
    proc.stderr.resume();
    const writer = createAudioCacheWriter(proc, cachePath,
      (file, signal) => this.remuxIfNeeded(file, signal), {
        onProgress: downloadedBytes => this.downloadProgressMap.set(videoId, {
          ...this.downloadProgressMap.get(videoId)!, downloadedBytes,
        }),
      });
    const result = await writer.completion;
    const size = result ? this.getFileSize(videoId) : null;
    this.downloadProgressMap.set(videoId, {
      ...this.downloadProgressMap.get(videoId)!,
      status: result ? 'completed' : 'failed',
      ...(size !== null ? { downloadedBytes: size, totalBytes: size, percentage: 100 } : {}),
    });
    setTimeout(() => this.downloadProgressMap.delete(videoId), 30000);
    if (result) this.cleanupIfNeeded();
    return result;
  }

  /**
   * 預快取單一影片：使用 yt-dlp 直接下載
   */
  private async precacheSingle(videoId: string): Promise<void> {
    try {
      // 再次檢查，避免重複
      if (this.has(videoId) || this.downloadingMap.has(videoId)) return;

      await this.downloadWithYtDlp(videoId);
    } catch (error) {
      // 靜默失敗，不影響其他預快取
      logger.warn(`Pre-cache failed for ${videoId}:`, error);
    }
  }

  /**
   * 批量檢查快取狀態
   */
  getCacheStatusBatch(videoIds: string[]): Map<string, { cached: boolean; downloading: boolean; progress: DownloadProgress | null }> {
    const result = new Map<string, { cached: boolean; downloading: boolean; progress: DownloadProgress | null }>();

    for (const videoId of videoIds) {
      result.set(videoId, {
        cached: this.has(videoId),
        downloading: this.isDownloading(videoId),
        progress: this.getDownloadProgress(videoId),
      });
    }

    return result;
  }
}

export default new AudioCacheService();
