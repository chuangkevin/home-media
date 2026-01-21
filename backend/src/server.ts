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
    },
  });
});

// YouTube routes
app.use('/api', youtubeRoutes);

// TODO: 加入其他路由
// app.use('/api/lyrics', lyricsRoutes);
// app.use('/api/playlists', playlistRoutes);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// WebSocket 連接
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });

  // TODO: 加入 WebSocket 事件處理
  // socket.on('playback:play', handlePlay);
  // socket.on('playback:pause', handlePause);
});

// 啟動伺服器
const startServer = async () => {
  try {
    // 確保目錄存在
    ensureDirectories();

    // 初始化資料庫
    initDatabase();

    // 啟動 HTTP 伺服器
    server.listen(config.port, () => {
      logger.info(`🚀 Server running on port ${config.port}`);
      logger.info(`📡 WebSocket running on port ${config.port}`);
      logger.info(`🌍 Environment: ${config.env}`);
      logger.info(`📊 Cache limit: ${config.cache.maxTracks} tracks`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
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
