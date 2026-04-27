import { ChildProcess, spawn } from 'child_process';
import { Request, Response } from 'express';
import * as fs from 'fs';
import youtubeService from './youtube.service';
import audioCacheService from './audio-cache.service';
import logger from '../utils/logger';

/**
 * 雙佇列下載管理器
 * Queue 1 (HIGH): 當前播放的歌曲 — 換歌立即 abort 舊的
 * Queue 2 (LOW):  背景預快取 — high priority 啟動時暫停
 *
 * 同時也是 stream 來源：HTTP /stream 端點透過 attachStreamConsumer 共享
 * 正在進行的 yt-dlp 進程 + 已下載的 chunks，避免重複 spawn 拖垮 RPi。
 */

interface Job {
  videoId: string;
  proc: ChildProcess;
  resolve: (path: string | null) => void;
  reject: (err: Error) => void;
  chunks: Buffer[];          // Buffered stdout for late stream consumers
  consumers: Response[];     // Live HTTP responses receiving fanned-out chunks
  ended: boolean;            // proc.stdout finished (success or fail)
  succeeded: boolean | null; // null = in progress, true = cache file ready, false = failed
}

const MAX_LOW_PRIORITY = 3;

class DownloadManager {
  private highPriority: Job | null = null;
  private lowPriority: Job[] = [];
  private lowQueue: string[] = [];
  // Callbacks registered by waiters (e.g. stream route) for in-progress downloads
  private completionCallbacks: Map<string, Array<(path: string | null) => void>> = new Map();

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

    // 同一首歌已在低優先級下載？提升為高優先級（保留進度與已 attach 的 stream consumers）
    const lowIdx = this.lowPriority.findIndex(j => j.videoId === videoId);
    if (lowIdx !== -1) {
      const existing = this.lowPriority[lowIdx];
      this.lowPriority.splice(lowIdx, 1);
      console.log(`⬆️ [DM] Promoting low → high: ${videoId}`);

      // 殺掉舊的高優先級（不同歌）
      if (this.highPriority) {
        console.log(`⚡ [DM] Aborting high-priority: ${this.highPriority.videoId} → ${videoId}`);
        this.killJob(this.highPriority);
        this.highPriority = null;
      }
      // 殺掉其他低優先級
      for (const job of this.lowPriority) {
        console.log(`⏸️ [DM] Pausing low-priority: ${job.videoId}`);
        this.lowQueue.unshift(job.videoId);
        this.killJob(job);
      }
      this.lowPriority = [];

      this.highPriority = existing;
      return new Promise((resolve, reject) => {
        const oldResolve = existing.resolve;
        const oldReject = existing.reject;
        existing.resolve = (path) => { oldResolve(path); resolve(path); };
        existing.reject = (err) => { oldReject(err); reject(err); };
      });
    }

    // 殺掉舊的高優先級（不同歌）
    if (this.highPriority) {
      console.log(`⚡ [DM] Aborting high-priority: ${this.highPriority.videoId} → ${videoId}`);
      this.killJob(this.highPriority);
      this.highPriority = null;
    }

