import { Server, Socket } from 'socket.io';
import logger from '../utils/logger';

interface LyricsOffsetUpdatePayload {
  videoId: string;
  timeOffset: number;
  deviceId: string;
}

interface LyricsSourceUpdatePayload {
  videoId: string;
  source: string;
  sourceId: number | string | null;
  deviceId: string;
}

export function setupLyricsHandlers(_io: Server, socket: Socket): void {
  // 歌詞偏移更新 — 廣播給除發送者以外的所有連線
  socket.on('lyrics:offset-update', (data: LyricsOffsetUpdatePayload) => {
    try {
      if (!data.videoId || data.deviceId == null) {
        logger.warn('lyrics:offset-update missing required fields');
        return;
      }
      logger.debug(`Lyrics offset update: videoId=${data.videoId}, offset=${data.timeOffset}, from=${data.deviceId}`);
      socket.broadcast.emit('lyrics:offset-changed', data);
    } catch (error) {
      logger.error('lyrics:offset-update handler error:', error);
    }
  });

  // 歌詞來源切換 — 廣播給除發送者以外的所有連線
  socket.on('lyrics:source-update', (data: LyricsSourceUpdatePayload) => {
    try {
      if (!data.videoId || data.deviceId == null) {
        logger.warn('lyrics:source-update missing required fields');
        return;
      }
      logger.debug(`Lyrics source update: videoId=${data.videoId}, source=${data.source}, from=${data.deviceId}`);
      socket.broadcast.emit('lyrics:source-changed', data);
    } catch (error) {
      logger.error('lyrics:source-update handler error:', error);
    }
  });
}
