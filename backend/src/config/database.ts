import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from './environment';

// 確保資料庫目錄存在
const dbDir = path.dirname(config.database.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 建立資料庫連接
export const db = new Database(config.database.path, {
  verbose: config.env === 'development' ? console.log : undefined,
});

// 啟用 WAL 模式以提升並發性能
db.pragma('journal_mode = WAL');

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

  // 為 cached_tracks 添加頻道資訊欄位（如果不存在）
  // 使用 ALTER TABLE 的安全方式
  const tableInfo = db.pragma('table_info(cached_tracks)') as Array<{ name: string }>;
  const hasChannelName = tableInfo.some((col) => col.name === 'channel_name');

  if (!hasChannelName) {
    db.exec(`ALTER TABLE cached_tracks ADD COLUMN channel_name TEXT`);
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
  `);

  console.log('✅ Database initialized successfully');
}

export default db;