    // 殺掉所有低優先級（釋放資源給高優先級）
    if (this.lowPriority.length > 0) {
      for (const job of this.lowPriority) {
        console.log(`⏸️ [DM] Pausing low-priority: ${job.videoId}`);
        // 重新排入佇列（如果不同歌）
        if (job.videoId !== videoId) {
          this.lowQueue.unshift(job.videoId);
        }
        this.killJob(job);
      }
      this.lowPriority = [];
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
      if (this.lowPriority.some(j => j.videoId === id)) continue;
      if (this.lowQueue.includes(id)) continue;
      this.lowQueue.push(id);
    }
    this.processLowQueue();
  }

  /**
   * 取消低優先級下載。
   * 注意：若有 stream consumer 已 attach 到該 job，禁止 abort（會中斷使用者播放）。
   */
  abortForVideoId(videoId: string): void {
    // 從等待佇列移除
    this.lowQueue = this.lowQueue.filter(id => id !== videoId);
    // 殺掉正在進行的低優先級 job（除非有 stream 訂閱）
    const idx = this.lowPriority.findIndex(j => j.videoId === videoId);
    if (idx !== -1) {
      const job = this.lowPriority[idx];
      if (job.consumers.length > 0) {
        console.log(`🛡️ [DM] Skip abort for ${videoId}: ${job.consumers.length} stream consumer(s) attached`);
        return;
      }
      console.log(`⚡ [DM] Aborting low-priority download: ${videoId}`);
      this.killJob(job);
      this.lowPriority.splice(idx, 1);
      // 讓其他佇列中的任務繼續
      this.processLowQueue();
    }
  }

  /**
   * Wait for an in-progress download (high or low priority) to complete.
   * Returns a Promise that resolves with the cached path (or null on failure).
   * Returns null immediately if the videoId is not currently downloading.
   * Callers should impose their own timeout (e.g. Promise.race with a setTimeout).
   *
   * (保留供其他呼叫端使用；stream 端點現已改用 attachStreamConsumer 直接 fan-out。)
   */
  awaitDownload(videoId: string): Promise<string | null> | null {
    const isActive =
      this.highPriority?.videoId === videoId ||
      this.lowPriority.some(j => j.videoId === videoId);
    if (!isActive) return null;

    return new Promise<string | null>(resolve => {
      if (!this.completionCallbacks.has(videoId)) {
        this.completionCallbacks.set(videoId, []);
      }
      this.completionCallbacks.get(videoId)!.push(resolve);
    });
  }

  private triggerCompletionCallbacks(videoId: string, path: string | null): void {
    const callbacks = this.completionCallbacks.get(videoId);
    if (callbacks && callbacks.length > 0) {
      this.completionCallbacks.delete(videoId);
      for (const cb of callbacks) cb(path);
    }
  }

  /**
   * 取得下載狀態
   */
  getStatus(videoId: string): { status: 'cached' | 'downloading-high' | 'downloading-low' | 'queued' | 'none' } {
    if (audioCacheService.has(videoId)) return { status: 'cached' };
    if (this.highPriority?.videoId === videoId) return { status: 'downloading-high' };
    if (this.lowPriority.some(j => j.videoId === videoId)) return { status: 'downloading-low' };
    if (this.lowQueue.includes(videoId)) return { status: 'queued' };
    return { status: 'none' };
  }

  /**
   * 嘗試將 HTTP response attach 到正在進行的下載。
   * 找得到 job → 共用 yt-dlp 進程 + 共用 chunks，立即 replay 已下載的部分，回傳 true。
   * 找不到 → 回傳 false，由呼叫端自行 spawn yt-dlp。
   */
  attachStreamConsumer(videoId: string, req: Request, res: Response): boolean {
    const job = this.findActiveJob(videoId);
    if (!job) return false;

    // 任務已失敗結束 → 不能 serve 半成品
    if (job.ended && job.succeeded === false) return false;

    console.log(`🔗 [DM] Attaching stream consumer for ${videoId} (buffered=${job.chunks.length} chunks, ended=${job.ended})`);

    if (!res.headersSent) {
      res.status(200);
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      res.setHeader('Cache-Control', 'no-cache');
    }

    // Replay 已經下載到的 chunks
    for (const chunk of job.chunks) {
      if (res.writableEnded) return true;
      try { res.write(chunk); } catch { return true; }
    }

    // proc 已成功結束 → 直接 end
    if (job.ended) {
      if (!res.writableEnded) {
        try { res.end(); } catch {}
      }
      return true;
    }

    // 加入 live consumer 列表
    job.consumers.push(res);

    const cleanup = () => {
      const idx = job.consumers.indexOf(res);
      if (idx !== -1) job.consumers.splice(idx, 1);
    };
    req.once('close', cleanup);
    res.once('close', cleanup);
    res.once('finish', cleanup);

    return true;
  }

  private findActiveJob(videoId: string): Job | null {
    if (this.highPriority?.videoId === videoId) return this.highPriority;
    return this.lowPriority.find(j => j.videoId === videoId) || null;
  }

  private processLowQueue(): void {
    if (this.highPriority) return; // 高優先級運行中，不啟動低優先級

    while (this.lowPriority.length < MAX_LOW_PRIORITY && this.lowQueue.length > 0) {
      const videoId = this.lowQueue.shift()!;
      if (audioCacheService.has(videoId)) continue;

      console.log(`🔵 [DM] LOW PRIORITY (${this.lowPriority.length + 1}/${MAX_LOW_PRIORITY}): ${videoId}`);
      const job = this.spawnJob(videoId, () => {}, () => {});
      this.lowPriority.push(job);

      job.proc.on('close', () => {
        const idx = this.lowPriority.indexOf(job);
        if (idx !== -1) {
          this.lowPriority.splice(idx, 1);
        }
        this.processLowQueue();
      });
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

    // Wrap resolve so completion callbacks are always fired exactly once,
    // regardless of whether resolution comes from success, error, or killJob.
    let settled = false;
    const callResolve = (path: string | null) => {
      if (settled) return;
      settled = true;
      resolve(path);
      this.triggerCompletionCallbacks(videoId, path);
    };

    const job: Job = {
      videoId,
      proc,
      resolve: callResolve, // stored so killJob can fire it (and thus callbacks)
      reject,
      chunks: [],
      consumers: [],
      ended: false,
      succeeded: null,
    };

    const endConsumers = () => {
      for (const res of job.consumers) {
        if (!res.writableEnded) {
          try { res.end(); } catch {}
        }
      }
      job.consumers.length = 0;
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      if (aborted) return;
      downloadedBytes += chunk.length;
      job.chunks.push(chunk);

      // Fan out to live stream consumers
      for (const res of job.consumers) {
        if (!res.writableEnded) {
          try { res.write(chunk); } catch {}
        }
      }

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
              job.succeeded = true;
              job.ended = true;
              endConsumers();
              job.chunks.length = 0; // free memory
              callResolve(cachePath);
              return;
            }
          } catch (err) {
            logger.error(`[DM] Save error: ${videoId}`, err);
          }
        }
        try { fs.unlinkSync(tempPath); } catch {}
        job.succeeded = false;
        job.ended = true;
        endConsumers();
        job.chunks.length = 0;
        callResolve(null);
      });
    });

    proc.on('error', (err) => {
      if (aborted) return;
      console.error(`❌ [DM] Process error: ${videoId}`, err);
      try { fs.unlinkSync(tempPath); } catch {}
      job.succeeded = false;
      job.ended = true;
      endConsumers();
      job.chunks.length = 0;
      callResolve(null);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && !msg.startsWith('WARNING')) {
        // Only log non-warning stderr
      }
    });

    return job;
  }

  private killJob(job: Job): void {
    try {
      job.proc.kill('SIGTERM');
      setTimeout(() => {
        try { job.proc.kill('SIGKILL'); } catch {}
      }, 2000);
    } catch {}
    // End any attached stream consumers (truncated audio is better than hanging forever)
    for (const res of job.consumers) {
      if (!res.writableEnded) {
        try { res.end(); } catch {}
      }
    }
    job.consumers.length = 0;
    job.chunks.length = 0;
    job.ended = true;
    job.succeeded = false;
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
