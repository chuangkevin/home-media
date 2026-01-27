import { Router } from 'express';
import playlistController from '../controllers/playlist.controller';

const router = Router();

// 播放清單 CRUD
router.get('/playlists', (req, res) => playlistController.getAll(req, res));
router.get('/playlists/:id', (req, res) => playlistController.getById(req, res));
router.post('/playlists', (req, res) => playlistController.create(req, res));
router.put('/playlists/:id', (req, res) => playlistController.update(req, res));
router.delete('/playlists/:id', (req, res) => playlistController.delete(req, res));

// 播放清單曲目管理
router.post('/playlists/:id/tracks', (req, res) => playlistController.addTrack(req, res));
router.post('/playlists/:id/tracks/batch', (req, res) => playlistController.addTracks(req, res));
router.delete('/playlists/:id/tracks/:trackId', (req, res) => playlistController.removeTrack(req, res));
router.put('/playlists/:id/tracks/:trackId/move', (req, res) => playlistController.moveTrack(req, res));
router.delete('/playlists/:id/tracks', (req, res) => playlistController.clearTracks(req, res));

export default router;
