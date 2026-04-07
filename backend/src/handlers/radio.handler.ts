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
      // 先嘗試接管現有電台
      const existingStation = radioService.reclaimStation(socket.id, data.deviceId);
      if (existingStation) {
        // 加入電台房間
        socket.join(`radio:${existingStation.id}`);

        // 回傳電台資訊（標記為重新接管）
        socket.emit('radio:created', {
          stationId: existingStation.id,
          stationName: existingStation.stationName,
          reclaimed: true,
        });

        // 廣播電台列表更新
        io.emit('radio:list', radioService.getStationList());

        logger.info(`📻 [Radio] Station reclaimed by ${data.hostName}: ${existingStation.stationName}`);
        return;
      }

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
   * 檢查是否有待接管的電台
   */
  socket.on('radio:check-pending', (data: { deviceId: string }) => {
    const station = radioService.getStationByDeviceId(data.deviceId);
    if (station) {
      socket.emit('radio:pending-station', {
        stationId: station.id,
        stationName: station.stationName,
        listenerCount: station.listeners.size,
        currentTrack: station.currentTrack,
        isPlaying: station.isPlaying,
      });
    } else {
      socket.emit('radio:pending-station', null);
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

    // 回傳當前狀態給新聽眾（含完整播放清單供預載）
    socket.emit('radio:joined', {
      stationId: station.id,
      stationName: station.stationName,
      hostName: station.hostName,
      currentTrack: station.currentTrack,
      playlist: station.playlist,
      currentTime: station.currentTime,
      isPlaying: station.isPlaying,
      displayMode: station.displayMode,
      syncVersion: station.syncVersion,
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
        syncVersion: station.syncVersion,
      });

      // 更新電台列表
      io.emit('radio:list', radioService.getStationList());

      logger.debug(`📻 [Radio] Track changed: ${data.track?.title || 'null'}`);
    }
  });

  /**
   * 主播同步播放清單（供聽眾預載）
   */
  socket.on('radio:playlist-update', (data: { playlist: RadioTrack[] }) => {
    const station = radioService.updateStationState(socket.id, {
      playlist: data.playlist,
    });

    if (station) {
      socket.to(`radio:${station.id}`).emit('radio:sync', {
        type: 'playlist-update',
        playlist: data.playlist,
        syncVersion: station.syncVersion,
      });

      logger.debug(`📻 [Radio] Playlist updated: ${data.playlist.length} tracks`);
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
        syncVersion: station.syncVersion,
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
        syncVersion: station.syncVersion,
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
        syncVersion: station.syncVersion,
      });
    }
  });

  /**
   * 主播：crossfade 開始
   */
  socket.on('radio:crossfade-start', (data: {
    nextTrack: RadioTrack;
    crossfadeDuration: number;
    elapsedMs: number;
  }) => {
    const station = radioService.getStationByHost(socket.id);
    if (station) {
      // Relay to all listeners (not host)
      socket.to(`radio:${station.id}`).emit('radio:crossfade-start', {
        nextTrack: data.nextTrack,
        crossfadeDuration: data.crossfadeDuration,
        elapsedMs: data.elapsedMs,
      });

      logger.debug(`📻 [Radio] Crossfade start: ${data.nextTrack?.title || 'null'} (${data.crossfadeDuration}s)`);
    }
  });

  /**
   * 主播切換顯示模式（音訊/影片）
   */
  socket.on('radio:display-mode', (data: { displayMode: 'video' | 'visualizer' }) => {
    const station = radioService.updateStationState(socket.id, {
      displayMode: data.displayMode,
    });

    if (station) {
      // 廣播給所有聽眾
      socket.to(`radio:${station.id}`).emit('radio:sync', {
        type: 'display-mode',
        displayMode: data.displayMode,
        syncVersion: station.syncVersion,
      });

      // 更新電台列表
      io.emit('radio:list', radioService.getStationList());

      logger.debug(`📻 [Radio] Display mode changed: ${data.displayMode}`);
    }
  });

  /**
   * 斷線處理
   */
  socket.on('disconnect', () => {
    // 先檢查是否是主播
    const station = radioService.getStationByHost(socket.id);
    if (station) {
      // 主播斷線，使用寬限期
      const handled = radioService.handleHostDisconnect(socket.id, (closedStation) => {
        // 寬限期結束，關閉電台
        io.to(`radio:${closedStation.id}`).emit('radio:closed', {
          stationId: closedStation.id,
          reason: '主播離線',
        });

        // 讓所有聽眾離開房間
        io.in(`radio:${closedStation.id}`).socketsLeave(`radio:${closedStation.id}`);

        // 廣播電台列表更新
        io.emit('radio:list', radioService.getStationList());

        logger.info(`📻 [Radio] Station closed (grace period expired): ${closedStation.stationName}`);
      });

      if (handled) {
        // 通知聽眾主播暫時離線（但電台仍在）
        io.to(`radio:${station.id}`).emit('radio:host-disconnected', {
          stationId: station.id,
          gracePeriod: 10, // 與 radio.service.ts 的 GRACE_PERIOD_MS 保持一致
        });
        return;
      }
    }

    // 檢查是否是聽眾
    const result = radioService.leaveStation(socket.id);
    if (result && !result.wasHost) {
      // 聽眾斷線
      io.to(result.station.hostSocketId).emit('radio:listener-left', {
        listenerCount: result.station.listeners.size,
      });

      // 廣播電台列表更新
      io.emit('radio:list', radioService.getStationList());
    }
  });
}
