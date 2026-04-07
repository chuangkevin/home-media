/**
 * 電台服務
 * 管理電台的建立、加入、離開與狀態同步
 */

import logger from '../utils/logger';

export type DisplayMode = 'video' | 'visualizer';

export interface RadioStation {
  id: string;
  hostSocketId: string;
  hostDeviceId: string;
  hostName: string;
  stationName: string;
  listeners: Set<string>; // socket IDs
  currentTrack: RadioTrack | null;
  playlist: RadioTrack[]; // full DJ playlist for listener prefetch
  currentTime: number;
  isPlaying: boolean;
  displayMode: DisplayMode;
  createdAt: number;
  lastActivity: number;
  syncVersion: number; // 同步版本號，用於解決競態條件
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
  displayMode: DisplayMode;
}

class RadioService {
  private stations = new Map<string, RadioStation>();
  private socketToStation = new Map<string, string>(); // socketId -> stationId (for hosts)
  private listenerToStation = new Map<string, string>(); // socketId -> stationId (for listeners)
  private deviceIdToStation = new Map<string, string>(); // deviceId -> stationId (for reconnection)
  private pendingCloseTimers = new Map<string, ReturnType<typeof setTimeout>>(); // stationId -> timer
  private readonly GRACE_PERIOD_MS = 10000; // 10 秒寬限期（縮短以提升用戶體驗）

  /**
   * 建立電台
   */
  createStation(
    socketId: string,
    deviceId: string,
    hostName: string,
    stationName?: string
  ): RadioStation {
    // 檢查是否已經有電台（同一個 socket）
    const existingStationId = this.socketToStation.get(socketId);
    if (existingStationId) {
      throw new Error('已經有一個電台了');
    }

    // 檢查同一個 deviceId 是否已經有電台（重連情況應該用 reclaimStation）
    const existingByDevice = this.deviceIdToStation.get(deviceId);
    if (existingByDevice && this.stations.has(existingByDevice)) {
      throw new Error('此裝置已有電台，請使用重新接管功能');
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
      playlist: [],
      currentTime: 0,
      isPlaying: false,
      displayMode: 'visualizer',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      syncVersion: 0,
    };

    this.stations.set(stationId, station);
    this.socketToStation.set(socketId, stationId);
    this.deviceIdToStation.set(deviceId, stationId);

    logger.info(`📻 Radio station created: ${station.stationName} (${stationId})`);
    return station;
  }

  /**
   * 重新接管電台（重新整理後恢復）
   */
  reclaimStation(socketId: string, deviceId: string): RadioStation | null {
    const stationId = this.deviceIdToStation.get(deviceId);
    if (!stationId) {
      return null;
    }

    const station = this.stations.get(stationId);
    if (!station) {
      this.deviceIdToStation.delete(deviceId);
      return null;
    }

    // 取消待關閉的計時器
    const pendingTimer = this.pendingCloseTimers.get(stationId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.pendingCloseTimers.delete(stationId);
      logger.info(`📻 Cancelled pending close for station: ${station.stationName}`);
    }

    // 更新 socket 映射
    const oldSocketId = station.hostSocketId;
    if (oldSocketId !== socketId) {
      this.socketToStation.delete(oldSocketId);
    }

    station.hostSocketId = socketId;
    station.lastActivity = Date.now();
    this.socketToStation.set(socketId, stationId);

    logger.info(`📻 Station reclaimed: ${station.stationName} (${stationId})`);
    return station;
  }

  /**
   * 檢查 deviceId 是否有待接管的電台
   */
  hasPendingStation(deviceId: string): boolean {
    const stationId = this.deviceIdToStation.get(deviceId);
    return stationId ? this.stations.has(stationId) : false;
  }

  /**
   * 取得 deviceId 對應的電台
   */
  getStationByDeviceId(deviceId: string): RadioStation | undefined {
    const stationId = this.deviceIdToStation.get(deviceId);
    if (!stationId) return undefined;
    return this.stations.get(stationId);
  }

  /**
   * 主播斷線處理（延遲關閉）
   */
  handleHostDisconnect(socketId: string, onClose: (station: RadioStation) => void): boolean {
    const stationId = this.socketToStation.get(socketId);
    if (!stationId) {
      return false;
    }

    const station = this.stations.get(stationId);
    if (!station) {
      this.socketToStation.delete(socketId);
      return false;
    }

    // 設定延遲關閉計時器
    logger.info(`📻 Host disconnected, station will close in ${this.GRACE_PERIOD_MS / 1000}s: ${station.stationName}`);

    const timer = setTimeout(() => {
      // 檢查電台是否還存在且沒有被重新接管
      if (this.stations.has(stationId) && station.hostSocketId === socketId) {
        logger.info(`📻 Grace period expired, closing station: ${station.stationName}`);
        this.forceCloseStation(stationId);
        onClose(station);
      }
      this.pendingCloseTimers.delete(stationId);
    }, this.GRACE_PERIOD_MS);

    this.pendingCloseTimers.set(stationId, timer);
    this.socketToStation.delete(socketId);

    return true;
  }

  /**
   * 強制關閉電台
   */
  private forceCloseStation(stationId: string): void {
    const station = this.stations.get(stationId);
    if (!station) return;

    // 清除所有映射
    this.socketToStation.delete(station.hostSocketId);
    this.deviceIdToStation.delete(station.hostDeviceId);
    station.listeners.forEach((listenerId) => {
      this.listenerToStation.delete(listenerId);
    });
    this.stations.delete(stationId);

    // 清除計時器
    const timer = this.pendingCloseTimers.get(stationId);
    if (timer) {
      clearTimeout(timer);
      this.pendingCloseTimers.delete(stationId);
    }
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
   * 離開電台（手動關閉，立即生效）
   */
  leaveStation(socketId: string): { station: RadioStation; wasHost: boolean } | null {
    // 檢查是否是主播
    const hostStationId = this.socketToStation.get(socketId);
    if (hostStationId) {
      const station = this.stations.get(hostStationId);
      if (station) {
        // 清除待關閉計時器（如果有）
        const timer = this.pendingCloseTimers.get(hostStationId);
        if (timer) {
          clearTimeout(timer);
          this.pendingCloseTimers.delete(hostStationId);
        }

        this.socketToStation.delete(socketId);
        this.deviceIdToStation.delete(station.hostDeviceId);
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
      playlist?: RadioTrack[];
      currentTime?: number;
      isPlaying?: boolean;
      displayMode?: DisplayMode;
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

    // 追蹤是否有重要狀態變更
    let hasStateChange = false;

    if (update.currentTrack !== undefined) {
      station.currentTrack = update.currentTrack;
      hasStateChange = true;
    }
    if (update.playlist !== undefined) {
      station.playlist = update.playlist;
    }
    if (update.currentTime !== undefined) {
      station.currentTime = update.currentTime;
    }
    if (update.isPlaying !== undefined) {
      station.isPlaying = update.isPlaying;
      hasStateChange = true;
    }
    if (update.displayMode !== undefined) {
      station.displayMode = update.displayMode;
      hasStateChange = true;
    }

    // 如果有重要狀態變更，遞增版本號
    if (hasStateChange) {
      station.syncVersion++;
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
        displayMode: station.displayMode,
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
        this.deviceIdToStation.delete(station.hostDeviceId);
        station.listeners.forEach((listenerId) => {
          this.listenerToStation.delete(listenerId);
        });
        this.stations.delete(stationId);

        // 清除待關閉計時器
        const timer = this.pendingCloseTimers.get(stationId);
        if (timer) {
          clearTimeout(timer);
          this.pendingCloseTimers.delete(stationId);
        }

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
