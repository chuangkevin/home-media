import { db } from '../config/database';
import crypto from 'crypto';
import logger from '../utils/logger';

// 型別定義
export interface Track {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  views?: number;
  uploadedAt?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

class PlaylistService {
  /**
   * 建立新的播放清單
   */
  create(name: string, description?: string): Playlist {
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO playlists (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description || null, now, now);

    logger.info(`✅ Created playlist: ${name} (${id})`);

    return {
      id,
      name,
      description,
      trackCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 獲取所有播放清單
   */
  getAll(): Playlist[] {
    const rows = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_at,
        p.updated_at,
        COUNT(pt.track_id) as track_count
      FROM playlists p
      LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      created_at: number;
      updated_at: number;
      track_count: number;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      trackCount: row.track_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * 獲取單一播放清單（含曲目）
   */
  getById(playlistId: string): PlaylistWithTracks | null {
    const playlist = db.prepare(`
      SELECT id, name, description, created_at, updated_at
      FROM playlists
      WHERE id = ?
    `).get(playlistId) as {
      id: string;
      name: string;
      description: string | null;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!playlist) {
      return null;
    }

    const tracks = this.getTracks(playlistId);

    return {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description || undefined,
      trackCount: tracks.length,
      createdAt: playlist.created_at,
      updatedAt: playlist.updated_at,
      tracks,
    };
  }

  /**
   * 更新播放清單資訊
   */
  update(playlistId: string, name?: string, description?: string): boolean {
    const now = Date.now();
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }

    if (updates.length === 0) {
      return false;
    }

    updates.push('updated_at = ?');
    values.push(now);
    values.push(playlistId);

    const result = db.prepare(`
      UPDATE playlists
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);

    return result.changes > 0;
  }

  /**
   * 刪除播放清單
   */
  delete(playlistId: string): boolean {
    // playlist_tracks 會因為 ON DELETE CASCADE 自動刪除
    const result = db.prepare(`
      DELETE FROM playlists WHERE id = ?
    `).run(playlistId);

    if (result.changes > 0) {
      logger.info(`🗑️ Deleted playlist: ${playlistId}`);
    }

    return result.changes > 0;
  }

  /**
   * 獲取播放清單中的曲目
   */
  getTracks(playlistId: string): Track[] {
    const rows = db.prepare(`
      SELECT
        ct.id,
        ct.video_id,
        ct.title,
        ct.channel_name,
        ct.duration,
        ct.thumbnail
      FROM playlist_tracks pt
      JOIN cached_tracks ct ON pt.track_id = ct.id
      WHERE pt.playlist_id = ?
      ORDER BY pt.position ASC
    `).all(playlistId) as Array<{
      id: string;
      video_id: string;
      title: string;
      channel_name: string | null;
      duration: number;
      thumbnail: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      videoId: row.video_id,
      title: row.title,
      channel: row.channel_name || '',
      duration: row.duration,
      thumbnail: row.thumbnail || '',
    }));
  }

  /**
   * 確保曲目存在於 cached_tracks 表
   */
  private ensureTrackExists(track: Track): string {
    // 檢查是否已存在
    const existing = db.prepare(`
      SELECT id FROM cached_tracks WHERE video_id = ?
    `).get(track.videoId) as { id: string } | undefined;

    if (existing) {
      return existing.id;
    }

    // 不存在則建立
    const id = track.id || crypto.randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO cached_tracks (id, video_id, title, channel_name, duration, thumbnail, last_played, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, track.videoId, track.title, track.channel, track.duration, track.thumbnail, now, now);

    return id;
  }

  /**
   * 新增曲目到播放清單
   */
  addTrack(playlistId: string, track: Track): boolean {
    // 確保曲目存在
    const trackId = this.ensureTrackExists(track);

    // 檢查是否已在播放清單中
    const existing = db.prepare(`
      SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
    `).get(playlistId, trackId);

    if (existing) {
      return false; // 已存在
    }

    // 獲取目前最大 position
    const maxPos = db.prepare(`
      SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?
    `).get(playlistId) as { max_pos: number | null };

    const position = (maxPos.max_pos ?? -1) + 1;
    const now = Date.now();

    db.prepare(`
      INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
      VALUES (?, ?, ?, ?)
    `).run(playlistId, trackId, position, now);

    // 更新播放清單的 updated_at
    db.prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`).run(now, playlistId);

    logger.info(`➕ Added track to playlist: ${track.title} -> ${playlistId}`);
    return true;
  }

  /**
   * 批量新增曲目到播放清單
   */
  addTracks(playlistId: string, tracks: Track[]): number {
    let added = 0;
    const transaction = db.transaction(() => {
      for (const track of tracks) {
        if (this.addTrack(playlistId, track)) {
          added++;
        }
      }
    });
    transaction();
    return added;
  }

  /**
   * 從播放清單移除曲目
   */
  removeTrack(playlistId: string, trackId: string): boolean {
    const result = db.prepare(`
      DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
    `).run(playlistId, trackId);

    if (result.changes > 0) {
      // 重新排序 position
      this.reorderPositions(playlistId);
      // 更新 updated_at
      db.prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`).run(Date.now(), playlistId);
    }

    return result.changes > 0;
  }

  /**
   * 移動曲目位置
   */
  moveTrack(playlistId: string, trackId: string, newPosition: number): boolean {
    // 獲取當前位置
    const current = db.prepare(`
      SELECT position FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?
    `).get(playlistId, trackId) as { position: number } | undefined;

    if (!current) {
      return false;
    }

    const oldPosition = current.position;
    if (oldPosition === newPosition) {
      return true;
    }

    const transaction = db.transaction(() => {
      if (newPosition < oldPosition) {
        // 向上移動：中間的項目向下移
        db.prepare(`
          UPDATE playlist_tracks
          SET position = position + 1
          WHERE playlist_id = ? AND position >= ? AND position < ?
        `).run(playlistId, newPosition, oldPosition);
      } else {
        // 向下移動：中間的項目向上移
        db.prepare(`
          UPDATE playlist_tracks
          SET position = position - 1
          WHERE playlist_id = ? AND position > ? AND position <= ?
        `).run(playlistId, oldPosition, newPosition);
      }

      // 更新目標項目的位置
      db.prepare(`
        UPDATE playlist_tracks
        SET position = ?
        WHERE playlist_id = ? AND track_id = ?
      `).run(newPosition, playlistId, trackId);

      // 更新 updated_at
      db.prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`).run(Date.now(), playlistId);
    });

    transaction();
    return true;
  }

  /**
   * 重新排序 position（消除空隙）
   */
  private reorderPositions(playlistId: string): void {
    const tracks = db.prepare(`
      SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC
    `).all(playlistId) as Array<{ track_id: string }>;

    const transaction = db.transaction(() => {
      tracks.forEach((track, index) => {
        db.prepare(`
          UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?
        `).run(index, playlistId, track.track_id);
      });
    });

    transaction();
  }

  /**
   * 清空播放清單
   */
  clearTracks(playlistId: string): number {
    const result = db.prepare(`
      DELETE FROM playlist_tracks WHERE playlist_id = ?
    `).run(playlistId);

    if (result.changes > 0) {
      db.prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`).run(Date.now(), playlistId);
    }

    return result.changes;
  }
}

export default new PlaylistService();
