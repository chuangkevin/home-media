import youtubedl from 'youtube-dl-exec';
import { getSong } from 'genius-lyrics-api';
import { db } from '../config/database';
import { Lyrics, LyricsLine, CachedLyrics } from '../types/lyrics.types';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
  async getLyrics(videoId: string, title: string, artist?: string): Promise<Lyrics | null> {
    const startTime = Date.now();
    console.log(`🎵 [LyricsService.getLyrics] START: videoId=${videoId}, title="${title}", artist="${artist || 'N/A'}"`);
    logger.info(`[LyricsService] Starting lyrics fetch for: ${videoId}`);

    const attemptResults: { source: string; success: boolean; error?: string; duration: number }[] = [];

    try {
      // 1. 檢查快取
      console.log(`🎵 [LyricsService] Step 1/5: Checking cache...`);
      const cacheStart = Date.now();
      const cached = this.getFromCache(videoId);
      if (cached) {
        console.log(`🎵 [LyricsService] ✅ Cache hit! (${Date.now() - cacheStart}ms)`);
        logger.info(`📝 使用快取的歌詞: ${videoId} (來源: ${cached.source})`);
        return cached;
      }
      attemptResults.push({ source: 'cache', success: false, duration: Date.now() - cacheStart });

      // 2. 嘗試從 YouTube 字幕獲取（通常有時間戳）
      console.log(`🎵 [LyricsService] Step 2/5: Fetching from YouTube CC...`);
      const ytStart = Date.now();
      try {
        const youtubeLyrics = await this.fetchYouTubeCaptions(videoId);
        const ytDuration = Date.now() - ytStart;
        if (youtubeLyrics) {
          console.log(`🎵 [LyricsService] ✅ YouTube CC found! (${ytDuration}ms)`);
          attemptResults.push({ source: 'youtube', success: true, duration: ytDuration });
          this.saveToCache(youtubeLyrics);
          this.logAttemptSummary(attemptResults, startTime);
          return youtubeLyrics;
        }
        attemptResults.push({ source: 'youtube', success: false, duration: ytDuration });
      } catch (ytErr) {
        attemptResults.push({ source: 'youtube', success: false, error: ytErr instanceof Error ? ytErr.message : String(ytErr), duration: Date.now() - ytStart });
      }

      // 3. 嘗試從網易雲音樂獲取（華語歌詞最齊全）
      console.log(`🎵 [LyricsService] Step 3/5: Fetching from NetEase...`);
      const neteaseStart = Date.now();
      try {
        const neteaseLyrics = await this.fetchNeteaseLyrics(videoId, title, artist);
        const neteaseDuration = Date.now() - neteaseStart;
        if (neteaseLyrics) {
          console.log(`🎵 [LyricsService] ✅ NetEase found! (${neteaseDuration}ms)`);
          attemptResults.push({ source: 'netease', success: true, duration: neteaseDuration });
          this.saveToCache(neteaseLyrics);
          this.logAttemptSummary(attemptResults, startTime);
          return neteaseLyrics;
        }
        attemptResults.push({ source: 'netease', success: false, duration: neteaseDuration });
      } catch (neteaseErr) {
        attemptResults.push({ source: 'netease', success: false, error: neteaseErr instanceof Error ? neteaseErr.message : String(neteaseErr), duration: Date.now() - neteaseStart });
      }

      // 4. 嘗試從 LRCLIB 獲取（有時間戳的 LRC 格式）
      console.log(`🎵 [LyricsService] Step 4/5: Fetching from LRCLIB...`);
      const lrclibStart = Date.now();
      try {
        const lrclibLyrics = await this.fetchLRCLIB(videoId, title, artist);
        const lrclibDuration = Date.now() - lrclibStart;
        if (lrclibLyrics) {
          console.log(`🎵 [LyricsService] ✅ LRCLIB found! (${lrclibDuration}ms)`);
          attemptResults.push({ source: 'lrclib', success: true, duration: lrclibDuration });
          this.saveToCache(lrclibLyrics);
          this.logAttemptSummary(attemptResults, startTime);
          return lrclibLyrics;
        }
        attemptResults.push({ source: 'lrclib', success: false, duration: lrclibDuration });
      } catch (lrclibErr) {
        attemptResults.push({ source: 'lrclib', success: false, error: lrclibErr instanceof Error ? lrclibErr.message : String(lrclibErr), duration: Date.now() - lrclibStart });
      }

      // 5. 嘗試從 Genius 獲取（通常沒有時間戳，最後備用）
      console.log(`🎵 [LyricsService] Step 5/5: Fetching from Genius...`);
      const geniusStart = Date.now();
      try {
        const geniusLyrics = await this.fetchGeniusLyrics(videoId, title, artist);
        const geniusDuration = Date.now() - geniusStart;
        if (geniusLyrics) {
          console.log(`🎵 [LyricsService] ✅ Genius found! (${geniusDuration}ms)`);
          attemptResults.push({ source: 'genius', success: true, duration: geniusDuration });
          this.saveToCache(geniusLyrics);
          this.logAttemptSummary(attemptResults, startTime);
          return geniusLyrics;
        }
        attemptResults.push({ source: 'genius', success: false, duration: geniusDuration });
      } catch (geniusErr) {
        attemptResults.push({ source: 'genius', success: false, error: geniusErr instanceof Error ? geniusErr.message : String(geniusErr), duration: Date.now() - geniusStart });
      }

      // 所有來源都失敗
      console.log(`🎵 [LyricsService] ❌ No lyrics found from any source`);
      this.logAttemptSummary(attemptResults, startTime);
      logger.warn(`⚠️ 無法找到歌詞: ${videoId} - ${title}`);
      return null;
    } catch (error) {
      console.error(`🎵 [LyricsService] ❌ Unexpected error:`, error);
      logger.error(`❌ 獲取歌詞失敗 (${videoId}):`, error);
      throw error;
    }
  }

  /**
   * 記錄嘗試摘要
   */
  private logAttemptSummary(
    attempts: { source: string; success: boolean; error?: string; duration: number }[],
    startTime: number
  ): void {
    const totalDuration = Date.now() - startTime;
    const summary = attempts.map(a =>
      `${a.source}: ${a.success ? '✅' : '❌'} (${a.duration}ms)${a.error ? ` [${a.error}]` : ''}`
    ).join(', ');
    console.log(`🎵 [LyricsService] Summary: ${summary} | Total: ${totalDuration}ms`);
    logger.info(`[LyricsService] Attempt summary: ${summary} | Total: ${totalDuration}ms`);
  }

  /**
   * 從 YouTube 字幕獲取同步歌詞（使用 yt-dlp）
   * 改進版：更好的超時處理和錯誤日誌
   */
  private async fetchYouTubeCaptions(videoId: string): Promise<Lyrics | null> {
    console.log(`🎬 [fetchYouTubeCaptions] START: videoId=${videoId}`);
    logger.info(`[YouTube CC] Starting subtitle fetch for: ${videoId}`);
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `${videoId}-subtitle`);

    // 設定 yt-dlp 執行超時（30 秒）
    const YT_DLP_TIMEOUT = 30000;

    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const languages = ['zh-Hant', 'zh-TW', 'zh', 'en'];

      for (const lang of languages) {
        try {
          console.log(`🎬 [fetchYouTubeCaptions] Trying language: ${lang}`);

          // 清理舊的臨時文件
          const subtitleFile = `${tempFile}.${lang}.vtt`;
          if (fs.existsSync(subtitleFile)) {
            fs.unlinkSync(subtitleFile);
          }

          // 使用 yt-dlp 下載字幕到臨時文件（加入超時）
          const ytdlpPromise = youtubedl(url, {
            skipDownload: true,
            writeAutoSub: true,
            writeSub: true,
            subLang: lang,
            subFormat: 'vtt',
            output: tempFile,
            noWarnings: true,
            quiet: true,
            noCheckCertificates: true, // 繞過 SSL 證書驗證（Docker 環境需要）
          });

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`yt-dlp timeout after ${YT_DLP_TIMEOUT}ms`)), YT_DLP_TIMEOUT);
          });

          await Promise.race([ytdlpPromise, timeoutPromise]);

          // 讀取字幕文件
          if (fs.existsSync(subtitleFile)) {
            const vttContent = fs.readFileSync(subtitleFile, 'utf-8');
            console.log(`🎬 [fetchYouTubeCaptions] Read ${vttContent.length} bytes for ${lang}`);

            // 清理臨時文件
            fs.unlinkSync(subtitleFile);

            // 解析 VTT 格式
            const lines = this.parseVTT(vttContent);

            if (lines.length > 0) {
              console.log(`🎬 [fetchYouTubeCaptions] Successfully parsed ${lines.length} lines for ${lang}`);
              logger.info(`✅ YouTube CC 成功 (${lang}): ${videoId}, ${lines.length} 行`);
              return {
                videoId,
                lines,
                source: 'youtube',
                isSynced: true,
                language: lang,
              };
            }
          } else {
            console.log(`🎬 [fetchYouTubeCaptions] Subtitle file not found for ${lang}`);
          }
        } catch (langError) {
          const errMsg = langError instanceof Error ? langError.message : String(langError);
          console.log(`🎬 [fetchYouTubeCaptions] Language ${lang} failed: ${errMsg}`);
          logger.warn(`[YouTube CC] Language ${lang} failed for ${videoId}: ${errMsg}`);
          continue;
        }
      }

      console.log(`🎬 [fetchYouTubeCaptions] No subtitles found for any language`);
      logger.info(`[YouTube CC] No subtitles found for: ${videoId}`);
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
    artist?: string
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
      const cleanTitle = this.cleanSongTitle(title);
      const cleanArtist = artist ? this.cleanArtistName(artist) : '';
      const searchQuery = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;

      console.log(`🎵 [NetEase] Searching: "${searchQuery}"`);
      logger.info(`[NetEase] Starting search for: ${searchQuery}`);

      // 搜尋歌曲（加入 timeout 和重試）
      const searchResult = await this.retryWithBackoff(
        () => withTimeout(neteaseApi.search(searchQuery), NETEASE_TIMEOUT),
        { maxRetries: 2, baseDelay: 1000, operationName: 'NetEase Search' }
      );

      if (!searchResult) {
        console.error(`🎵 [NetEase] Search API failed after retries`);
        return null;
      }

      if (!searchResult || !searchResult.result || !searchResult.result.songs || searchResult.result.songs.length === 0) {
        console.log(`🎵 [NetEase] No songs found for: ${searchQuery}`);
        return null;
      }

      const songs = searchResult.result.songs as NeteaseSongResult[];
      console.log(`🎵 [NetEase] Found ${songs.length} songs`);

      // 選擇最匹配的歌曲（第一個結果通常最相關）
      const song = songs[0];
      console.log(`🎵 [NetEase] Using song: ${song.name} by ${song.artists?.map(a => a.name).join(', ') || 'Unknown'} (ID: ${song.id})`);

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

      return {
        videoId,
        lines,
        source: 'netease',
        isSynced: true,
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
    artist?: string
  ): Promise<Lyrics | null> {
    try {
      // 清理標題（移除常見的 MV、Official Video 等後綴）
      const cleanTitle = this.cleanSongTitle(title);
      const cleanArtist = artist ? this.cleanArtistName(artist) : '';

      console.log(`🎼 [LRCLIB] Searching: "${cleanTitle}" by "${cleanArtist}"`);
      logger.info(`[LRCLIB] Starting search for: ${cleanTitle}`);

      // 使用 search API（只用歌名搜尋，因為藝術家名稱可能有不同語言版本）
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`;
      console.log(`🎼 [LRCLIB] Fetching: ${url}`);

      // 使用 https 模組來繞過 SSL 問題，增加超時時間和重試
      const response = await this.retryWithBackoff(
        async () => {
          const res = await this.fetchWithSSLBypass(url, 25000);
          if (!res.ok) {
            throw new Error(`API returned status ${res.status}`);
          }
          return res;
        },
        { maxRetries: 2, baseDelay: 1500, operationName: 'LRCLIB Fetch' }
      );

      if (!response) {
        console.error(`🎼 [LRCLIB] API failed after retries`);
        return null;
      }

      let results: LRCLIBResponse[];
      try {
        results = (await response.json()) as LRCLIBResponse[];
      } catch (parseErr) {
        console.error(`🎼 [LRCLIB] JSON parse error:`, parseErr);
        logger.error(`[LRCLIB] JSON parse error:`, parseErr);
        return null;
      }

      console.log(`🎼 [LRCLIB] Search returned ${results.length} results`);

      if (!results || results.length === 0) {
        console.log(`🎼 [LRCLIB] No lyrics found for: ${cleanTitle}`);
        return null;
      }

      // 優先選擇有同步歌詞的結果
      const data = results.find(r => r.syncedLyrics) || results[0];
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
      // 匹配時間戳: [mm:ss.xx] 或 [mm:ss]
      const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]\s*(.*)$/);
      if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;
        const text = match[4].trim();

        const timeInSeconds = minutes * 60 + seconds + milliseconds / 1000;

        if (text) {
          lines.push({ time: timeInSeconds, text });
        }
      }
    }

    return lines;
  }

  /**
   * 使用 https 模組發送請求，繞過 SSL 驗證
   * 改進版：更長的超時時間，更好的錯誤處理
   */
  private fetchWithSSLBypass(url: string, timeout: number = 30000): Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }> {
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
  private cleanSongTitle(title: string): string {
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

    // 1. 優先提取中文括號【】或《》內的歌名
    const chineseBracketMatch = normalized.match(/[【《]([^【】《》]+)[】》]/);
    if (chineseBracketMatch) {
      const extracted = chineseBracketMatch[1].trim();
      console.log(`🎵 [cleanSongTitle] 從中文括號提取: "${extracted}" (原始: "${title}")`);
      return extracted;
    }

    // 2. 移除常見後綴（包含中文和英文）
    let cleaned = normalized
      .replace(/\s*[\(\[【《].*?(official|mv|music video|lyric|lyrics|audio|hd|hq|4k|1080p|官方|完整版|高音質|歌詞).*?[\)\]】》]/gi, '')
      .replace(/\s*-\s*(official|mv|music video|lyric|lyrics|audio).*$/gi, '')
      .replace(/\s*(official|mv|music video|lyrics?|lyric video)$/gi, '')
      .replace(/[✨🎵🎶💕❤️🔥⭐️🌟💫]/g, '') // 移除常見表情符號
      .trim();

    // 3. 嘗試提取 - 後面的歌名（常見格式：Artist - Song）
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
   * 清理藝術家名稱
   */
  private cleanArtistName(artist: string): string {
    return artist
      .replace(/\s*-\s*topic$/i, '') // YouTube 自動生成的頻道
      .replace(/\s*vevo$/i, '')
      .replace(/\s*official$/i, '')
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
            .replace(/\{[^}]+\}/g, ''); // 移除 VTT 樣式標籤

          if (text) {
            lines.push({ time: timeInSeconds, text });
          }
        }
      }
      i++;
    }

    return lines;
  }

  /**
   * 從 Genius 獲取歌詞（通常沒有時間戳）
   */
  private async fetchGeniusLyrics(
    videoId: string,
    title: string,
    artist?: string
  ): Promise<Lyrics | null> {
    try {
      // Genius API 需要 API key（從環境變數獲取）
      const apiKey = process.env.GENIUS_API_KEY || '';
      if (!apiKey) {
        logger.warn('⚠️ Genius API key 未設置，跳過 Genius 查詢');
        return null;
      }

      const options = {
        apiKey,
        title,
        artist: artist || '',
        optimizeQuery: true,
      };

      const song = await getSong(options);
      if (!song || !song.lyrics) {
        return null;
      }

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
   * 清除過期的快取（可選，例如 30 天）
   */
  clearExpiredCache(daysOld: number = 30): number {
    try {
      const expiryTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const stmt = db.prepare('DELETE FROM lyrics_cache WHERE cached_at < ?');
      const result = stmt.run(expiryTime);
      logger.info(`🗑️ 清除了 ${result.changes} 個過期歌詞快取`);
      return result.changes;
    } catch (error) {
      logger.error('清除歌詞快取失敗:', error);
      return 0;
    }
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
  async getLyricsByLRCLIBId(videoId: string, lrclibId: number): Promise<Lyrics | null> {
    try {
      console.log(`🎼 [LRCLIB] Fetching lyrics by ID: ${lrclibId}`);

      const url = `https://lrclib.net/api/get/${lrclibId}`;
      const response = await this.fetchWithSSLBypass(url);

      if (!response.ok) {
        throw new Error(`LRCLIB API error: ${response.status}`);
      }

      const data = (await response.json()) as LRCLIBResponse;

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
        artistName: song.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
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
  async getLyricsByNeteaseId(videoId: string, neteaseId: number): Promise<Lyrics | null> {
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

  /**
   * 更新歌詞偏好設定
   */
  updatePreferences(videoId: string, prefs: { timeOffset?: number; lrclibId?: number | null; neteaseId?: number | null }): void {
    try {
      const now = Date.now();
      const existing = this.getPreferences(videoId);

      if (existing) {
        // 更新現有記錄
        db.prepare(`
          UPDATE lyrics_preferences
          SET time_offset = COALESCE(?, time_offset),
              lrclib_id = COALESCE(?, lrclib_id),
              netease_id = COALESCE(?, netease_id),
              updated_at = ?
          WHERE video_id = ?
        `).run(
          prefs.timeOffset !== undefined ? prefs.timeOffset : null,
          prefs.lrclibId !== undefined ? prefs.lrclibId : null,
          prefs.neteaseId !== undefined ? prefs.neteaseId : null,
          now,
          videoId
        );
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
