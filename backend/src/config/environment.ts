import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  wsPort: parseInt(process.env.WS_PORT || '3002', 10),

  database: {
    path: process.env.DB_PATH || path.join(__dirname, '../../data/db/home-media.sqlite'),
  },

  cache: {
    dir: process.env.CACHE_DIR || path.join(__dirname, '../../data/cache'),
    maxTracks: parseInt(process.env.MAX_CACHE_TRACKS || '50', 10),
  },

  apiKeys: {
    genius: process.env.GENIUS_API_KEY || '',
    musixmatch: process.env.MUSIXMATCH_API_KEY || '',
  },

  cors: {
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  youtube: {
    cookiesPath: process.env.YOUTUBE_COOKIES_PATH || '',
  },
};

export default config;
