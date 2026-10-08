import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import youtubeService from './youtube.service';
import logger from '../utils/logger';
import { getDatabase } from '../config/database';

const VIDEO_CACHE_DIR = path.join(process.cwd(), 'data', 'video-cache');
const MAX_VIDEO_CACHE_MB = 5000; // 5GB 上限

type ByteRangeResult =
  | { kind: 'range'; start: number; end: number }
  | { kind: 'unsatisfiable' }
  | { kind: 'ignore' };

/** Parse the single byte range supported by this endpoint without numeric overflow. */
function parseByteRange(header: unknown, fileSize: number): ByteRangeResult {
  if (typeof header !== 'string') return { kind: 'ignore' };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  // Malformed, unsupported units, and multi-range requests are safely served in full.
  if (!match || (!match[1] && !match[2])) return { kind: 'ignore' };

  const size = BigInt(fileSize);
  if (match[1]) {
    const start = BigInt(match[1]);
    const requestedEnd = match[2] ? BigInt(match[2]) : size - 1n;
    if (start >= size || start > requestedEnd) return { kind: 'unsatisfiable' };
    const end = requestedEnd >= size ? size - 1n : requestedEnd;
    return { kind: 'range', start: Number(start), end: Number(end) };
  }

  const suffixLength = BigInt(match[2]);
  if (suffixLength === 0n) return { kind: 'unsatisfiable' };
  const start = suffixLength >= size ? 0n : size - suffixLength;
  return { kind: 'range', start: Number(start), end: fileSize - 1 };
}

if (!fs.existsSync(VIDEO_CACHE_DIR)) {
  fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
}

class VideoCacheService {
  private downloading: Map<string, Promise<string | null>> = new Map();

