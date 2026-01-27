import { Request, Response } from 'express';
import playlistService from '../services/playlist.service';
import logger from '../utils/logger';

export class PlaylistController {
  /**
   * GET /api/playlists
   * 獲取所有播放清單
   */
  async getAll(_req: Request, res: Response): Promise<void> {
    try {
      const playlists = playlistService.getAll();
      res.json({ playlists });
    } catch (error) {
      logger.error('Get playlists error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get playlists',
      });
    }
  }

  /**
   * GET /api/playlists/:id
   * 獲取單一播放清單（含曲目）
   */
  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const playlist = playlistService.getById(id);
      if (!playlist) {
        res.status(404).json({ error: 'Playlist not found' });
        return;
      }

      res.json(playlist);
    } catch (error) {
      logger.error('Get playlist error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get playlist',
      });
    }
  }

  /**
   * POST /api/playlists
   * 建立新的播放清單
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      const { name, description } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Playlist name is required' });
        return;
      }

      const playlist = playlistService.create(name.trim(), description?.trim());
      res.status(201).json(playlist);
    } catch (error) {
      logger.error('Create playlist error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to create playlist',
      });
    }
  }

  /**
   * PUT /api/playlists/:id
   * 更新播放清單資訊
   */
  async update(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { name, description } = req.body;

      const success = playlistService.update(id, name?.trim(), description?.trim());
      if (!success) {
        res.status(404).json({ error: 'Playlist not found or no changes made' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Update playlist error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to update playlist',
      });
    }
  }

  /**
   * DELETE /api/playlists/:id
   * 刪除播放清單
   */
  async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const success = playlistService.delete(id);
      if (!success) {
        res.status(404).json({ error: 'Playlist not found' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Delete playlist error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to delete playlist',
      });
    }
  }

  /**
   * POST /api/playlists/:id/tracks
   * 新增曲目到播放清單
   */
  async addTrack(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { track } = req.body;

      if (!track || !track.videoId || !track.title) {
        res.status(400).json({ error: 'Track information is required' });
        return;
      }

      const success = playlistService.addTrack(id, track);
      if (!success) {
        res.status(409).json({ error: 'Track already exists in playlist' });
        return;
      }

      res.status(201).json({ success: true });
    } catch (error) {
      logger.error('Add track error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to add track',
      });
    }
  }

  /**
   * POST /api/playlists/:id/tracks/batch
   * 批量新增曲目到播放清單
   */
  async addTracks(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { tracks } = req.body;

      if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
        res.status(400).json({ error: 'Tracks array is required' });
        return;
      }

      const added = playlistService.addTracks(id, tracks);
      res.status(201).json({ success: true, added });
    } catch (error) {
      logger.error('Add tracks error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to add tracks',
      });
    }
  }

  /**
   * DELETE /api/playlists/:id/tracks/:trackId
   * 從播放清單移除曲目
   */
  async removeTrack(req: Request, res: Response): Promise<void> {
    try {
      const { id, trackId } = req.params;

      const success = playlistService.removeTrack(id, trackId);
      if (!success) {
        res.status(404).json({ error: 'Track not found in playlist' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Remove track error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to remove track',
      });
    }
  }

  /**
   * PUT /api/playlists/:id/tracks/:trackId/move
   * 移動曲目位置
   */
  async moveTrack(req: Request, res: Response): Promise<void> {
    try {
      const { id, trackId } = req.params;
      const { position } = req.body;

      if (typeof position !== 'number' || position < 0) {
        res.status(400).json({ error: 'Valid position is required' });
        return;
      }

      const success = playlistService.moveTrack(id, trackId, position);
      if (!success) {
        res.status(404).json({ error: 'Track not found in playlist' });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      logger.error('Move track error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to move track',
      });
    }
  }

  /**
   * DELETE /api/playlists/:id/tracks
   * 清空播放清單
   */
  async clearTracks(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const removed = playlistService.clearTracks(id);
      res.json({ success: true, removed });
    } catch (error) {
      logger.error('Clear tracks error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clear tracks',
      });
    }
  }
}

export default new PlaylistController();
