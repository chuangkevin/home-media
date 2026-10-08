import { spawn } from 'child_process';
import { createAudioCacheWriter } from './audio-cache-writer';
import * as fs from 'fs';
import youtubeService from './youtube.service';
import audioCacheService from './audio-cache.service';
import type { AudioProgressiveSpool } from './audio-progressive-spool';
import { audioStreamOwners } from './audio-stream-owner';

/**
 * 雙佇列下載管理器
 * Queue 1 (HIGH): 明確請求的快取 — 保留仍有下載/HTTP consumer 的 producer
 * Queue 2 (LOW):  背景預快取 — high priority 啟動時暫停
 */

interface Job {
  videoId: string;
  completion: Promise<string | null>;
  cancel: () => void;
  spool?: AudioProgressiveSpool;
  cancelled?: boolean;
}

const MAX_LOW_PRIORITY = 3;

class DownloadManager {
  private highPriority: Job | null = null;
  private lowPriority: Job[] = [];
  private lowQueue: string[] = [];
  private retiringJobs = new Map<string, Set<Job>>();
  private deferredPaths = new Set<string>();
  private preservedHighJobs = new Set<Job>();

  /**
   * 高優先級：可用槽立即下載；既有明確快取/HTTP consumer 不被搶走
   * 用戶點播放時呼叫
   */
  async playNow(videoId: string): Promise<string | null> {
    const foreground = audioStreamOwners.get(videoId);
    if (foreground) {
      const retiring = foreground.cancelling;
      const retained = foreground.retainCacheUntilCompletion();
      await foreground.completion;
      if (audioCacheService.has(videoId)) return audioCacheService.getCachePath(videoId);
      // A new explicit cache intent can arrive after retirement began. Wait
      // for the old writer/path to be released, then start that new request.
      // Genuine extraction failures of a retained producer are not retried.
      return !retained && retiring ? this.playNow(videoId) : null;
    }
    const retiring = this.retiringJobs.get(videoId);
    if (retiring?.size) {
      await Promise.all([...retiring].map(job => job.completion));
      return this.playNow(videoId);
    }
    // 已快取？直接返回
    if (audioCacheService.has(videoId)) {
      return audioCacheService.getCachePath(videoId);
    }

    const existing = this.findJob(videoId);
    if (existing) return existing.completion;

    // Explicit cache requests and any borrowed HTTP reader keep their producer.
    // Foreground streaming has its own bounded admission path; a cache request
    // waits for an available cache slot instead of killing someone else's audio.
    if (this.cacheProducerCount() >= 4) {
      const jobs = this.allJobs();
      await Promise.race(jobs.map(job => job.completion));
      return this.playNow(videoId);
    }
    this.lowQueue = this.lowQueue.filter(id => id !== videoId);
    if (this.highPriority) {
      const previous = this.highPriority;
      this.preservedHighJobs.add(previous);
      void previous.completion.then(() => { this.preservedHighJobs.delete(previous); this.processLowQueue(); });
    }

    // 啟動高優先級下載
    console.log(`🔴 [DM] HIGH PRIORITY: ${videoId}`);
    const job = this.spawnJob(videoId);
    this.highPriority = job;
    void job.completion.then(() => {
      if (this.highPriority === job) {
        this.highPriority = null;
        this.processLowQueue();
      }
    });
    return job.completion;
  }

  /**
   * 低優先級：背景預快取，高優先級啟動時暫停
   */
  precache(videoIds: string[]): void {
    for (const id of videoIds) {
      if (audioCacheService.has(id)) continue;
      const foreground = audioStreamOwners.get(id);
      if (foreground) {
        if (!foreground.retainCacheUntilCompletion() && !this.deferredPaths.has(id)) {
          this.deferredPaths.add(id);
          void foreground.completion.then(() => { this.deferredPaths.delete(id); this.precache([id]); });
        }
        continue;
      }
      if (this.highPriority?.videoId === id) continue;
      if (this.findJob(id)) continue;
      if (this.lowQueue.includes(id)) continue;
      this.lowQueue.push(id);
    }
    this.processLowQueue();
  }

