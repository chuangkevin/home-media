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
   * 獲取歌詞（優先從快取，然後嘗試 YouTube CC，最後嘗試 Genius）
   */
  async getLyrics(videoId: string, title: string, artist?: string): Promise<Lyrics | null> {
    console.log(`🎵 [LyricsService.getLyrics] START: videoId=${videoId}, title=${title}`);
    try {
      console.log(`🎵 [LyricsService] Step 1: Checking cache...`);
      // 1. 檢查快取
      const cached = this.getFromCache(videoId);
      if (cached) {
        console.log(`🎵 [LyricsService] Cache hit!`);
        logger.info(`📝 使用快取的歌詞: ${videoId}`);
        return cached;
      }

      console.log(`🎵 [LyricsService] Step 2: Fetching from YouTube CC...`);
      // 2. 嘗試從 YouTube 字幕獲取（通常有時間戳）
      logger.info(`🔍 嘗試從 YouTube CC 獲取歌詞: ${videoId}`);
      const youtubeLyrics = await this.fetchYouTubeCaptions(videoId);
      console.log(`🎵 [LyricsService] YouTube CC result:`, youtubeLyrics ? 'Found' : 'Not found');
      if (youtubeLyrics) {
        this.saveToCache(youtubeLyrics);
        return youtubeLyrics;
      }

      console.log(`🎵 [LyricsService] Step 3: Fetching from NetEase...`);
      // 3. 嘗試從網易雲音樂獲取（華語歌詞最齊全）
      logger.info(`🔍 嘗試從網易雲音樂獲取歌詞: ${title} - ${artist}`);
      const neteaseLyrics = await this.fetchNeteaseLyrics(videoId, title, artist);
      console.log(`🎵 [LyricsService] NetEase result:`, neteaseLyrics ? 'Found' : 'Not found');
      if (neteaseLyrics) {
        this.saveToCache(neteaseLyrics);
        return neteaseLyrics;
      }

      console.log(`🎵 [LyricsService] Step 4: Fetching from LRCLIB...`);
      // 4. 嘗試從 LRCLIB 獲取（有時間戳的 LRC 格式）
      logger.info(`🔍 嘗試從 LRCLIB 獲取歌詞: ${title} - ${artist}`);
      const lrclibLyrics = await this.fetchLRCLIB(videoId, title, artist);
      console.log(`🎵 [LyricsService] LRCLIB result:`, lrclibLyrics ? 'Found' : 'Not found');
      if (lrclibLyrics) {
        this.saveToCache(lrclibLyrics);
        return lrclibLyrics;
      }

      // 5. 嘗試從 Genius 獲取（通常沒有時間戳，最後備用）
      logger.info(`🔍 嘗試從 Genius 獲取歌詞: ${title} - ${artist}`);
      const geniusLyrics = await this.fetchGeniusLyrics(videoId, title, artist);
      if (geniusLyrics) {
        this.saveToCache(geniusLyrics);
        return geniusLyrics;
      }

      logger.warn(`⚠️ 無法找到歌詞: ${videoId}`);
      return null;
    } catch (error) {
      logger.error(`❌ 獲取歌詞失敗 (${videoId}):`, error);
      throw error;
    }
  }

  /**
   * 從 YouTube 字幕獲取同步歌詞（使用 yt-dlp）
   */
  private async fetchYouTubeCaptions(videoId: string): Promise<Lyrics | null> {
    console.log(`🎬 [fetchYouTubeCaptions] START: videoId=${videoId}`);
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `${videoId}-subtitle`);

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

          // 使用 yt-dlp 下載字幕到臨時文件
          await youtubedl(url, {
            skipDownload: true,
            writeAutoSub: true,
            writeSub: true,
            subLang: lang,
            subFormat: 'vtt',
            output: tempFile,
            noWarnings: true,
            quiet: true,
            noCheckCertificates: true, // 繞過 SSL 證書驗證
          });

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
          console.log(`🎬 [fetchYouTubeCaptions] Language ${lang} failed:`, langError instanceof Error ? langError.message : String(langError));
          continue;
        }
      }

      console.log(`🎬 [fetchYouTubeCaptions] No subtitles found`);
      return null;
    } catch (error) {
      console.log(`🎬 [fetchYouTubeCaptions] ERROR:`, error);
      logger.error(`YouTube CC 獲取失敗 (${videoId}):`, error);
      return null;
    } finally {
      // 清理所有可能的臨時文件
      try {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
          if (file.startsWith(`${videoId}-subtitle`)) {
            fs.unlinkSync(path.join(tempDir, file));
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
    // 設定 15 秒 timeout
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
      const cleanTitle = this.cleanSongTitle(title);
      const cleanArtist = artist ? this.cleanArtistName(artist) : '';
      const searchQuery = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle;

      console.log(`🎵 [NetEase] Searching: "${searchQuery}"`);

      // 搜尋歌曲（加入 timeout）
      const searchResult = await withTimeout(neteaseApi.search(searchQuery), NETEASE_TIMEOUT);

      if (!searchResult || !searchResult.result || !searchResult.result.songs || searchResult.result.songs.length === 0) {
        console.log(`🎵 [NetEase] No songs found for: ${searchQuery}`);
        return null;
      }

      const songs = searchResult.result.songs as NeteaseSongResult[];
      console.log(`🎵 [NetEase] Found ${songs.length} songs`);

      // 選擇最匹配的歌曲（第一個結果通常最相關）
      const song = songs[0];
      console.log(`🎵 [NetEase] Using song: ${song.name} by ${song.artists.map(a => a.name).join(', ')} (ID: ${song.id})`);

      // 獲取歌詞（加入 timeout）
      const lyricResult = await withTimeout(
        neteaseApi.lyric(String(song.id)),
        NETEASE_TIMEOUT
      ) as NeteaseLyricResponse;

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
      console.log(`🎵 [NetEase] Error:`, error instanceof Error ? error.message : String(error));
      logger.error(`網易雲音樂獲取失敗 (${videoId}):`, error);
      return null;
    }
  }

  /**
   * 從 LRCLIB 獲取同步歌詞（LRC 格式）
   * LRCLIB 是免費的歌詞 API，提供同步歌詞
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

      // 使用 search API（只用歌名搜尋，因為藝術家名稱可能有不同語言版本）
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`;
      console.log(`🎼 [LRCLIB] Fetching: ${url}`);

      // 使用 https 模組來繞過 SSL 問題
      const response = await this.fetchWithSSLBypass(url);

      if (!response.ok) {
        throw new Error(`LRCLIB API error: ${response.status}`);
      }

      const results = (await response.json()) as LRCLIBResponse[];
      console.log(`🎼 [LRCLIB] Search returned ${results.length} results`);

      if (!results || results.length === 0) {
        console.log(`🎼 [LRCLIB] No lyrics found for: ${cleanTitle}`);
        return null;
      }

      // 優先選擇有同步歌詞的結果
      const data = results.find(r => r.syncedLyrics) || results[0];

      // 優先使用同步歌詞
      if (data.syncedLyrics) {
        const lines = this.parseLRC(data.syncedLyrics);
        if (lines.length > 0) {
          console.log(`🎼 [LRCLIB] Found ${lines.length} synced lines`);
          logger.info(`✅ LRCLIB 成功 (同步): ${videoId}, ${lines.length} 行`);
          return {
            videoId,
            lines,
            source: 'lrclib', // 使用 musixmatch 作為 LRCLIB 的標識
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
      console.log(`🎼 [LRCLIB] Error:`, error instanceof Error ? error.message : String(error));
      logger.error(`LRCLIB 獲取失敗 (${videoId}):`, error);
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
   */
  private fetchWithSSLBypass(url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const urlObj = new URL(url);

      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        rejectUnauthorized: false, // 繞過 SSL 驗證
        headers: {
          'User-Agent': 'HomeMediaPlayer/1.0.0 (https://github.com/user/home-media)',
        },
      };

      const req = https.request(options, (res: { statusCode: number; on: (event: string, callback: (data?: unknown) => void) => void }) => {
        let data = '';
        res.on('data', (chunk: unknown) => {
          data += String(chunk);
        });
        res.on('end', () => {
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            json: () => Promise.resolve(JSON.parse(data)),
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.end();
    });
  }

  /**
   * 清理歌曲標題（移除常見後綴，提取真正的歌名）
   */
  private cleanSongTitle(title: string): string {
    // 1. 優先提取中文括號【】或《》內的歌名
    const chineseBracketMatch = title.match(/[【《]([^【】《》]+)[】》]/);
    if (chineseBracketMatch) {
      return chineseBracketMatch[1].trim();
    }

    // 2. 嘗試提取 - 後面的歌名（常見格式：Artist - Song）
    const dashMatch = title.match(/[-–—]\s*(.+?)(?:\s*[\(\[【]|$)/);
    if (dashMatch && !dashMatch[1].match(/official|mv|music|video|audio|lyrics/i)) {
      return dashMatch[1].trim();
    }

    // 3. 移除常見後綴
    let cleaned = title
      .replace(/\s*[\(\[【].*?(official|mv|music video|lyric|audio|hd|hq|4k|1080p|官方|完整版|高音質|lyrics?).*?[\)\]】]/gi, '')
      .replace(/\s*-\s*(official|mv|music video|lyric|audio).*$/gi, '')
      .replace(/\s*(official|mv|music video|lyrics?)$/gi, '')
      .trim();

    // 4. 如果標題開頭有藝術家名稱（通常以空格分隔），嘗試移除
    // 例如："原子邦妮 Astro Bunny 在名為未來的波浪裡" -> "在名為未來的波浪裡"
    // 這個很難自動判斷，所以只移除明確的模式

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
}

export default new LyricsService();
