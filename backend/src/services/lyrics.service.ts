// youtube-dl-exec used for constants.YOUTUBE_DL_PATH in fetchYouTubeCaptions
import { getSong } from 'genius-lyrics-api';
import { db } from '../config/database';
import { Lyrics, LyricsLine, CachedLyrics } from '../types/lyrics.types';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { canReuseLyrics, selectCandidate, SongMetadata } from './lyrics-matching';
import { extractTrackInfo, isConfigured as isGeminiConfigured } from './gemini.service';

// @ts-ignore - no types available
import NeteaseMusic from 'simple-netease-cloud-music';

// 網易雲音樂 API 實例
const neteaseApi = new NeteaseMusic();

// LRCLIB API 響應類型
interface LRCLIBResponse {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string; // LRC 格式的同步歌詞
}

// LRCLIB 搜尋結果（給前端選擇用）
export interface LRCLIBSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  hasSyncedLyrics: boolean;
}

// 網易雲音樂搜尋結果
interface NeteaseSongResult {
  id: number;
  name: string;
  artists: Array<{ id: number; name: string }>;
  album: { id: number; name: string };
  duration: number;
}

// 網易雲音樂歌詞響應
interface NeteaseLyricResponse {
  lrc?: { lyric: string };     // 原文歌詞
  tlyric?: { lyric: string };  // 翻譯歌詞
  klyric?: { lyric: string };  // 卡拉OK歌詞
}

class LyricsService {
  private expectedMetadata(title: string, artist?: string, duration?: number): SongMetadata {
    const embedded = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    const cleanTitle = this.cleanSongTitle(title, artist);
    const reliableArtist = embedded ? (cleanTitle === embedded[1].trim() ? this.cleanArtistName(embedded[2].trim()) : embedded[1].trim()) : (artist && !this.isKnownAggregator(artist) ? this.cleanArtistName(artist) : undefined);
    return { title: cleanTitle, artist: reliableArtist, rawTitle: title, duration };
  }

  private neteaseCandidate(song: NeteaseSongResult) {
    const raw = song as any;
    return { id: song.id, trackName: song.name, artistName: (song.artists || raw.ar || []).map((a: any) => a.name).join(', '), duration: (song.duration || raw.dt) ? (song.duration || raw.dt) / 1000 : undefined };
  }
  /**
   * 指數退避重試輔助函數
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      baseDelay?: number;
      operationName?: string;
    } = {}
  ): Promise<T | null> {
    const { maxRetries = 3, baseDelay = 1000, operationName = 'operation' } = options;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        const errMsg = error instanceof Error ? error.message : String(error);

        if (isLastAttempt) {
          console.error(`❌ [${operationName}] 所有重試失敗: ${errMsg}`);
          logger.error(`[${operationName}] All retries failed: ${errMsg}`);
          return null;
        }

        console.log(`🔄 [${operationName}] 重試 ${attempt + 1}/${maxRetries}，${Math.round(delay)}ms 後... (${errMsg})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return null;
  }

  /**
   * 獲取歌詞（優先從快取，然後嘗試多個來源）
   * 改進版：更好的錯誤追蹤和日誌
   */
  async getLyrics(videoId: string, title: string, artist?: string, duration?: number): Promise<Lyrics | null> {
    const pipeline = this._getLyricsImpl(videoId, title, artist, duration);
    const RESPONSE_TIMEOUT = 12000;
    return Promise.race([
      pipeline,
      new Promise<null>((resolve) => setTimeout(() => {
        console.warn(`⏰ [LyricsService] 回應超時 ${RESPONSE_TIMEOUT / 1000}s（背景續跑並寫快取）: ${videoId}`);
        resolve(null);
      }, RESPONSE_TIMEOUT)),
    ]);
  }

  private async _getLyricsImpl(videoId: string, title: string, artist?: string, duration?: number, sharedYtCC?: Promise<Lyrics | null> | null): Promise<Lyrics | null> {
    const startTime = Date.now();
    console.log(`🎵 [LyricsService] START (parallel): videoId=${videoId}, title="${title}", artist="${artist || 'N/A'}"`);
    const metadata = this.expectedMetadata(title, artist, duration);

    // Cache first — instant when a previous run (or prefetch) already stored it.
    const cached = this.getFromCache(videoId);
    if (cached && canReuseLyrics(cached, metadata)) {
      console.log(`📝 [LyricsService] Cache hit: ${videoId} (${cached.source})`);
      return cached;
    }

    // Query every source at once; the first synced sheet wins and the rest are
    // aborted. A non-synced sheet is only returned if nothing synced appears.
    const controller = new AbortController();
    const signal = controller.signal;
    const ytCC = sharedYtCC ?? this.fetchYouTubeCaptions(videoId, metadata).catch(() => null);

    const tasks: Array<{ name: string; run: () => Promise<Lyrics | null> }> = [
      { name: 'lrclib', run: () => this.fetchLRCLIB(videoId, title, artist, duration, signal) },
      { name: 'netease', run: () => this.fetchNeteaseLyrics(videoId, title, artist, duration, signal) },
      { name: 'genius', run: () => this.fetchGeniusLyrics(videoId, title, artist, signal) },
      { name: 'youtube', run: () => ytCC },
    ];

    const winner = await new Promise<Lyrics | null>((resolve) => {
      let pending = tasks.length;
      let settled = false;
      let bestNonSynced: Lyrics | null = null;
      const finish = (lyrics: Lyrics | null) => {
        if (settled) return;
        settled = true;
        controller.abort();
        if (lyrics && lyrics.lines.length > 0) this.saveToCache(lyrics);
        resolve(lyrics);
      };
      for (const task of tasks) {
        task.run()
          .then((lyrics) => {
            if (!lyrics || lyrics.lines.length === 0) return;
            if (lyrics.isSynced) {
              console.log(`🎵 [LyricsService] ✅ ${task.name} won the race (${Date.now() - startTime}ms)`);
              finish(lyrics);
              return;
            }
            if (!bestNonSynced) bestNonSynced = lyrics;
          })
          .catch(() => { /* individual source failures never fail the request */ })
          .finally(() => {
            if (settled) return;
            if (--pending === 0) finish(bestNonSynced);
          });
      }
    });

    if (!winner) {
      console.log(`🎵 [LyricsService] ❌ No lyrics from any source (${Date.now() - startTime}ms)`);
      logger.warn(`⚠️ 無法找到歌詞: ${videoId} - ${title}`);
    }
    return winner;
  }

