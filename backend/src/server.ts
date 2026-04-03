// 在所有 import 之前設定 SSL 繞過（用於 yt-dlp 和 YouTube 爬蟲）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs';
import config from './config/environment';
import { initDatabase } from './config/database';
import { corsMiddleware } from './middleware/cors.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import logger from './utils/logger';
import { setupCastingHandlers } from './handlers/casting.handler';
import { setupRadioHandlers } from './handlers/radio.handler';
import { setupLyricsHandlers } from './handlers/lyrics.handler';

// 確保必要的目錄存在
const ensureDirectories = () => {
  const dirs = [
    config.cache.dir,
    path.dirname(config.database.path),
    'logs',
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created directory: ${dir}`);
    }
  });
};

// 初始化應用
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: config.cors.allowedOrigins,
    credentials: true,
  },
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(corsMiddleware);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.env,
  });
});

// Import routes
import youtubeRoutes from './routes/youtube.routes';
import historyRoutes from './routes/history.routes';
import recommendationRoutes from './routes/recommendation.routes';
import lyricsRoutes from './routes/lyrics.routes';
import playlistRoutes from './routes/playlist.routes';
import spotifyRoutes from './routes/spotify.routes';
import genreRecommendationRoutes from './routes/genre-recommendations.routes';
import hiddenChannelsRoutes from './routes/hidden-channels.routes';
import settingsRoutes from './routes/settings.routes';
import geminiRoutes from './routes/gemini.routes';
import trackRoutes from './routes/track.routes';

// API Routes
app.get('/api', (_req, res) => {
  res.json({
    message: '🎵 Home Media Center API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      search: '/api/search',
      video: '/api/video/:videoId',
      stream: '/api/stream/:videoId',
      lyrics: '/api/lyrics/:videoId',
      history: {
        searches: '/api/history/searches',
        channels: '/api/history/channels',
        stats: '/api/history/stats',
      },
      recommendations: {
        channels: '/api/recommendations/channels',
        channelVideos: '/api/recommendations/channel/:channelName',
        stats: '/api/recommendations/stats',
        similar: '/api/recommendations/similar/:videoId',
        genre: '/api/recommendations/genre/:genre',
        genres: '/api/recommendations/genres',
      },
      playlists: {
        list: '/api/playlists',
        detail: '/api/playlists/:id',
        addTrack: '/api/playlists/:id/tracks',
        removeTrack: '/api/playlists/:id/tracks/:trackId',
      },
      spotify: {
        status: '/api/spotify/status',
        enrich: '/api/spotify/enrich/:videoId',
        enrichBatch: '/api/spotify/enrich-batch',
        track: '/api/spotify/track/:videoId',
      },
    },
  });
});

// YouTube routes
app.use('/api', youtubeRoutes);

// History routes
app.use('/api', historyRoutes);

// Recommendation routes
app.use('/api', recommendationRoutes);

// Lyrics routes
app.use('/api', lyricsRoutes);

// Playlist routes
app.use('/api', playlistRoutes);

// Spotify routes
app.use('/api', spotifyRoutes);

// Genre-based recommendations
app.use('/api/recommendations', genreRecommendationRoutes);

// Hidden channels
app.use('/api/hidden-channels', hiddenChannelsRoutes);

// Settings
app.use('/api/settings', settingsRoutes);

// Gemini AI
app.use('/api/gemini', geminiRoutes);

// Track signal & style
app.use('/api/tracks', trackRoutes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// WebSocket 連接 - 遠端控制與投射、電台
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  setupCastingHandlers(io, socket);
  setupRadioHandlers(io, socket);
  setupLyricsHandlers(io, socket);
});

// 啟動伺服器
const startServer = () => {
  try {
    // 確保目錄存在
    ensureDirectories();

    // 初始化資料庫
    console.log('🔄 Initializing database...');
    initDatabase();
    console.log('✅ Database initialized successfully');

    // 啟動 HTTP 伺服器
    console.log('🔄 Starting HTTP server on port', config.port);
    
    server.listen(config.port, '0.0.0.0', () => {
      console.log(`🚀 Server is NOW listening on port ${config.port}`);
      logger.info(`🚀 Server running on port ${config.port}`);
      logger.info(`📡 WebSocket running on port ${config.port}`);
      logger.info(`🌍 Environment: ${config.env}`);
      logger.info(`📊 Cache limit: ${config.cache.maxTracks} tracks`);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error('❌ Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${config.port} is already in use`);
      }
      logger.error('Server error:', error);
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    console.error('❌ Server startup error:', error);
    process.exit(1);
  }
};

// 優雅關閉
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

startServer();

export { app, io };


// Force restart
