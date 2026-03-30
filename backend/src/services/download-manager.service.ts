import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import youtubeService from './youtube.service';
import audioCacheService from './audio-cache.service';
import logger from '../utils/logger';

/**
 * 雙佇列下載管理器
 * Queue 1 (HIGH): 當前播放的歌曲 — 換歌立即 abort 舊的
 * Queue 2 (LOW):  背景預快取 — high priority 啟動時暫停
 */

interface Job {
  videoId: string;
  proc: ChildProcess;
  resolve: (path: string | null) => void;
  reject: (err: Error) => void;
}

class DownloadManager {
  private highPriority: Job | null = null;
  private lowPriority: Job | null = null;
  private lowQueue: string[] = [];

  /**
   * 高優先級：立即下載，abort 所有其他任務
   * 用戶點播放時呼叫
   */
  async playNow(videoId: string): Promise<string | null> {
    // 已快取？直接返回
    if (audioCacheService.has(videoId)) {
      return audioCacheService.getCachePath(videoId);
    }

    // 同一首歌已在高優先級下載？等它完成
    if (this.highPriority?.videoId === videoId) {
      return new Promise((resolve, reject) => {
        const oldResolve = this.highPriority!.resolve;
        const oldReject = this.highPriority!.reject;
        this.highPriority!.resolve = (path) => { oldResolve(path); resolve(path); };
        this.highPriority!.reject = (err) => { oldReject(err); reject(err); };
      });
    }

    // 殺掉舊的高優先級（不同歌）
    if (this.highPriority) {
      console.log(`⚡ [DM] Aborting high-priority: ${this.highPriority.videoId} → ${videoId}`);
      this.killJob(this.highPriority);
      this.highPriority = null;
    }

    // 殺掉低優先級（釋放資源給高優先級）
    if (this.lowPriority) {
      console.log(`⏸️ [DM] Pausing low-priority: ${this.lowPriority.videoId}`);
      // 重新排入佇列（如果不同歌）
      if (this.lowPriority.videoId !== videoId) {
        this.lowQueue.unshift(this.lowPriority.videoId);
      }
      this.killJob(this.lowPriority);
      this.lowPriority = null;
    }

    // 從低優先級佇列移除（如果在裡面）
    this.lowQueue = this.lowQueue.filter(id => id !== videoId);

    // 啟動高優先級下載
    console.log(`🔴 [DM] HIGH PRIORITY: ${videoId}`);
    return new Promise((resolve, reject) => {
      const job = this.spawnJob(videoId, resolve, reject);
      this.highPriority = job;

      job.proc.on('close', () => {
        if (this.highPriority === job) {
          this.highPriority = null;
          // 高優先級完成後恢復低優先級佇列
          this.processLowQueue();
        }
      });
    });
  }

  /**
   * 低優先級：背景預快取，高優先級啟動時暫停
   */
  precache(videoIds: string[]): void {
    for (const id of videoIds) {
      if (audioCacheService.has(id)) continue;
      if (this.highPriority?.videoId === id) continue;
      if (this.lowPriority?.videoId === id) continue;
      if (this.lowQueue.includes(id)) continue;
      this.lowQueue.push(id);
    }
    this.processLowQueue();
  }

  /**
   * 取得下載狀態
   */
  getStatus(videoId: string): { status: 'cached' | 'downloading-high' | 'downloading-low' | 'queued' | 'none' } {
    if (audioCacheService.has(videoId)) return { status: 'cached' };
    if (this.highPriority?.videoId === videoId) return { status: 'downloading-high' };
    if (this.lowPriority?.videoId === videoId) return { status: 'downloading-low' };
    if (this.lowQueue.includes(videoId)) return { status: 'queued' };
    return { status: 'none' };
  }

  private processLowQueue(): void {
    if (this.highPriority) return; // 高優先級運行中，不啟動低優先級
    if (this.lowPriority) return;  // 已有低優先級在跑

    while (this.lowQueue.length > 0) {
      const videoId = this.lowQueue.shift()!;
      if (audioCacheService.has(videoId)) continue;

      console.log(`🔵 [DM] LOW PRIORITY: ${videoId}`);
      const job = this.spawnJob(videoId, () => {}, () => {});
      this.lowPriority = job;

      job.proc.on('close', () => {
        if (this.lowPriority === job) {
          this.lowPriority = null;
          this.processLowQueue();
        }
      });
      break; // 一次只跑一個低優先級
    }
  }

  private spawnJob(videoId: string, resolve: (path: string | null) => void, reject: (err: Error) => void): Job {
    const ytdlpPath = youtubeService.getYtDlpPath();
    const baseArgs = youtubeService.getYtDlpBaseArgs();
    const cachePath = audioCacheService.getCachePath(videoId);
    const tempPath = `${cachePath}.tmp`;

    const args = [
      ...baseArgs,
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
      '-o', '-',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const proc = spawn(ytdlpPath, args, { timeout: 300000 });
    const writeStream = fs.createWriteStream(tempPath);
    let downloadedBytes = 0;
    let aborted = false;

    proc.stdout.on('data', (chunk: Buffer) => {
      if (aborted) return;
      downloadedBytes += chunk.length;
      const ok = writeStream.write(chunk);
      if (!ok) {
        proc.stdout.pause();
      }
    });

    writeStream.on('drain', () => {
      if (!aborted) proc.stdout.resume();
    });

    proc.stdout.on('end', () => {
      if (aborted) return;
      writeStream.end(() => {
        if (downloadedBytes > 0 && fs.existsSync(tempPath)) {
          try {
            const stats = fs.statSync(tempPath);
            if (stats.size > 0) {
              fs.renameSync(tempPath, cachePath);
              audioCacheService.remuxIfNeeded(cachePath);
              console.log(`✅ [DM] Downloaded: ${videoId} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
              resolve(cachePath);
              return;
            }
          } catch (err) {
            logger.error(`[DM] Save error: ${videoId}`, err);
          }
        }
        try { fs.unlinkSync(tempPath); } catch {}
        resolve(null);
      });
    });

    proc.on('error', (err) => {
      if (aborted) return;
      console.error(`❌ [DM] Process error: ${videoId}`, err);
      try { fs.unlinkSync(tempPath); } catch {}
      resolve(null);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.startsWith('WARNING')) {
        // Only log non-warning stderr
      }
    });

    const job: Job = {
      videoId,
      proc,
      resolve,
      reject,
    };

    return job;
  }

  private killJob(job: Job): void {
    try {
      job.proc.kill('SIGTERM');
      setTimeout(() => {
        try { job.proc.kill('SIGKILL'); } catch {}
      }, 2000);
    } catch {}
    job.resolve(null); // Resolve with null, don't reject (cleaner)
    // Clean up temp file
    const tempPath = audioCacheService.getCachePath(job.videoId) + '.tmp';
    try { fs.unlinkSync(tempPath); } catch {}
  }

  /**
   * 啟動時清理殘留的 .tmp 檔案
   */
  cleanupStaleTemps(): void {
    try {
      const cacheDir = audioCacheService.getCacheDir();
      const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.tmp'));
      for (const file of files) {
        try {
          fs.unlinkSync(`${cacheDir}/${file}`);
        } catch {}
      }
      if (files.length > 0) {
        console.log(`🧹 [DM] Cleaned ${files.length} stale .tmp files`);
      }
    } catch {}
  }
}

export const downloadManager = new DownloadManager();

// 啟動時清理
downloadManager.cleanupStaleTemps();

export default downloadManager;
