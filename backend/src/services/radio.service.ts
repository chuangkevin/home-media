/**
 * 電台服務
 * 管理電台的建立、加入、離開與狀態同步
 */

import logger from '../utils/logger';

export interface RadioStation {
  id: string;
  hostSocketId: string;
  hostDeviceId: string;
  hostName: string;
  stationName: string;
  listeners: Set<string>; // socket IDs
  currentTrack: RadioTrack | null;
  currentTime: number;
  isPlaying: boolean;
  createdAt: number;
  lastActivity: number;
}

export interface RadioTrack {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
}

export interface RadioStationInfo {
  id: string;
  hostName: string;
  stationName: string;
  listenerCount: number;
  currentTrack: RadioTrack | null;
  isPlaying: boolean;
}

class RadioService {
  private stations = new Map<string, RadioStation>();
  private socketToStation = new Map<string, string>(); // socketId -> stationId (for hosts)
  private listenerToStation = new Map<string, string>(); // socketId -> stationId (for listeners)

  /**
   * 建立電台
   */
  createStation(
    socketId: string,
    deviceId: string,
    hostName: string,
    stationName?: string
  ): RadioStation {
    // 檢查是否已經有電台
    const existingStationId = this.socketToStation.get(socketId);
    if (existingStationId) {
      throw new Error('已經有一個電台了');
    }

    // 如果正在收聽其他電台，先離開
    this.leaveStation(socketId);

    const stationId = `station_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const station: RadioStation = {
      id: stationId,
      hostSocketId: socketId,
      hostDeviceId: deviceId,
      hostName,
      stationName: stationName || `${hostName} 的電台`,
      listeners: new Set(),
      currentTrack: null,
      currentTime: 0,
      isPlaying: false,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.stations.set(stationId, station);
    this.socketToStation.set(socketId, stationId);

    logger.info(`📻 Radio station created: ${station.stationName} (${stationId})`);
    return station;
  }

  /**
   * 加入電台
   */
  joinStation(socketId: string, stationId: string): RadioStation | null {
    const station = this.stations.get(stationId);
    if (!station) {
      return null;
    }

    // 如果是主播自己，不需要加入
    if (station.hostSocketId === socketId) {
      return station;
    }

    // 離開之前的電台（如果有的話）
    this.leaveStation(socketId);

    station.listeners.add(socketId);
    this.listenerToStation.set(socketId, stationId);
    station.lastActivity = Date.now();

    logger.info(`📻 Listener joined station: ${station.stationName} (listeners: ${station.listeners.size})`);
    return station;
  }

  /**
   * 離開電台
   */
  leaveStation(socketId: string): { station: RadioStation; wasHost: boolean } | null {
    // 檢查是否是主播
    const hostStationId = this.socketToStation.get(socketId);
    if (hostStationId) {
      const station = this.stations.get(hostStationId);
      if (station) {
        this.socketToStation.delete(socketId);
        this.stations.delete(hostStationId);

        // 清除所有聽眾的映射
        station.listeners.forEach((listenerId) => {
          this.listenerToStation.delete(listenerId);
        });

        logger.info(`📻 Radio station closed: ${station.stationName}`);
        return { station, wasHost: true };
      }
    }

    // 檢查是否是聽眾
    const listenerStationId = this.listenerToStation.get(socketId);
    if (listenerStationId) {
      const station = this.stations.get(listenerStationId);
      if (station) {
        station.listeners.delete(socketId);
        this.listenerToStation.delete(socketId);
        station.lastActivity = Date.now();

        logger.info(`📻 Listener left station: ${station.stationName} (listeners: ${station.listeners.size})`);
        return { station, wasHost: false };
      }
    }

    return null;
  }

  /**
   * 更新電台狀態（主播呼叫）
   */
  updateStationState(
    socketId: string,
    update: {
      currentTrack?: RadioTrack | null;
      currentTime?: number;
      isPlaying?: boolean;
    }
  ): RadioStation | null {
    const stationId = this.socketToStation.get(socketId);
    if (!stationId) {
      return null;
    }

    const station = this.stations.get(stationId);
    if (!station) {
      return null;
    }

    if (update.currentTrack !== undefined) {
      station.currentTrack = update.currentTrack;
    }
    if (update.currentTime !== undefined) {
      station.currentTime = update.currentTime;
    }
    if (update.isPlaying !== undefined) {
      station.isPlaying = update.isPlaying;
    }
    station.lastActivity = Date.now();

    return station;
  }

  /**
   * 取得電台資訊
   */
  getStation(stationId: string): RadioStation | undefined {
    return this.stations.get(stationId);
  }

  /**
   * 取得使用者的電台（主播）
   */
  getStationByHost(socketId: string): RadioStation | undefined {
    const stationId = this.socketToStation.get(socketId);
    if (!stationId) return undefined;
    return this.stations.get(stationId);
  }

  /**
   * 取得使用者正在收聽的電台（聽眾）
   */
  getStationByListener(socketId: string): RadioStation | undefined {
    const stationId = this.listenerToStation.get(socketId);
    if (!stationId) return undefined;
    return this.stations.get(stationId);
  }

  /**
   * 取得所有電台列表
   */
  getStationList(): RadioStationInfo[] {
    const list: RadioStationInfo[] = [];

    this.stations.forEach((station) => {
      list.push({
        id: station.id,
        hostName: station.hostName,
        stationName: station.stationName,
        listenerCount: station.listeners.size,
        currentTrack: station.currentTrack,
        isPlaying: station.isPlaying,
      });
    });

    return list;
  }

  /**
   * 清理閒置電台（超過 30 分鐘無活動）
   */
  cleanupIdleStations(): number {
    const now = Date.now();
    const maxIdleTime = 30 * 60 * 1000; // 30 分鐘
    let cleaned = 0;

    this.stations.forEach((station, stationId) => {
      if (now - station.lastActivity > maxIdleTime) {
        this.socketToStation.delete(station.hostSocketId);
        station.listeners.forEach((listenerId) => {
          this.listenerToStation.delete(listenerId);
        });
        this.stations.delete(stationId);
        cleaned++;
        logger.info(`📻 Cleaned up idle station: ${station.stationName}`);
      }
    });

    return cleaned;
  }
}

export const radioService = new RadioService();

// 每 5 分鐘清理一次閒置電台
setInterval(() => {
  radioService.cleanupIdleStations();
}, 5 * 60 * 1000);