  /**
   * 取消正在進行或排隊的低優先級下載（供串流端點使用，避免同一首歌有兩個 yt-dlp 同時運行）
   */
  abortForVideoId(videoId: string): Promise<void> | null {
    this.lowQueue = this.lowQueue.filter(id => id !== videoId);
    const jobs = new Set(this.retiringJobs.get(videoId) ?? []);
    for (const job of this.allJobs().filter(job => job.videoId === videoId)) {
      this.killJob(job);
      jobs.add(job);
    }
    // Keep queue capacity and the final path fenced until child close plus
    // writer/remux cleanup; cancellation itself never frees them.
    return jobs.size ? Promise.all([...jobs].map(job => job.completion)).then(() => {}) : null;
  }

  getProgressiveJob(videoId: string): { spool: AudioProgressiveSpool; completion: Promise<string | null> } | null {
    const job = this.findJob(videoId);
    if (!job?.spool || job.cancelled || job.spool.snapshot().failed) return null;
    return { spool: job.spool, completion: job.completion };
  }

  /**
   * Wait for an in-progress download (high or low priority) to complete.
   * Returns a Promise that resolves with the cached path (or null on failure).
   * Returns null immediately if the videoId is not currently downloading.
   * Callers should impose their own timeout (e.g. Promise.race with a setTimeout).
   */
  awaitDownload(videoId: string): Promise<string | null> | null {
    const job = this.findJob(videoId);
    return job?.completion ?? null;
  }

  /**
   * 取得下載狀態
   */
  getStatus(videoId: string): { status: 'cached' | 'downloading-high' | 'downloading-low' | 'queued' | 'none' } {
    if (audioCacheService.has(videoId)) return { status: 'cached' };
    if (this.highPriority?.videoId === videoId || [...this.preservedHighJobs].some(job => job.videoId === videoId)) return { status: 'downloading-high' };
    if (this.lowPriority.some(j => j.videoId === videoId)) return { status: 'downloading-low' };
    if (this.lowQueue.includes(videoId)) return { status: 'queued' };
    return { status: 'none' };
  }

  private processLowQueue(): void {
    if (this.highPriority) return; // 高優先級運行中，不啟動低優先級

    while (this.lowPriority.length < MAX_LOW_PRIORITY && this.lowQueue.length > 0 && this.cacheProducerCount() < 4) {
      const index = this.lowQueue.findIndex(id => !this.retiringJobs.has(id) && !audioStreamOwners.has(id));
      if (index === -1) break;
      const [videoId] = this.lowQueue.splice(index, 1);
      if (audioCacheService.has(videoId)) continue;

      console.log(`🔵 [DM] LOW PRIORITY (${this.lowPriority.length + 1}/${MAX_LOW_PRIORITY}): ${videoId}`);
      const job = this.spawnJob(videoId);
      this.lowPriority.push(job);

      void job.completion.then(() => {
        const idx = this.lowPriority.indexOf(job);
        if (idx !== -1) {
          this.lowPriority.splice(idx, 1);
        }
        this.processLowQueue();
      });
    }
  }

  private allJobs(): Job[] {
    const jobs = new Set([...this.lowPriority, ...this.preservedHighJobs, ...[...this.retiringJobs.values()].flatMap(jobs => [...jobs])]);
    if (this.highPriority) jobs.add(this.highPriority);
    return [...jobs];
  }

  private findJob(videoId: string): Job | undefined {
    return this.allJobs().find(job => job.videoId === videoId);
  }

  private cacheProducerCount(): number { return this.allJobs().length; }

  private spawnJob(videoId: string): Job {
    if (audioStreamOwners.has(videoId) || this.retiringJobs.has(videoId)) throw new Error('Audio cache path is still owned');
    const proc = spawn(youtubeService.getYtDlpPath(), [
      ...youtubeService.getYtDlpBaseArgs(),
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
      '-o', '-', `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    const closed = new Promise<void>(resolve => proc.once('close', () => resolve()));
    proc.stderr.resume();
    const writer = createAudioCacheWriter(proc, audioCacheService.getCachePath(videoId),
      (file, signal) => audioCacheService.remuxIfNeeded(file, signal));
    const completion = writer.completion.then(async path => { await closed; return path; });
    return { videoId, ...writer, completion };
  }

  private killJob(job: Job): void {
    if (job.cancelled) return;
    job.cancelled = true;
    const retired = this.retiringJobs.get(job.videoId) ?? new Set<Job>();
    retired.add(job);
    this.retiringJobs.set(job.videoId, retired);
    void job.completion.then(() => {
      retired.delete(job);
      if (!retired.size && this.retiringJobs.get(job.videoId) === retired) this.retiringJobs.delete(job.videoId);
      this.processLowQueue();
    });
    job.cancel();
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
