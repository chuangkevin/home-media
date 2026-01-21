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

  // 建立索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cached_tracks_last_played ON cached_tracks(last_played);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_position ON playlist_tracks(playlist_id, position);
  `);

  console.log('✅ Database initialized successfully');
}

export default db;
