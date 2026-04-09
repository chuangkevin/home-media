import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from './environment';

// 確保資料庫目錄存在
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  try {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`✅ Created database directory: ${dbDir}`);
  } catch (err) {
    console.error(`❌ Failed to create database directory: ${dbDir}`, err);
  }
}

// 建立資料庫連接
let db: BetterSqlite3.Database;

try {
  console.log(`📂 Opening database at: ${config.database.path}`);
  db = new Database(config.database.path, {
    verbose: config.env === 'development' ? console.log : undefined,
  });

  // 啟用 WAL 模式以提升並發性能
  db.pragma('journal_mode = WAL');
  console.log('✅ Database connection established');
} catch (err) {
  console.error('❌ Failed to open database:', err);
  // 創建一個空的 mock 來避免應用崩潰，但所有操作會失敗
  throw new Error(`Database initialization failed: ${err instanceof Error ? err.message : String(err)}`);
}

export { db };

// 初始化資料庫 schema
export function initDatabase() {
  // Playlists 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Tracks 表（快取元資料）
  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_tracks (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT,
      duration INTEGER NOT NULL,
      thumbnail TEXT,
      file_path TEXT,
      file_size INTEGER,
      last_played INTEGER NOT NULL,
      play_count INTEGER DEFAULT 0,
      cached_at INTEGER NOT NULL
    )
  `);

  // PlaylistTracks 表（播放清單與曲目關聯）
  db.exec(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES cached_tracks(id) ON DELETE CASCADE
    )
  `);

  // Lyrics 快取表
  db.exec(`
    CREATE TABLE IF NOT EXISTS lyrics_cache (
      video_id TEXT PRIMARY KEY,
      lyrics TEXT NOT NULL,
      source TEXT NOT NULL,
      is_synced INTEGER DEFAULT 0,
      cached_at INTEGER NOT NULL
    )
  `);

  // Genre 快取表
  db.exec(`
    CREATE TABLE IF NOT EXISTS genre_cache (
      video_id TEXT PRIMARY KEY,
      genre TEXT NOT NULL,
      confidence REAL NOT NULL,
      detected_at INTEGER NOT NULL
    )
  `);

  // Track styles 表（AI 推薦系統）
  db.exec(`
    CREATE TABLE IF NOT EXISTS track_styles (
      video_id TEXT PRIMARY KEY,
      mood TEXT NOT NULL,
      genre TEXT NOT NULL,
      subgenre TEXT,
      energy TEXT NOT NULL,
      language TEXT,
      themes TEXT,
      analyzed_at INTEGER NOT NULL
    )
  `);

  // 搜尋歷史表
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL UNIQUE,
      search_count INTEGER DEFAULT 1,
      last_searched_at INTEGER NOT NULL,
      first_searched_at INTEGER NOT NULL,
      result_count INTEGER DEFAULT 0
    )
  `);

  // 觀看頻道表
  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_channels (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      channel_name TEXT NOT NULL UNIQUE,
      channel_thumbnail TEXT,
      watch_count INTEGER DEFAULT 1,
      last_watched_at INTEGER NOT NULL,
      first_watched_at INTEGER NOT NULL
    )
  `);

  // 頻道影片快取表（24小時）
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_videos_cache (
      channel_name TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail TEXT,
      duration INTEGER NOT NULL,
      views INTEGER,
      uploaded_at TEXT,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (channel_name, video_id)
    )
  `);

  // 推薦結果快取表（6小時）
  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendations_cache (
      id TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL,
      videos_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // 搜尋結果快取表（1小時）
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_results_cache (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      results_json TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      cached_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  // 歌詞偏好設定表（跨裝置同步）
  db.exec(`
    CREATE TABLE IF NOT EXISTS lyrics_preferences (
      video_id TEXT PRIMARY KEY,
      time_offset REAL DEFAULT 0,
      lrclib_id INTEGER,
      netease_id INTEGER,
      updated_at INTEGER NOT NULL
    )
  `);

  // 為 lyrics_preferences 添加 netease_id 欄位（如果不存在）
  const lyricsPrefsInfo = db.pragma('table_info(lyrics_preferences)') as Array<{ name: string }>;
  const hasNeteaseId = lyricsPrefsInfo.some((col) => col.name === 'netease_id');
  
  if (!hasNeteaseId) {
    db.exec(`ALTER TABLE lyrics_preferences ADD COLUMN netease_id INTEGER`);
    console.log('✅ Added netease_id column to lyrics_preferences table');
  }

  // 為 cached_tracks 添加頻道資訊欄位（如果不存在）
  // 使用 ALTER TABLE 的安全方式
  const tableInfo = db.pragma('table_info(cached_tracks)') as Array<{ name: string }>;
  const hasChannelName = tableInfo.some((col) => col.name === 'channel_name');
  const hasTags = tableInfo.some((col) => col.name === 'tags');
  const hasCategory = tableInfo.some((col) => col.name === 'category');
  const hasLanguage = tableInfo.some((col) => col.name === 'language');
  const hasSpotifyId = tableInfo.some((col) => col.name === 'spotify_id');
  const hasGenres = tableInfo.some((col) => col.name === 'genres');
  const hasAudioFeatures = tableInfo.some((col) => col.name === 'audio_features');
  const hasCountry = tableInfo.some((col) => col.name === 'country');

  if (!hasChannelName) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN channel_name TEXT`);
  }
  if (!hasTags) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN tags TEXT`); // JSON array
  }
  if (!hasCategory) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN category TEXT`);
  }
  if (!hasLanguage) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN language TEXT`);
  }
  if (!hasSpotifyId) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN spotify_id TEXT`);
  }
  if (!hasGenres) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN genres TEXT`); // JSON array from Spotify
  }
  if (!hasAudioFeatures) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN audio_features TEXT`); // JSON object from Spotify
  }
  if (!hasCountry) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN country TEXT`);
  }

  const hasSkipCount = tableInfo.some((col) => col.name === 'skip_count');
  const hasCompleteCount = tableInfo.some((col) => col.name === 'complete_count');

  if (!hasSkipCount) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN skip_count INTEGER DEFAULT 0`);
  }
  if (!hasCompleteCount) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN complete_count INTEGER DEFAULT 0`);
  }

  // 建立索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cached_tracks_last_played ON cached_tracks(last_played);
    CREATE INDEX IF NOT EXISTS idx_cached_tracks_channel ON cached_tracks(channel_name);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
    CREATE INDEX IF NOT EXISTS idx_search_history_last ON search_history(last_searched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_search_history_count ON search_history(search_count DESC);
    CREATE INDEX IF NOT EXISTS idx_watched_channels_last ON watched_channels(last_watched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_watched_channels_count ON watched_channels(watch_count DESC);
    CREATE INDEX IF NOT EXISTS idx_channel_cache ON channel_videos_cache(channel_name, cached_at DESC);
    CREATE INDEX IF NOT EXISTS idx_recommendations_cache ON recommendations_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_search_results_cache ON search_results_cache(query, expires_at);
    CREATE INDEX IF NOT EXISTS idx_track_styles_mood ON track_styles(mood);
    CREATE INDEX IF NOT EXISTS idx_track_styles_genre ON track_styles(genre);
  `);

  // Hidden channels 表（用戶隱藏的頻道）
  db.exec(`
    CREATE TABLE IF NOT EXISTS hidden_channels (
      channel_name TEXT PRIMARY KEY,
      hidden_at INTEGER NOT NULL
    )
  `);

  // Blocked items 表（封鎖的歌曲與頻道）
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('song', 'channel')),
      video_id TEXT,
      channel_name TEXT,
      title TEXT NOT NULL,
      thumbnail TEXT,
      blocked_at INTEGER NOT NULL
    )
  `);

  // 收藏表
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      channel TEXT,
      thumbnail TEXT,
      duration INTEGER DEFAULT 0,
      favorited_at INTEGER NOT NULL
    )
  `);

  // Settings 表（系統設定）
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('string', 'number', 'boolean')),
      updated_at INTEGER NOT NULL
    )
  `);

  // 初始化預設設定
  const defaultSettings = [
    { key: 'site_title', value: 'Home Media', type: 'string' },
    { key: 'cache_duration', value: '86400000', type: 'number' },
    { key: 'enable_lyrics', value: 'true', type: 'boolean' },
    { key: 'auto_play', value: 'true', type: 'boolean' },
    { key: 'theme_mode', value: 'dark', type: 'string' },
    { key: 'audio_cache_ttl_days', value: '30', type: 'number' },
    { key: 'audio_cache_max_size_gb', value: '2', type: 'number' },
    { key: 'audio_cache_max_entries', value: '200', type: 'number' },
  ];

  const settingsStmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, type, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  const now = Date.now();
  for (const setting of defaultSettings) {
    settingsStmt.run(setting.key, setting.value, setting.type, now);
  }

  console.log('✅ Database initialized successfully');
}

// Export both default and named export for compatibility
export function getDatabase(): BetterSqlite3.Database {
  return db;
}

export default db;