  /**
   * 從 YouTube 字幕獲取同步歌詞（使用 yt-dlp）
   * 改進版：更好的超時處理和錯誤日誌
   */
  private async fetchYouTubeCaptions(videoId: string, expected?: SongMetadata): Promise<Lyrics | null> {
    console.log(`🎬 [fetchYouTubeCaptions] START: videoId=${videoId}`);
    logger.info(`[YouTube CC] Starting subtitle fetch for: ${videoId}`);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-cc-'));
    const tempFile = path.join(tempDir, `${videoId}-subtitle`);

    const YT_DLP_TIMEOUT = 30000;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    // 只抓原始語言字幕（不抓翻譯版，避免 429 + 品質差）
    // 翻譯交給我們的 Gemini AI 處理
    const preferredLangs = ['zh', 'en', 'ja', 'ko'];

    try {
      const { spawn } = await import('child_process');
      const ytdlpConstants = require('youtube-dl-exec').constants;
      const ytdlpBin = ytdlpConstants?.YOUTUBE_DL_PATH || 'yt-dlp';

      // 只下載原始語言的手動/自動字幕
      // 不加 --write-auto-sub 的翻譯版（如 zh-Hant from en）避免 429
      const args = [
        '--skip-download',
        ...(expected ? ['--write-info-json'] : ['--write-auto-sub']),
        '--write-sub',
        '--sub-lang', preferredLangs.join(','),
        '--sub-format', 'vtt',
        '-o', tempFile,
        '--no-warnings',
        '--no-check-certificates',
        '--js-runtimes', `node:${process.execPath}`,
        url,
      ];

      console.log(`🎬 [fetchYouTubeCaptions] Running: ${ytdlpBin} ${args.join(' ')}`);

      // 不因 exit code 失敗 — yt-dlp 有時 skip-download 回傳 1 但字幕已下載
      await new Promise<void>((resolve) => {
        const proc = spawn(ytdlpBin, args, { timeout: YT_DLP_TIMEOUT });
        let stderr = '';
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.stdout?.on('data', (d: Buffer) => { console.log(`🎬 [fetchYouTubeCaptions] stdout: ${d.toString().trim()}`); });
        proc.on('close', (code) => {
          console.log(`🎬 [fetchYouTubeCaptions] yt-dlp exited with code ${code}`);
          if (stderr) console.log(`🎬 [fetchYouTubeCaptions] stderr: ${stderr.trim()}`);
          resolve(); // 永遠 resolve，讓後面的文件掃描來判斷是否成功
        });
        proc.on('error', (err) => {
          console.error(`🎬 [fetchYouTubeCaptions] spawn error: ${err.message}`);
          resolve(); // 即使 spawn 失敗也 resolve
        });
        setTimeout(() => { proc.kill(); resolve(); }, YT_DLP_TIMEOUT);
      });

      // 掃描所有產生的字幕文件（包括 .vtt 和可能的其他格式）
      let provenance: NonNullable<Lyrics['provenance']> = { selection: 'user', evidence: 'user-selection' };
      if (expected) {
        const infoPath = `${tempFile}.info.json`;
        if (!fs.existsSync(infoPath)) return null;
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (info.id !== videoId || info.uploader_verified !== true || !info.track || !info.artist ||
            !selectCandidate(expected, [{ id: 0, trackName: info.track, artistName: info.artist, duration: info.duration }])) return null;
        provenance = { selection: 'automatic', evidence: 'publisher-caption', title: info.track, artist: info.artist, duration: info.duration };
      }
      const allTempFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(`${videoId}-subtitle`));
      console.log(`🎬 [fetchYouTubeCaptions] All matching files in temp: ${allTempFiles.join(', ') || '(none)'}`);
      const allFiles = allTempFiles.filter(f => f.endsWith('.vtt'));
      console.log(`🎬 [fetchYouTubeCaptions] Found ${allFiles.length} subtitle files: ${allFiles.join(', ')}`);

      // 按優先順序找最佳字幕
      for (const lang of preferredLangs) {
        const langLower = lang.toLowerCase();
        const matchingFile = allFiles.find(f => f.toLowerCase().includes(`.${langLower}.`));
        if (matchingFile) {
          const filePath = path.join(tempDir, matchingFile);
          const vttContent = fs.readFileSync(filePath, 'utf-8');
          console.log(`🎬 [fetchYouTubeCaptions] Read ${vttContent.length} bytes from ${matchingFile}`);
          const lines = this.parseVTT(vttContent);
          if (lines.length > 0) {
            console.log(`🎬 [fetchYouTubeCaptions] ✅ ${lines.length} lines from ${matchingFile}`);
            return { videoId, lines, source: 'youtube', isSynced: true, language: lang, provenance };
          }
        }
      }

      // Fallback: 任何 .vtt 文件
      const anyVtt = allFiles[0];
      if (anyVtt) {
        const vttContent = fs.readFileSync(path.join(tempDir, anyVtt), 'utf-8');
        const lines = this.parseVTT(vttContent);
        if (lines.length > 0) {
          const detectedLang = anyVtt.replace(`${videoId}-subtitle.`, '').replace('.vtt', '');
          console.log(`🎬 [fetchYouTubeCaptions] ✅ Fallback: ${lines.length} lines from ${anyVtt}`);
          return { videoId, lines, source: 'youtube', isSynced: true, language: detectedLang, provenance };
        }
      }

      console.log(`🎬 [fetchYouTubeCaptions] No subtitle files found after yt-dlp run`);
      return null;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`🎬 [fetchYouTubeCaptions] ERROR: ${errMsg}`);
      logger.error(`YouTube CC 獲取失敗 (${videoId}): ${errMsg}`);
      return null;
    } finally {
      // 清理所有可能的臨時文件
      try {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
          if (file.startsWith(`${videoId}-subtitle`)) {
            try {
              fs.unlinkSync(path.join(tempDir, file));
            } catch {}
          }
        });
        fs.rmdirSync(tempDir);
      } catch (cleanupError) {
        // 忽略清理錯誤
      }
    }
  }

  /**
   * 從網易雲音樂獲取同步歌詞
   * 華語歌詞覆蓋率最高
   */
  private async fetchNeteaseLyrics(
    videoId: string,
    title: string,
    artist?: string,
    duration?: number,
    _signal?: AbortSignal
  ): Promise<Lyrics | null> {
    // 設定更長的 timeout（Docker 環境可能較慢）
    const NETEASE_TIMEOUT = 30000;

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`NetEase API timeout after ${ms}ms`)), ms)
        ),
      ]);
    };

    try {
      // Gemini AI extraction (regex fallback built-in)
      const { cleanTitle, cleanArtist } = await this.extractWithGemini(title, artist);

      // CJK-only fallback for mixed-language titles
      const CJK_PREFIX = /^([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3400-\u4dbf]+)/;
      const cjkTitle = CJK_PREFIX.exec(cleanTitle)?.[1] ?? null;
      const cjkArtist = cleanArtist ? (CJK_PREFIX.exec(cleanArtist)?.[1] ?? null) : null;

      // Build fallback search queries: title+artist → title only → CJK-only → simplified
      const searchQueries: string[] = [];
      if (cleanArtist) {
        searchQueries.push(`${cleanTitle} ${cleanArtist}`);
        searchQueries.push(cleanTitle);
      } else {
        searchQueries.push(cleanTitle);
      }
      if (cjkTitle && cjkTitle !== cleanTitle) {
        const bestCJKArtist = (cjkArtist && cjkArtist !== cleanArtist) ? cjkArtist : cleanArtist;
        if (bestCJKArtist) searchQueries.push(`${cjkTitle} ${bestCJKArtist}`);
        searchQueries.push(cjkTitle);
      }
      const simplified = this.simplifyTitle(cleanTitle);
      if (simplified !== cleanTitle) {
        searchQueries.push(simplified);
      }

      logger.info(`[NetEase] Starting search for: ${cleanTitle}`);

      let songs: NeteaseSongResult[] | null = null;
      for (const searchQuery of searchQueries) {
        console.log(`🎵 [NetEase] Searching: "${searchQuery}"`);
        const searchResult = await this.retryWithBackoff(
          () => withTimeout(neteaseApi.search(searchQuery), NETEASE_TIMEOUT),
          { maxRetries: 2, baseDelay: 1000, operationName: 'NetEase Search' }
        );
        if (searchResult?.result?.songs?.length > 0) {
          songs = (searchResult.result.songs as NeteaseSongResult[]).filter(song => !!selectCandidate(this.expectedMetadata(title, artist, duration), [this.neteaseCandidate(song)]));
          if (!songs.length) continue;
          console.log(`🎵 [NetEase] Found ${songs.length} results for: "${searchQuery}"`);
          break;
        }
        console.log(`🎵 [NetEase] No results for: "${searchQuery}", trying fallback...`);
      }

      if (!songs) {
        console.log(`🎵 [NetEase] No songs found after all fallback queries`);
        return null;
      }
      console.log(`🎵 [NetEase] Found ${songs.length} songs`);

      // 選擇最匹配的歌曲（第一個結果通常最相關）
      const selected = selectCandidate(this.expectedMetadata(title, artist, duration), songs.map(song => this.neteaseCandidate(song)));
      if (!selected) return null;
      const song = songs.find(song => song.id === selected.id)!;
      const songArtist = song.artists?.map((a: any) => a.name).join(', ')
        || (song as any).ar?.map((a: any) => a.name).join(', ')
        || 'Unknown';
      console.log(`🎵 [NetEase] Using song: ${song.name} by ${songArtist} (ID: ${song.id})`);

      // 獲取歌詞（加入 timeout 和重試）
      const lyricResult = await this.retryWithBackoff(
        () => withTimeout(neteaseApi.lyric(String(song.id)), NETEASE_TIMEOUT),
        { maxRetries: 2, baseDelay: 1000, operationName: 'NetEase Lyric' }
      ) as NeteaseLyricResponse | null;

      if (!lyricResult) {
        console.error(`🎵 [NetEase] Lyric API failed after retries`);
        return null;
      }

      if (!lyricResult || !lyricResult.lrc || !lyricResult.lrc.lyric) {
        console.log(`🎵 [NetEase] No lyrics found for song ID: ${song.id}`);
        return null;
      }

      const lrcContent = lyricResult.lrc.lyric;
      const lines = this.parseLRC(lrcContent);

      if (lines.length === 0) {
        console.log(`🎵 [NetEase] Failed to parse LRC content`);
        return null;
      }

      // 如果有翻譯歌詞，可以考慮合併（這裡先只用原文）
      const hasTrans = lyricResult.tlyric && lyricResult.tlyric.lyric;

      console.log(`🎵 [NetEase] Successfully parsed ${lines.length} lines (has translation: ${!!hasTrans})`);
      logger.info(`✅ 網易雲音樂成功: ${videoId}, ${lines.length} 行`);

      // 判斷是否真正有時間戳（不是全部 time=0）
      const hasSyncedTimestamps = lines.some(line => line.time > 0);

      return {
        videoId,
        lines,
        source: 'netease',
        isSynced: hasSyncedTimestamps,
        provenance: { selection: 'automatic', evidence: 'metadata', sourceId: song.id, title: selected.trackName, artist: selected.artistName, duration: selected.duration },
      };
    } catch (error) {
      console.error(`🎵 [NetEase] Unexpected error:`, error instanceof Error ? error.message : String(error));
      logger.error(`網易雲音樂獲取失敗 (${videoId}):`, error);
      return null;
    }
  }

  /**
   * 從 LRCLIB 獲取同步歌詞（LRC 格式）
   * LRCLIB 是免費的歌詞 API，提供同步歌詞
   * 改進版：更好的超時處理和錯誤日誌
   */
  private async fetchLRCLIB(
    videoId: string,
    title: string,
    artist?: string,
    duration?: number,
    signal?: AbortSignal
  ): Promise<Lyrics | null> {
    try {
      // Gemini AI extraction (regex fallback built-in)
      const { cleanTitle, cleanArtist } = await this.extractWithGemini(title, artist);

      logger.info(`[LRCLIB] Starting search for: ${cleanTitle}`);

      // For CJK+English mixed titles, also add CJK-only fallback URLs as safety net
      // e.g. when cleanTitle="晴天 Sunny Day" → also try "晴天"
      const CJK_PREFIX = /^([\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3400-\u4dbf]+)/;
      const cjkTitle = CJK_PREFIX.exec(cleanTitle)?.[1] ?? null;
      const cjkArtist = cleanArtist ? (CJK_PREFIX.exec(cleanArtist)?.[1] ?? null) : null;
      const hasMixedTitle = cjkTitle !== null && cjkTitle !== cleanTitle;
      const hasMixedArtist = cjkArtist !== null && cjkArtist !== cleanArtist;

      const mkURL = (t: string, a?: string) =>
        a ? `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`
          : `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}`;

      const searchURLs: string[] = [];
      if (cleanArtist) {
        searchURLs.push(mkURL(cleanTitle, cleanArtist));
      }
      searchURLs.push(mkURL(cleanTitle));
      // CJK-only fallbacks
      if (hasMixedTitle) {
        const bestCJKArtist = hasMixedArtist ? cjkArtist! : cleanArtist;
        if (bestCJKArtist) searchURLs.push(mkURL(cjkTitle!, bestCJKArtist));
        searchURLs.push(mkURL(cjkTitle!));
      }
      const simplified = this.simplifyTitle(cleanTitle);
      if (simplified !== cleanTitle) {
        searchURLs.push(mkURL(simplified, cleanArtist));
        searchURLs.push(mkURL(simplified));
      }

      let results: LRCLIBResponse[] = [];
      for (const url of searchURLs) {
        console.log(`🎼 [LRCLIB] Fetching: ${url}`);
        const response = await this.retryWithBackoff(
          async () => {
            const res = await this.fetchWithSSLBypass(url, 25000, signal);
            if (!res.ok) throw new Error(`API returned status ${res.status}`);
            return res;
          },
          { maxRetries: 2, baseDelay: 1500, operationName: 'LRCLIB Fetch' }
        );

        if (!response) {
          console.warn(`🎼 [LRCLIB] API failed for: ${url}`);
          continue;
        }

        try {
          const r = (await response.json()) as LRCLIBResponse[];
          console.log(`🎼 [LRCLIB] Search returned ${r?.length ?? 0} results`);
          if (r?.length > 0) {
            results = r.filter(candidate => !!selectCandidate(this.expectedMetadata(title, artist, duration), [candidate]));
            if (!results.length) continue;
            break;
          }
          console.log(`🎼 [LRCLIB] No results, trying fallback...`);
        } catch (parseErr) {
          console.error(`🎼 [LRCLIB] JSON parse error:`, parseErr);
          logger.error(`[LRCLIB] JSON parse error:`, parseErr);
        }
      }

      if (results.length === 0) {
        console.log(`🎼 [LRCLIB] No lyrics found for: ${cleanTitle}`);
        return null;
      }

      // 優先選擇有同步歌詞的結果
      const data = selectCandidate(this.expectedMetadata(title, artist, duration), results.filter(r => !!(r.syncedLyrics || r.plainLyrics)));
      if (!data) return null;
      const provenance: NonNullable<Lyrics['provenance']> = { selection: 'automatic', evidence: 'metadata', sourceId: data.id, title: data.trackName, artist: data.artistName, duration: data.duration };
      console.log(`🎼 [LRCLIB] Selected: ${data.trackName} by ${data.artistName} (ID: ${data.id})`);

      // 優先使用同步歌詞
      if (data.syncedLyrics) {
        const lines = this.parseLRC(data.syncedLyrics);
        if (lines.length > 0) {
          console.log(`🎼 [LRCLIB] Found ${lines.length} synced lines`);
          logger.info(`✅ LRCLIB 成功 (同步): ${videoId}, ${lines.length} 行`);
          return {
            videoId,
            lines,
            source: 'lrclib',
            isSynced: true,
            provenance,
          };
        }
      }

      // 如果沒有同步歌詞，使用純文字歌詞
      if (data.plainLyrics) {
        const lines: LyricsLine[] = data.plainLyrics
          .split('\n')
          .filter((line: string) => line.trim())
          .map((text: string) => ({
            time: 0,
            text: text.trim(),
          }));

        if (lines.length > 0) {
          console.log(`🎼 [LRCLIB] Found ${lines.length} plain lines (no sync)`);
          logger.info(`✅ LRCLIB 成功 (純文字): ${videoId}, ${lines.length} 行`);
          return {
            videoId,
            lines,
            source: 'lrclib',
            isSynced: false,
            provenance,
          };
        }
      }

      return null;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`🎼 [LRCLIB] Error: ${errMsg}`);
      logger.error(`LRCLIB 獲取失敗 (${videoId}): ${errMsg}`);
      return null;
    }
  }

  /**
   * 解析 LRC 格式歌詞
   * LRC 格式: [mm:ss.xx] lyrics text
   */
  private parseLRC(lrcContent: string): LyricsLine[] {
    const lines: LyricsLine[] = [];
    const lrcLines = lrcContent.split('\n');

    for (const line of lrcLines) {
      // 匹配時間戳: [mm:ss.xx] 或 [mm:ss]（支援 1-3 位數分鐘）
      const match = line.match(/^\[(\d{1,3}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)$/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
        const text = match[4].trim();

        const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;

        if (text) {
          // 過濾 metadata 行和純符號行
          const isMetadata = /^(作[词詞]\s*[：::]|作曲\s*[：::]|编曲\s*[：::]|編曲\s*[：::]|製作人?\s*[：::]|制作人?\s*[：::]|混音\s*[：::]|Recording|Producer|Lyricist|Composer|Arranger)/i.test(text);
          const isPureSymbol = /^[♪♫♬\s]+$/.test(text);
          if (!isMetadata && !isPureSymbol) {
            lines.push({ time: timeInSeconds, text });
          }
        }
      }
    }

    return lines;
  }

  /**
   * 使用 https 模組發送請求，繞過 SSL 驗證
   * 改進版：更長的超時時間，更好的錯誤處理
   */
  private fetchWithSSLBypass(url: string, timeout: number = 30000, signal?: AbortSignal): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const http = require('http');
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        rejectUnauthorized: false, // 繞過 SSL 驗證（Docker 環境可能沒有正確的 CA 證書）
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      };

      console.log(`🌐 [fetchWithSSLBypass] Requesting: ${url}`);

      const req = httpModule.request(options, (res: { statusCode: number; on: (event: string, callback: (data?: unknown) => void) => void }) => {
        let data = '';
        res.on('data', (chunk: unknown) => {
          data += String(chunk);
        });
        res.on('end', () => {
          console.log(`🌐 [fetchWithSSLBypass] Response: ${res.statusCode}, ${data.length} bytes`);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => {
              try {
                return Promise.resolve(JSON.parse(data));
              } catch (e) {
                console.error(`🌐 [fetchWithSSLBypass] JSON parse error:`, e);
                return Promise.reject(new Error(`Failed to parse JSON: ${data.substring(0, 200)}`));
              }
            },
            text: () => Promise.resolve(data),
          });
        });
      });

      if (signal) {
        signal.addEventListener('abort', () => { req.destroy(); reject(new Error('aborted')); }, { once: true });
      }

      req.on('error', (err: Error) => {
        console.error(`🌐 [fetchWithSSLBypass] Request error:`, err.message);
        reject(err);
      });

      req.setTimeout(timeout, () => {
        console.error(`🌐 [fetchWithSSLBypass] Request timeout after ${timeout}ms`);
        req.destroy();
        reject(new Error(`Request timeout after ${timeout}ms`));
      });

      req.end();
    });
  }

  /**
   * 清理歌曲標題（移除常見後綴，提取真正的歌名）
   * 改進版：加入 Unicode 正規化 + 更好的中文標題提取
   */
  private cleanSongTitle(title: string, channelName?: string): string {
    // 0. Unicode 正規化：統一字符形式
    let normalized = title
      .normalize('NFD')                           // 分解形式
      .replace(/[\u0300-\u036f]/g, '')            // 移除變音符號
      .normalize('NFC');                          // 重新組合

    // 統一括號：全角 -> 半角（但保留中文括號用於後續提取）
    normalized = normalized
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '') // 移除零寬字符
      .replace(/\s+/g, ' ')                       // 統一空白
      .trim();

    // 0.5 日文括號「」『』優先提取（常見格式：Artist「Song」或 「Song」歌詞）
    const japaneseBracketMatch = normalized.match(/[「『]([^「」『』]{1,60})[」』]/);
    if (japaneseBracketMatch) {
      const extracted = japaneseBracketMatch[1].trim();
      // Only use if the extracted part doesn't look like an anime title or descriptor
      const isDescriptor = /(?:anime|OP|ED|歌詞|official|MV|TV)/i.test(extracted);
      if (!isDescriptor) {
        console.log(`🎵 [cleanSongTitle] 從日文括號提取: "${extracted}" (原始: "${title}")`);
        return extracted;
      }
    }

    // 1. 先移除常見後綴（日文動漫標記、Official 等），再做歌名提取
    let cleaned = normalized
      // 移除方括號內容（通常是附加資訊、動漫標記等）
      .replace(/\s*\[.*?\]/g, '')
      // 移除圓括號內含 official/mv 等關鍵字的內容
      .replace(/\s*\(.*?(?:official|video|mv|audio|ver\.|version|feat\.|ft\.)[^)]*\)/gi, '')
      // 移除日文括號及其內容（「」『』）
      .replace(/\s*[「『].*?[」』]/g, '')
      // 移除中文括號含 official/mv 等的內容（【official music video】）
      .replace(/\s*【.*?(?:official|mv|music video|完整版|官方)[^】]*】/gi, '')
      .replace(/\s*-\s*(official|mv|music video|lyric|lyrics|audio).*$/gi, '')
      // 常見中文/日文後綴
      .replace(/\s*(official|mv|music video|lyrics?|lyric video)$/gi, '')
      .replace(/\s*(歌詞版|歌詞MV|完整版|官方MV|官方版|音樂影片|主題曲|片頭曲|片尾曲|插曲)$/gi, '')
      // Pipe-separated labels at end: "Song | Official Channel"
      .replace(/\s*[|｜]\s*(official|music video|mv|lyric).*$/gi, '')
      .replace(/[✨🎵🎶💕❤️🔥⭐️🌟💫]/g, '')
      .trim();

    // 2. 清理後再檢查中文括號【】或《》內的歌名
    const chineseBracketMatch = cleaned.match(/[【《]([^【】《》]+)[】》]/);
    if (chineseBracketMatch) {
      const extracted = chineseBracketMatch[1].trim();
      console.log(`🎵 [cleanSongTitle] 從中文括號提取: "${extracted}" (原始: "${title}")`);
      return extracted;
    }

    // 3a. 如果有頻道名稱，利用它來判斷 artist/title 分割
    if (channelName) {
      const cleanChannel = this.cleanArtistName(channelName);
      // Try splitting on various dash types with spaces
      const dashSplitMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashSplitMatch) {
        const beforeDash = dashSplitMatch[1].trim();
        const afterDash = dashSplitMatch[2].trim();

        // Check if before-dash matches channel name (fuzzy: case-insensitive, includes)
        const normalizedBefore = beforeDash.toLowerCase();
        const normalizedChannel = cleanChannel.toLowerCase();

        if (normalizedBefore === normalizedChannel ||
            normalizedChannel.includes(normalizedBefore) ||
            normalizedBefore.includes(normalizedChannel)) {
          // Artist is before dash, song title is after dash
          console.log(`🎵 [cleanSongTitle] 藝人匹配提取: "${afterDash}" (藝人: "${beforeDash}", 頻道: "${channelName}")`);
          return afterDash;
        }

        // Check if after-dash matches channel (reversed format: "Song - Artist")
        const normalizedAfter = afterDash.toLowerCase();
        if (normalizedAfter === normalizedChannel ||
            normalizedChannel.includes(normalizedAfter) ||
            normalizedAfter.includes(normalizedChannel)) {
          console.log(`🎵 [cleanSongTitle] 反向藝人匹配提取: "${beforeDash}" (藝人: "${afterDash}", 頻道: "${channelName}")`);
          return beforeDash;
        }
      }
    }

    // 3b. 嘗試提取 - 後面的歌名（常見格式：Artist - Song）— 無頻道名稱時的後備邏輯
    const dashMatch = cleaned.match(/[-–—]\s*(.+?)$/);
    if (dashMatch && dashMatch[1].length > 2 && !dashMatch[1].match(/official|mv|music|video|audio|lyrics/i)) {
      const extracted = dashMatch[1].trim();
      console.log(`🎵 [cleanSongTitle] 從破折號提取: "${extracted}" (原始: "${title}")`);
      return extracted;
    }

    // 4. 移除藝術家名稱前綴（如果存在明確分隔）
    // 例如："原子邦妮 Astro Bunny 在名為未來的波浪裡" -> 嘗試找出歌名部分
    // 通常藝術家名稱較短，歌名較長且可能包含中文
    const words = cleaned.split(/\s+/);
    if (words.length >= 3) {
      // 如果有3個以上的詞，可能前面是藝術家名
      // 嘗試找出最長的中文片段作為歌名
      const chinesePartMatch = cleaned.match(/[\u4e00-\u9fff]+[\u4e00-\u9fff\s]*/);
      if (chinesePartMatch && chinesePartMatch[0].length > 4) {
        // 如果有超過4個中文字，可能是歌名
        const extracted = chinesePartMatch[0].trim();
        console.log(`🎵 [cleanSongTitle] 從中文片段提取: "${extracted}" (原始: "${title}")`);
        return extracted;
      }
    }

    console.log(`🎵 [cleanSongTitle] 清理後: "${cleaned}" (原始: "${title}")`);
    return cleaned;
  }

  /**
   * 歌名/藝人提取：Gemini 優先，regex 作為 fallback
   * 歌詞搜尋是核心功能（使用者要跟著唱），準確度最重要
   */
  private async extractWithGemini(title: string, artist?: string): Promise<{ cleanTitle: string; cleanArtist: string }> {
    // Gemini 優先：有設定 API Key 就用 AI 提取
    if (isGeminiConfigured()) {
      try {
        console.log(`🤖 [Lyrics] 使用 Gemini 提取歌名: "${title}"`);
        const geminiResult = await extractTrackInfo(title, artist);
        if (geminiResult && geminiResult.title) {
          // Validate: reject if the returned title looks like a raw YouTube title
          // (too long, contains brackets/suffixes that should have been stripped, or low confidence)
          const looksLikeRawTitle =
            geminiResult.title.length > 80 ||
            /[【】《》\[\]]/.test(geminiResult.title) ||
            /\b(official|music video|lyric video|歌詞版|完整版)\b/i.test(geminiResult.title) ||
            geminiResult.confidence === 'low';

          if (looksLikeRawTitle) {
            console.warn(`⚠️ [Lyrics] Gemini 回傳標題疑似未清理乾淨，回退到 regex: "${geminiResult.title}" (confidence=${geminiResult.confidence})`);
          } else {
            // Filter out known aggregator/label channels from artist
            const rawArtist = geminiResult.artist || '';
            const cleanArtist = this.isKnownAggregator(rawArtist)
              ? (artist ? this.cleanArtistName(artist) : '')
              : (rawArtist || (artist ? this.cleanArtistName(artist) : ''));

            console.log(`🤖 [Lyrics] Gemini 提取成功: title="${geminiResult.title}", artist="${cleanArtist}"`);
            return { cleanTitle: geminiResult.title, cleanArtist };
          }
        }
      } catch (err) {
        console.warn('⚠️ [Lyrics] Gemini 提取失敗，回退到 regex:', err);
      }
    }

    // Fallback: regex 提取
    const regexTitle = this.cleanSongTitle(title, artist);
    const regexArtist = artist ? this.cleanArtistName(artist) : '';
    return { cleanTitle: regexTitle, cleanArtist: regexArtist };
  }

  /**
   * 判斷藝人名稱是否為已知的彙集頻道 / 唱片公司頻道（不是實際藝人）
   */
  private isKnownAggregator(artist: string): boolean {
    if (!artist) return false;
    const lower = artist.toLowerCase().trim();
    return (
      /^various(\s+artists?)?$/i.test(lower) ||
      /^(smtown|jyp\s?entertainment|big\s?hit|hybe|ygentertainment|yg\s?ent|sm\s?ent)/i.test(lower) ||
      /^(avex|sony\s?music|universal\s?music|warner\s?music|columbia\s?records?|epic\s?records?)/i.test(lower) ||
      /\brecords?\b/i.test(lower) ||
      /\bentertainment\b/i.test(lower) ||
      /\bmusic\s+group\b/i.test(lower)
    );
  }

  /**
   * 清理藝術家名稱（移除 YouTube 頻道後綴、唱片公司標記）
   */
  private cleanArtistName(artist: string): string {
    return artist
      .replace(/\s*-\s*topic$/i, '')        // YouTube 自動生成的頻道 "Artist - Topic"
      .replace(/\s*vevo$/i, '')              // "ArtistVEVO"
      .replace(/\s*official$/i, '')          // "Artist Official"
      .replace(/\s*music$/i, '')             // "Artist Music" (label channels)
      .replace(/\s*records?$/i, '')          // "Artist Records"
      .replace(/\s*entertainment$/i, '')     // "Artist Entertainment"
      .replace(/\s*\(official\)$/i, '')      // "Artist (Official)"
      .replace(/\s*【official】$/i, '')      // "Artist【Official】"
      .trim();
  }

  /**
   * 移除括號內的附加資訊（feat.、remix、live 等），保留核心歌名
   */
  private simplifyTitle(title: string): string {
    return title
      .replace(/\s*\(feat\.?\s[^)]*\)/gi, '')
      .replace(/\s*\(ft\.?\s[^)]*\)/gi, '')
      .replace(/\s*\(with\s[^)]*\)/gi, '')
      .replace(/\s*\(.*?(?:remix|remaster|remastered|live|cover|acoustic|radio edit|extended)[^)]*\)/gi, '')
      .replace(/\s*\[.*?(?:remix|remaster|live|cover)[^\]]*\]/gi, '')
      .replace(/\s*-\s*(?:remix|remastered?|live\s+ver\.?|acoustic\s+ver\.?)\s*$/gi, '')
      .trim();
  }

  /**
   * 解析 VTT 格式字幕
   */
  private parseVTT(vttContent: string): LyricsLine[] {
    const lines: LyricsLine[] = [];
    const vttLines = vttContent.split('\n');

    let i = 0;
    while (i < vttLines.length) {
      const line = vttLines[i].trim();

      // 查找時間戳行（格式：00:00:00.000 --> 00:00:05.000）
      if (line.includes('-->')) {
        const timeMatch = line.match(/(\d{2}):(\d{2}):(\d{2}\.\d{3})/);
        if (timeMatch) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const timeInSeconds = hours * 3600 + minutes * 60 + seconds;

          // 下一行是字幕文本
          i++;
          let text = '';
          while (i < vttLines.length && vttLines[i].trim() && !vttLines[i].includes('-->')) {
            text += vttLines[i].trim() + ' ';
            i++;
          }

          text = text.trim()
            .replace(/<[^>]+>/g, '') // 移除 HTML 標籤
            .replace(/\{[^}]+\}/g, '') // 移除 VTT 樣式標籤
            .replace(/♪/g, '').trim(); // 移除 ♪ 音樂符號

          // 跳過空行和純符號行
          if (text && !/^[\s♪♫♬\[\]()（）]+$/.test(text)) {
            lines.push({ time: timeInSeconds, text });
          }
        }
      }
      i++;
    }

    // YouTube 自動字幕去重：累積式 cue + 重複行
    const deduped: LyricsLine[] = [];
    for (let j = 0; j < lines.length; j++) {
      const cur = lines[j].text;
      const next = j + 1 < lines.length ? lines[j + 1].text : '';
      // 跳過：下一行包含當前行（累積式）
      if (next && next.startsWith(cur)) continue;
      // 跳過：當前行是下一行的子字串（部分重疊）
      if (next && next.includes(cur) && cur.length < next.length * 0.8) continue;
      // 跳過：跟上一個結果相同
      if (deduped.length > 0 && deduped[deduped.length - 1].text === cur) continue;
      // 跳過：跟上一個結果大量重疊（>70% 文字相同）
      if (deduped.length > 0) {
        const prev = deduped[deduped.length - 1].text;
        if (cur.startsWith(prev) || prev.startsWith(cur)) continue;
      }
      deduped.push(lines[j]);
    }
    return deduped;
  }

  /**
   * 從 Genius 獲取歌詞（通常沒有時間戳）
   */
  private async fetchGeniusLyrics(
    videoId: string,
    title: string,
    artist?: string,
    _signal?: AbortSignal
  ): Promise<Lyrics | null> {
    try {
      // Genius API 需要 API key（從環境變數獲取）
      const apiKey = process.env.GENIUS_API_KEY || '';
      if (!apiKey) {
        logger.warn('⚠️ Genius API key 未設置，跳過 Genius 查詢');
        return null;
      }

      // Gemini AI extraction (regex fallback built-in)
      const { cleanTitle, cleanArtist } = await this.extractWithGemini(title, artist);

      const options = {
        apiKey,
        title: cleanTitle || title,
        artist: cleanArtist || artist || '',
        optimizeQuery: true,
      };

      const song = await getSong(options);
      if (!song || !song.lyrics) {
        return null;
      }
      // The library may omit artist metadata. Search success alone is not matching evidence.
      const actualArtist = (song as any).primary_artist?.name || (song as any).artist;
      if (typeof actualArtist !== 'string' || !selectCandidate(this.expectedMetadata(title, artist), [{ id: song.id, trackName: song.title, artistName: actualArtist }])) return null;

      // 將純文字歌詞轉換為行數組（無時間戳）
      const lines: LyricsLine[] = song.lyrics
        .split('\n')
        .filter((line: string) => line.trim())
        .map((text: string) => ({
          time: 0, // 無時間戳
          text: text.trim(),
        }));

      logger.info(`✅ Genius 成功: ${videoId}, ${lines.length} 行`);
      return {
        videoId,
        lines,
        source: 'genius',
        isSynced: false,
        provenance: { selection: 'automatic', evidence: 'metadata', sourceId: song.id, title: song.title, artist: actualArtist },
      };
    } catch (error) {
      logger.error(`Genius 獲取失敗 (${videoId}):`, error);
      return null;
    }
  }

  /**
   * 從資料庫快取獲取歌詞
   */
  private getFromCache(videoId: string): Lyrics | null {
    try {
      const stmt = db.prepare('SELECT * FROM lyrics_cache WHERE video_id = ?');
      const row = stmt.get(videoId) as CachedLyrics | undefined;

      if (!row) {
        return null;
      }

      const lyrics: Lyrics = JSON.parse(row.lyrics);
      return lyrics;
    } catch (error) {
      logger.error(`讀取歌詞快取失敗 (${videoId}):`, error);
      return null;
    }
  }

  /**
   * 儲存歌詞到資料庫快取
   */
  private saveToCache(lyrics: Lyrics): void {
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO lyrics_cache (video_id, lyrics, source, is_synced, cached_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        lyrics.videoId,
        JSON.stringify(lyrics),
        lyrics.source,
        lyrics.isSynced ? 1 : 0,
        Date.now()
      );

      logger.info(`💾 歌詞已快取: ${lyrics.videoId} (來源: ${lyrics.source})`);
    } catch (error) {
      logger.error(`儲存歌詞快取失敗 (${lyrics.videoId}):`, error);
    }
  }

  /**
   * 清除特定來源的所有快取（例如清除所有 YouTube CC 快取）
   */
  clearCacheBySource(source: string): number {
    try {
      const stmt = db.prepare('DELETE FROM lyrics_cache WHERE source = ?');
      const result = stmt.run(source);
      console.log(`🗑️ 清除了 ${result.changes} 個 ${source} 歌詞快取`);
      return result.changes;
    } catch (error) {
      logger.error(`清除 ${source} 歌詞快取失敗:`, error);
      return 0;
    }
  }

  /**
   * 清除特定影片的快取
   */
  clearCacheForVideo(videoId: string): boolean {
    try {
      const stmt = db.prepare('DELETE FROM lyrics_cache WHERE video_id = ?');
      stmt.run(videoId);
      return true;
    } catch { return false; }
  }

  /** @deprecated 歌詞不會過期。保留舊介面但不刪資料；請使用明確的清除方法。 */
  clearExpiredCache(_daysOld: number = 30): number {
    return 0;
  }

  /**
   * 搜尋 LRCLIB 歌詞（讓使用者自訂關鍵字搜尋）
   */
  async searchLRCLIB(query: string): Promise<LRCLIBSearchResult[]> {
    try {
      console.log(`🔍 [LRCLIB Search] Query: "${query}"`);

      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const response = await this.fetchWithSSLBypass(url);

      if (!response.ok) {
        throw new Error(`LRCLIB API error: ${response.status}`);
      }

      const results = (await response.json()) as LRCLIBResponse[];
      console.log(`🔍 [LRCLIB Search] Found ${results.length} results`);

      return results.map(r => ({
        id: r.id,
        trackName: r.trackName,
        artistName: r.artistName,
        albumName: r.albumName,
        duration: r.duration,
        hasSyncedLyrics: !!r.syncedLyrics,
      }));
    } catch (error) {
      console.error(`🔍 [LRCLIB Search] Error:`, error);
      logger.error(`LRCLIB 搜尋失敗:`, error);
      return [];
    }
  }

  /**
   * 透過 LRCLIB ID 獲取特定歌詞
   */
  async getLyricsByLRCLIBId(videoId: string, lrclibId: number, expectedTitle?: string, expectedArtist?: string): Promise<Lyrics | null> {
    try {
      console.log(`🎼 [LRCLIB] Fetching lyrics by ID: ${lrclibId}`);

      const url = `https://lrclib.net/api/get/${lrclibId}`;
      const response = await this.fetchWithSSLBypass(url);

      if (!response.ok) {
        throw new Error(`LRCLIB API error: ${response.status}`);
      }

      const data = (await response.json()) as LRCLIBResponse;

      if (expectedTitle && expectedArtist && !this.isLyricsMetadataMatch(expectedTitle, expectedArtist, data.trackName, data.artistName)) {
        logger.warn(`⚠️ LRCLIB ID ${lrclibId} metadata mismatch for ${videoId}: expected ${expectedArtist} - ${expectedTitle}, got ${data.artistName} - ${data.trackName}`);
        return null;
      }

      // 優先使用同步歌詞
      if (data.syncedLyrics) {
        const lines = this.parseLRC(data.syncedLyrics);
        if (lines.length > 0) {
          const lyrics: Lyrics = {
            videoId,
            lines,
            source: 'lrclib',
            isSynced: true,
            lrclibId: data.id, // 記錄選擇的 ID
            provenance: { selection: 'user', evidence: 'user-selection', sourceId: data.id, title: data.trackName, artist: data.artistName, duration: data.duration },
          };
          // 儲存到快取
          this.saveToCache(lyrics);
          logger.info(`✅ LRCLIB ID ${lrclibId} 成功: ${videoId}, ${lines.length} 行`);
          return lyrics;
        }
      }

      // 如果沒有同步歌詞，使用純文字歌詞
      if (data.plainLyrics) {
        const lines: LyricsLine[] = data.plainLyrics
          .split('\n')
          .filter((line: string) => line.trim())
          .map((text: string) => ({
            time: 0,
            text: text.trim(),
          }));

        if (lines.length > 0) {
          const lyrics: Lyrics = {
            videoId,
            lines,
            source: 'lrclib',
            isSynced: false,
            lrclibId: data.id,
            provenance: { selection: 'user', evidence: 'user-selection', sourceId: data.id, title: data.trackName, artist: data.artistName, duration: data.duration },
          };
          this.saveToCache(lyrics);
          return lyrics;
        }
      }

      return null;
    } catch (error) {
      console.error(`🎼 [LRCLIB] Error fetching ID ${lrclibId}:`, error);
      logger.error(`LRCLIB ID 獲取失敗:`, error);
      return null;
    }
  }

  /**
   * 搜尋網易雲音樂歌詞（讓使用者自訂關鍵字搜尋）
   */
  async searchNetease(query: string): Promise<NeteaseSearchResult[]> {
    const NETEASE_TIMEOUT = 15000;

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`NetEase API timeout after ${ms}ms`)), ms)
        ),
      ]);
    };

    try {
      console.log(`🔍 [NetEase Search] Query: "${query}"`);

      const searchResult = await withTimeout(neteaseApi.search(query), NETEASE_TIMEOUT);

      if (!searchResult || !searchResult.result || !searchResult.result.songs) {
        console.log(`🔍 [NetEase Search] No results for: ${query}`);
        return [];
      }

      const songs = searchResult.result.songs as NeteaseSongResult[];
      console.log(`🔍 [NetEase Search] Found ${songs.length} results`);

      return songs.slice(0, 20).map(song => ({
        id: song.id,
        trackName: song.name || 'Unknown',
        artistName: song.artists?.map((a: any) => a.name).join(', ')
          || (song as any).ar?.map((a: any) => a.name).join(', ')
          || 'Unknown Artist',
        albumName: song.album?.name,
        duration: song.duration ? Math.floor(song.duration / 1000) : undefined,
        hasSyncedLyrics: true, // 網易雲通常都有同步歌詞
      }));
    } catch (error) {
      console.error(`🔍 [NetEase Search] Error:`, error);
      logger.error(`網易雲搜尋失敗:`, error);
      return [];
    }
  }

  /**
   * 透過網易雲音樂 ID 獲取特定歌詞
   */
  async getLyricsByNeteaseId(videoId: string, neteaseId: number, _expectedTitle?: string, _expectedArtist?: string): Promise<Lyrics | null> {
    const NETEASE_TIMEOUT = 15000;

    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`NetEase API timeout after ${ms}ms`)), ms)
        ),
      ]);
    };

    try {
      console.log(`🎵 [NetEase] Fetching lyrics by ID: ${neteaseId}`);

      const lyricResult = await withTimeout(
        neteaseApi.lyric(String(neteaseId)),
        NETEASE_TIMEOUT
      ) as NeteaseLyricResponse;

      if (!lyricResult || !lyricResult.lrc || !lyricResult.lrc.lyric) {
        console.log(`🎵 [NetEase] No lyrics found for ID: ${neteaseId}`);
        return null;
      }

      const lrcContent = lyricResult.lrc.lyric;
      const lines = this.parseLRC(lrcContent);

      if (lines.length === 0) {
        console.log(`🎵 [NetEase] Failed to parse LRC content`);
        return null;
      }

      const lyrics: Lyrics = {
        videoId,
        lines,
        source: 'netease',
        isSynced: true,
        provenance: { selection: 'user', evidence: 'user-selection', sourceId: neteaseId },
      };

      // 儲存到快取
      this.saveToCache(lyrics);
      logger.info(`✅ NetEase ID ${neteaseId} 成功: ${videoId}, ${lines.length} 行`);
      return lyrics;
    } catch (error) {
      console.error(`🎵 [NetEase] Error fetching ID ${neteaseId}:`, error);
      logger.error(`網易雲 ID 獲取失敗:`, error);
      return null;
    }
  }

  /**
   * 手動獲取 YouTube CC 字幕（讓使用者強制使用 YouTube 字幕）
   */
  async getYouTubeCaptions(videoId: string): Promise<Lyrics | null> {
    console.log(`🎬 [getYouTubeCaptions] Manual request for: ${videoId}`);
    const lyrics = await this.fetchYouTubeCaptions(videoId);
    if (lyrics) {
      this.saveToCache(lyrics);
    }
    return lyrics;
  }

  // ==================== 歌詞偏好設定（跨裝置同步）====================

  /**
   * 獲取歌詞偏好設定
   */
  getPreferences(videoId: string): LyricsPreferences | null {
    try {
      const row = db.prepare(`
        SELECT video_id, time_offset, lrclib_id, netease_id, updated_at
        FROM lyrics_preferences
        WHERE video_id = ?
      `).get(videoId) as { video_id: string; time_offset: number; lrclib_id: number | null; netease_id: number | null; updated_at: number } | undefined;

      if (!row) {
        return null;
      }

      return {
        videoId: row.video_id,
        timeOffset: row.time_offset,
        lrclibId: row.lrclib_id,
        neteaseId: row.netease_id,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      logger.error(`獲取歌詞偏好失敗: ${videoId}`, error);
      return null;
    }
  }

  private isLyricsMetadataMatch(expectedTitle: string, expectedArtist: string, actualTitle: string, actualArtist: string): boolean {
    return !!selectCandidate(this.expectedMetadata(expectedTitle, expectedArtist), [{ id: 0, trackName: actualTitle, artistName: actualArtist }]);
  }

  /**
   * 更新歌詞偏好設定
   */
  updatePreferences(videoId: string, prefs: { timeOffset?: number; lrclibId?: number | null; neteaseId?: number | null }): void {
    try {
      const now = Date.now();
      const existing = this.getPreferences(videoId);

      if (existing) {
        const nextTimeOffset = prefs.timeOffset !== undefined ? prefs.timeOffset : existing.timeOffset;
        const nextNeteaseId = prefs.neteaseId !== undefined ? prefs.neteaseId : existing.neteaseId;

        if (prefs.lrclibId === null) {
          db.prepare(`
            UPDATE lyrics_preferences
            SET time_offset = ?,
                lrclib_id = NULL,
                netease_id = ?,
                updated_at = ?
            WHERE video_id = ?
          `).run(nextTimeOffset, nextNeteaseId, now, videoId);
        } else if (prefs.neteaseId === null) {
          db.prepare(`
            UPDATE lyrics_preferences
            SET time_offset = ?,
                lrclib_id = ?,
                netease_id = NULL,
                updated_at = ?
            WHERE video_id = ?
          `).run(nextTimeOffset, prefs.lrclibId !== undefined ? prefs.lrclibId : existing.lrclibId, now, videoId);
        } else {
          const nextLrclibId = prefs.lrclibId !== undefined ? prefs.lrclibId : existing.lrclibId;
          db.prepare(`
            UPDATE lyrics_preferences
            SET time_offset = ?,
                lrclib_id = ?,
                netease_id = ?,
                updated_at = ?
            WHERE video_id = ?
          `).run(nextTimeOffset, nextLrclibId, nextNeteaseId, now, videoId);
        }

        const verify = this.getPreferences(videoId);
        logger.info(`🔎 歌詞偏好寫入後驗證: ${videoId} -> lrclib=${verify?.lrclibId} netease=${verify?.neteaseId} offset=${verify?.timeOffset}`);
      } else {
        // 建立新記錄
        db.prepare(`
          INSERT INTO lyrics_preferences (video_id, time_offset, lrclib_id, netease_id, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(videoId, prefs.timeOffset ?? 0, prefs.lrclibId ?? null, prefs.neteaseId ?? null, now);
      }

      logger.info(`✅ 儲存歌詞偏好: ${videoId} offset=${prefs.timeOffset} lrclibId=${prefs.lrclibId} neteaseId=${prefs.neteaseId}`);
    } catch (error) {
      logger.error(`儲存歌詞偏好失敗: ${videoId}`, error);
      throw error;
    }
  }
}

// 歌詞偏好設定類型
export interface LyricsPreferences {
  videoId: string;
  timeOffset: number;
  lrclibId: number | null;
  neteaseId: number | null;
  updatedAt: number;
}

// 網易雲搜尋結果（給前端顯示用）
export interface NeteaseSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  hasSyncedLyrics: boolean;
}

export default new LyricsService();
