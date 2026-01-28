/**
 * 電台 Socket.io 處理器
 */

import { Server, Socket } from 'socket.io';
import { radioService, RadioTrack } from '../services/radio.service';
import logger from '../utils/logger';

export function setupRadioHandlers(io: Server, socket: Socket): void {
  /**
   * 建立電台
   */
  socket.on('radio:create', (data: { deviceId: string; hostName: string; stationName?: string }) => {
    try {
      const station = radioService.createStation(
        socket.id,
        data.deviceId,
        data.hostName,
        data.stationName
      );

      // 加入電台房間
      socket.join(`radio:${station.id}`);

      // 回傳電台資訊
      socket.emit('radio:created', {
        stationId: station.id,
        stationName: station.stationName,
      });

      // 廣播電台列表更新
      io.emit('radio:list', radioService.getStationList());

      logger.info(`📻 [Radio] Station created by ${data.hostName}: ${station.stationName}`);
    } catch (error) {
      socket.emit('radio:error', { message: (error as Error).message });
    }
  });

  /**
   * 關閉電台
   */
  socket.on('radio:close', () => {
    const result = radioService.leaveStation(socket.id);
    if (result && result.wasHost) {
      // 離開房間
      socket.leave(`radio:${result.station.id}`);

      // 通知所有聽眾電台已關閉
      io.to(`radio:${result.station.id}`).emit('radio:closed', {
        stationId: result.station.id,
        reason: '主播關閉了電台',
      });

      // 讓所有聽眾離開房間
      io.in(`radio:${result.station.id}`).socketsLeave(`radio:${result.station.id}`);

      // 廣播電台列表更新
      io.emit('radio:list', radioService.getStationList());

      logger.info(`📻 [Radio] Station closed: ${result.station.stationName}`);
    }
  });

  /**
   * 加入電台
   */
  socket.on('radio:join', (data: { stationId: string }) => {
    const station = radioService.joinStation(socket.id, data.stationId);

    if (!station) {
      socket.emit('radio:error', { message: '找不到電台' });
      return;
    }

    // 加入電台房間
    socket.join(`radio:${station.id}`);

    // 回傳當前狀態給新聽眾
    socket.emit('radio:joined', {
      stationId: station.id,
      stationName: station.stationName,
      hostName: station.hostName,
      currentTrack: station.currentTrack,
      currentTime: station.currentTime,
      isPlaying: station.isPlaying,
    });

    // 通知主播有新聽眾
    io.to(station.hostSocketId).emit('radio:listener-joined', {
      listenerCount: station.listeners.size,
    });

    // 廣播電台列表更新
    io.emit('radio:list', radioService.getStationList());

    logger.info(`📻 [Radio] Listener joined: ${station.stationName} (${station.listeners.size} listeners)`);
  });

  /**
   * 離開電台（聽眾）
   */
  socket.on('radio:leave', () => {
    const result = radioService.leaveStation(socket.id);

    if (result && !result.wasHost) {
      // 離開房間
      socket.leave(`radio:${result.station.id}`);

      // 回傳確認
      socket.emit('radio:left', {
        stationId: result.station.id,
      });

      // 通知主播有聽眾離開
      io.to(result.station.hostSocketId).emit('radio:listener-left', {
        listenerCount: result.station.listeners.size,
      });

      // 廣播電台列表更新
      io.emit('radio:list', radioService.getStationList());
    }
  });

  /**
   * 請求電台列表
   */
  socket.on('radio:discover', () => {
    socket.emit('radio:list', radioService.getStationList());
  });

  /**
   * 主播更新狀態（曲目變更）
   */
  socket.on('radio:track-change', (data: { track: RadioTrack | null }) => {
    const station = radioService.updateStationState(socket.id, {
      currentTrack: data.track,
      currentTime: 0,
      isPlaying: true,
    });

    if (station) {
      // 廣播給所有聽眾
      socket.to(`radio:${station.id}`).emit('radio:sync', {
        type: 'track-change',
        track: data.track,
        currentTime: 0,
        isPlaying: true,
      });

      // 更新電台列表
      io.emit('radio:list', radioService.getStationList());

      logger.debug(`📻 [Radio] Track changed: ${data.track?.title || 'null'}`);
    }
  });

  /**
   * 主播更新狀態（播放/暫停）
   */
  socket.on('radio:play-state', (data: { isPlaying: boolean; currentTime: number }) => {
    const station = radioService.updateStationState(socket.id, {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
    });

    if (station) {
      // 廣播給所有聽眾
      socket.to(`radio:${station.id}`).emit('radio:sync', {
        type: 'play-state',
        isPlaying: data.isPlaying,
        currentTime: data.currentTime,
      });
    }
  });

  /**
   * 主播更新狀態（進度同步）
   */
  socket.on('radio:time-sync', (data: { currentTime: number }) => {
    const station = radioService.updateStationState(socket.id, {
      currentTime: data.currentTime,
    });

    if (station) {
      // 廣播給所有聽眾（使用 volatile 減少網路開銷）
      socket.to(`radio:${station.id}`).volatile.emit('radio:sync', {
        type: 'time-sync',
        currentTime: data.currentTime,
      });
    }
  });

  /**
   * 主播 seek
   */
  socket.on('radio:seek', (data: { currentTime: number }) => {
    const station = radioService.updateStationState(socket.id, {
      currentTime: data.currentTime,
    });

    if (station) {
      // 廣播給所有聽眾
      socket.to(`radio:${station.id}`).emit('radio:sync', {
        type: 'seek',
        currentTime: data.currentTime,
      });
    }
  });

  /**
   * 斷線處理
   */
  socket.on('disconnect', () => {
    const result = radioService.leaveStation(socket.id);

    if (result) {
      if (result.wasHost) {
        // 主播斷線，關閉電台
        io.to(`radio:${result.station.id}`).emit('radio:closed', {
          stationId: result.station.id,
          reason: '主播離線',
        });

        logger.info(`📻 [Radio] Station closed (host disconnected): ${result.station.stationName}`);
      } else {
        // 聽眾斷線
        io.to(result.station.hostSocketId).emit('radio:listener-left', {
          listenerCount: result.station.listeners.size,
        });
      }

      // 廣播電台列表更新
      io.emit('radio:list', radioService.getStationList());
    }
  });
}