  /** Check if video is cached */
  has(videoId: string): boolean {
    try {
      const stat = fs.statSync(this.getPath(videoId));
      // An empty placeholder is not a playable cache entry. Leave it in place;
      // a later successful download can replace it without eagerly deleting cache files.
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  /** Get file path */
  getPath(videoId: string): string {
    return path.join(VIDEO_CACHE_DIR, `${videoId}.mp4`);
  }

  /** Get download status */
  isDownloading(videoId: string): boolean {
    return this.downloading.has(videoId);
  }

  /** Get status */
  getStatus(videoId: string): { cached: boolean; downloading: boolean } {
    return {
      cached: this.has(videoId),
      downloading: this.isDownloading(videoId),
    };
  }

  /** Download video (720p max, mp4) */
  async download(videoId: string): Promise<string | null> {
    if (this.has(videoId)) return this.getPath(videoId);
    if (this.downloading.has(videoId)) return this.downloading.get(videoId)!;

    const promise = this.doDownload(videoId);
    this.downloading.set(videoId, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.downloading.delete(videoId);
    }
  }

  private doDownload(videoId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const ytdlpPath = youtubeService.getYtDlpPath();
      const baseArgs = youtubeService.getYtDlpBaseArgs();
      const outputPath = this.getPath(videoId);
      // yt-dlp 會自動加 .mp4 副檔名（因為 --merge-output-format mp4）
      // 所以 temp path 不要包含 .mp4，避免變成 .mp4.tmp.mp4
      const tempPath = path.join(VIDEO_CACHE_DIR, `${videoId}.tmp`);

      const args = [
        ...baseArgs,
        // 寬鬆格式：接受任何 720p 以下的影片，讓 yt-dlp 自動選最佳組合
        '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b',
        '--merge-output-format', 'mp4',
        '--no-part',  // 不用 .part 檔，直接寫入 .tmp
        '-o', tempPath,
        `https://www.youtube.com/watch?v=${videoId}`,
      ];

      console.log(`🎬 [VideoCache] Downloading: ${videoId}`);
      console.log(`🎬 [VideoCache] Command: ${ytdlpPath} ${args.slice(-3).join(' ')}`);
      const proc = spawn(ytdlpPath, args, { timeout: 300000 });

      let lastProgress = '';
      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (!msg) return;
        // 只 log 進度變化（避免刷屏）
        const pctMatch = msg.match(/(\d+\.\d+%)/);
        if (pctMatch) {
          const pct = pctMatch[1];
          if (pct !== lastProgress) {
            lastProgress = pct;
            if (pct === '100.0%' || parseFloat(pct) % 10 < 1) {
              console.log(`🎬 [VideoCache] ${videoId}: ${pct}`);
            }
          }
        } else if (msg.includes('ERROR') || msg.includes('Merging')) {
          console.log(`🎬 [VideoCache] ${msg}`);
        }
      });

      proc.stdout.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) console.log(`🎬 [VideoCache] stdout: ${msg}`);
      });

      proc.on('close', (code) => {
        // yt-dlp 可能產生 .tmp.mp4（自動加副檔名）或 .tmp
        const possiblePaths = [
          tempPath + '.mp4',  // yt-dlp 自動加 .mp4
          tempPath,           // 直接用 temp path
        ];

        const actualFile = possiblePaths.find(p => fs.existsSync(p));

        if (code === 0 && actualFile) {
          try {
            const stats = fs.statSync(actualFile);
            if (stats.size > 0) {
              fs.renameSync(actualFile, outputPath);
              console.log(`✅ [VideoCache] Downloaded: ${videoId} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
              resolve(outputPath);
              return;
            }
          } catch (err) {
            logger.error(`VideoCache rename error for ${videoId}:`, err);
          }
        }
        // Cleanup
        possiblePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
        console.error(`❌ [VideoCache] Download failed: ${videoId} (code: ${code}, files checked: ${possiblePaths.join(', ')})`);
        resolve(null);
      });

      proc.on('error', (err) => {
        console.error(`❌ [VideoCache] Process error: ${videoId}`, err);
        try { fs.unlinkSync(tempPath); } catch {}
        resolve(null);
      });
    });
  }

  /** Delete cached video */
  delete(videoId: string): void {
    const filePath = this.getPath(videoId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ [VideoCache] Deleted: ${videoId}`);
    }
  }

  /**
   * 智慧清理：根據 play_count 決定保留時間
   * play_count >= 10: 保留 30 天
   * play_count >= 5:  保留 7 天
   * play_count < 5:   保留 1 天
   * 總大小超過 5GB 時，從最舊開始砍
   */
  smartCleanup(): void {
    const files = fs.readdirSync(VIDEO_CACHE_DIR).filter(f => f.endsWith('.mp4'));
    if (files.length === 0) return;

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let totalSize = 0;

    // 收集檔案資訊
    const entries: { videoId: string; path: string; size: number; mtime: number; ttl: number }[] = [];

    for (const file of files) {
      const videoId = file.replace('.mp4', '');
      const filePath = path.join(VIDEO_CACHE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        totalSize += stat.size;

        // 查 play_count
        let playCount = 0;
        try {
          const db = getDatabase();
          const row = db.prepare('SELECT play_count FROM cached_tracks WHERE video_id = ?').get(videoId) as any;
          if (row) playCount = row.play_count || 0;
        } catch {}

        const ttl = playCount >= 10 ? 30 * DAY : playCount >= 5 ? 7 * DAY : 1 * DAY;
        entries.push({ videoId, path: filePath, size: stat.size, mtime: stat.mtimeMs, ttl });
      } catch {}
    }

    // 按 mtime 排序（最舊在前）
    entries.sort((a, b) => a.mtime - b.mtime);

    let deleted = 0;
    const maxSize = MAX_VIDEO_CACHE_MB * 1024 * 1024;

    for (const entry of entries) {
      const age = now - entry.mtime;
      const expired = age > entry.ttl;
      const overSize = totalSize > maxSize;

      if (expired || overSize) {
        try {
          fs.unlinkSync(entry.path);
          totalSize -= entry.size;
          deleted++;
          console.log(`🗑️ [VideoCache] Cleaned: ${entry.videoId} (${expired ? 'expired' : 'over size'})`);
        } catch {}
      }
    }

    if (deleted > 0) {
      console.log(`🗑️ [VideoCache] Smart cleanup: deleted ${deleted}/${entries.length}, remaining ${(totalSize / 1024 / 1024).toFixed(0)}MB`);
    }
  }

  /** Clean all cached videos */
  cleanAll(): void {
    const files = fs.readdirSync(VIDEO_CACHE_DIR);
    for (const file of files) {
      try { fs.unlinkSync(path.join(VIDEO_CACHE_DIR, file)); } catch {}
    }
    console.log(`🗑️ [VideoCache] Cleaned all (${files.length} files)`);
  }

  /** Stream video file to response */
  streamVideo(videoId: string, req: any, res: any): void {
    const filePath = this.getPath(videoId);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (err: any) {
      const statusCode = err?.code === 'ENOENT' ? 404 : 500;
      res.status(statusCode).json({ error: statusCode === 404 ? 'Video not cached' : 'Unable to access cached video' });
      return;
    }
    if (!stat.isFile() || stat.size <= 0) {
      res.status(404).json({ error: 'Video not cached' });
      return;
    }

    const fileSize = stat.size;
    const parsedRange = parseByteRange(req.headers?.range, fileSize);
    if (parsedRange.kind === 'unsatisfiable') {
      res.writeHead(416, {
        'Content-Range': `bytes */${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': 0,
      });
      res.end();
      return;
    }

    const isPartial = parsedRange.kind === 'range';
    const start = isPartial ? parsedRange.start : undefined;
    const end = isPartial ? parsedRange.end : undefined;
    const headers: Record<string, string | number> = {
      'Content-Length': isPartial ? parsedRange.end - parsedRange.start + 1 : fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    if (isPartial) headers['Content-Range'] = `bytes ${parsedRange.start}-${parsedRange.end}/${fileSize}`;

    let readStream: fs.ReadStream;
    try {
      readStream = fs.createReadStream(filePath, isPartial ? { start, end } : undefined);
    } catch (err) {
      logger.error(`Video cache stream creation failed for ${videoId}:`, err);
      res.status(500).json({ error: 'Unable to stream cached video' });
      return;
    }

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      req.removeListener?.('aborted', onRequestAborted);
      res.removeListener?.('close', onResponseClosed);
      res.removeListener?.('finish', cleanup);
    };
    const onRequestAborted = () => {
      readStream.destroy();
      cleanup();
    };
    const onResponseClosed = () => {
      if (!res.writableEnded) readStream.destroy();
      cleanup();
    };

    req.once?.('aborted', onRequestAborted);
    res.once?.('close', onResponseClosed);
    res.once?.('finish', cleanup);

    // Wait until the file descriptor is open before committing headers. If the file
    // disappeared after stat, this still produces a clean 404 instead of a broken 200.
    readStream.once('open', () => {
      if (res.destroyed || res.writableEnded) {
        readStream.destroy();
        cleanup();
        return;
      }
      res.writeHead(isPartial ? 206 : 200, headers);
      readStream.pipe(res);
    });
    readStream.once('error', (err: any) => {
      cleanup();
      logger.error(`Video cache stream read failed for ${videoId}:`, err);
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        const statusCode = err?.code === 'ENOENT' ? 404 : 500;
        res.status(statusCode).json({ error: statusCode === 404 ? 'Video not cached' : 'Unable to stream cached video' });
      } else if (!res.destroyed) {
        // Headers/body may already be on the wire, so terminate the partial response.
        res.destroy(err);
      }
    });
  }
}

export const videoCacheService = new VideoCacheService();
export default videoCacheService;
