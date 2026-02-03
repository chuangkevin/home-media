import { io, Socket } from 'socket.io-client';
import type { Track } from '../types/track.types';

export interface Device {
  id: string;
  name: string;
  type: 'mobile' | 'desktop' | 'tv';
  isAvailable: boolean;
}

interface CastReceiveData {
  sourceId: string;
  sourceName: string;
  track: Track;
  position: number;
  isPlaying: boolean;
}

interface ControlExecuteData {
  sourceId: string;
  command: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'volume';
  payload?: {
    position?: number;
    volume?: number;
  };
}

// Radio types
export interface RadioTrack {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
}

export type DisplayMode = 'video' | 'visualizer';

export interface RadioStation {
  id: string;
  hostName: string;
  stationName: string;
  listenerCount: number;
  currentTrack: RadioTrack | null;
  isPlaying: boolean;
  displayMode: DisplayMode;
}

interface RadioCreatedData {
  stationId: string;
  stationName: string;
  reclaimed?: boolean;
}

interface RadioPendingStationData {
  stationId: string;
  stationName: string;
  listenerCount: number;
  currentTrack: RadioTrack | null;
  isPlaying: boolean;
}

interface RadioHostDisconnectedData {
  stationId: string;
  gracePeriod: number;
}

interface RadioJoinedData {
  stationId: string;
  stationName: string;
  hostName: string;
  currentTrack: RadioTrack | null;
  currentTime: number;
  isPlaying: boolean;
  displayMode?: DisplayMode;
}

interface RadioSyncData {
  type: 'track-change' | 'play-state' | 'time-sync' | 'seek' | 'display-mode';
  track?: RadioTrack | null;
  currentTime?: number;
  isPlaying?: boolean;
  displayMode?: DisplayMode;
}

interface RadioClosedData {
  stationId: string;
  reason: string;
}

interface RadioListenerData {
  listenerCount: number;
}

type DeviceListCallback = (devices: Device[]) => void;
type CastReceiveCallback = (data: CastReceiveData) => void;
type ControlExecuteCallback = (data: ControlExecuteData) => void;
type CastEndedCallback = () => void;
type ConnectedCallback = (connected: boolean) => void;
// Radio callbacks
type RadioListCallback = (stations: RadioStation[]) => void;
type RadioCreatedCallback = (data: RadioCreatedData) => void;
type RadioJoinedCallback = (data: RadioJoinedData) => void;
type RadioSyncCallback = (data: RadioSyncData) => void;
type RadioClosedCallback = (data: RadioClosedData) => void;
type RadioListenerCallback = (data: RadioListenerData) => void;
type RadioLeftCallback = (data: { stationId: string }) => void;
type RadioErrorCallback = (data: { message: string }) => void;
type RadioPendingStationCallback = (data: RadioPendingStationData | null) => void;
type RadioHostDisconnectedCallback = (data: RadioHostDisconnectedData) => void;

class SocketService {
  private socket: Socket | null = null;
  private deviceId: string;
  private deviceName: string;
  private callbacks: {
    onDeviceList?: DeviceListCallback;
    onCastReceive?: CastReceiveCallback;
    onControlExecute?: ControlExecuteCallback;
    onCastEnded?: CastEndedCallback;
    onConnected?: ConnectedCallback;
    // Radio callbacks
    onRadioList?: RadioListCallback;
    onRadioCreated?: RadioCreatedCallback;
    onRadioJoined?: RadioJoinedCallback;
    onRadioSync?: RadioSyncCallback;
    onRadioClosed?: RadioClosedCallback;
    onRadioListenerJoined?: RadioListenerCallback;
    onRadioListenerLeft?: RadioListenerCallback;
    onRadioLeft?: RadioLeftCallback;
    onRadioError?: RadioErrorCallback;
    onRadioPendingStation?: RadioPendingStationCallback;
    onRadioHostDisconnected?: RadioHostDisconnectedCallback;
  } = {};

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
    this.deviceName = this.getDeviceName();
  }

  connect(): void {
    if (this.socket?.connected) return;

    // 取得 WebSocket URL
    const wsUrl = this.getWebSocketUrl();
    console.log('Connecting to WebSocket:', wsUrl);

    this.socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    this.setupEventListeners();
  }

  private getWebSocketUrl(): string {
    // 在開發環境中使用 VITE_API_URL
    const apiUrl = import.meta.env.VITE_API_URL;
    if (apiUrl) {
      // 移除 /api 後綴
      return apiUrl.replace(/\/api$/, '');
    }
    // 生產環境使用當前 origin
    return window.location.origin;
  }

  private setupEventListeners(): void {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket?.id);
      this.callbacks.onConnected?.(true);
      this.registerDevice();
      
      // 自動重連電台（刷新後恢復）
      this.autoReconnectRadio();
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.callbacks.onConnected?.(false);
    });

    this.socket.on('device:list', (devices: Device[]) => {
      // 過濾掉自己
      const otherDevices = devices.filter((d) => d.id !== this.deviceId);
      this.callbacks.onDeviceList?.(otherDevices);
    });

    this.socket.on('cast:receive', (data: CastReceiveData) => {
      console.log('Received cast:', data);
      this.callbacks.onCastReceive?.(data);
    });

    this.socket.on('control:execute', (data: ControlExecuteData) => {
      console.log('Control command:', data);
      this.callbacks.onControlExecute?.(data);
    });

    this.socket.on('cast:ended', () => {
      console.log('Cast ended');
      this.callbacks.onCastEnded?.();
    });

    // Radio events
    this.socket.on('radio:list', (stations: RadioStation[]) => {
      this.callbacks.onRadioList?.(stations);
    });

    this.socket.on('radio:created', (data: RadioCreatedData) => {
      console.log('Radio station created:', data);
      this.callbacks.onRadioCreated?.(data);
    });

    this.socket.on('radio:joined', (data: RadioJoinedData) => {
      console.log('Joined radio station:', data);
      this.callbacks.onRadioJoined?.(data);
    });

    this.socket.on('radio:sync', (data: RadioSyncData) => {
      this.callbacks.onRadioSync?.(data);
    });

    this.socket.on('radio:closed', (data: RadioClosedData) => {
      console.log('Radio station closed:', data);
      this.callbacks.onRadioClosed?.(data);
    });

    this.socket.on('radio:listener-joined', (data: RadioListenerData) => {
      this.callbacks.onRadioListenerJoined?.(data);
    });

    this.socket.on('radio:listener-left', (data: RadioListenerData) => {
      this.callbacks.onRadioListenerLeft?.(data);
    });

    this.socket.on('radio:left', (data: { stationId: string }) => {
      this.callbacks.onRadioLeft?.(data);
    });

    this.socket.on('radio:error', (data: { message: string }) => {
      console.error('Radio error:', data);
      this.callbacks.onRadioError?.(data);
    });

    this.socket.on('radio:pending-station', (data: RadioPendingStationData | null) => {
      console.log('Pending station:', data);
      this.callbacks.onRadioPendingStation?.(data);
    });

    this.socket.on('radio:host-disconnected', (data: RadioHostDisconnectedData) => {
      console.log('Host disconnected:', data);
      this.callbacks.onRadioHostDisconnected?.(data);
    });
  }

  // 設定回調
  setCallbacks(callbacks: typeof this.callbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  // 裝置註冊
  private registerDevice(): void {
    this.socket?.emit('device:register', {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType: this.detectDeviceType(),
    });
  }

  // 發現裝置
  discoverDevices(): void {
    this.socket?.emit('device:discover');
  }

  // 開始投射
  startCast(
    targetIds: string[],
    track: Track,
    position: number,
    isPlaying: boolean
  ): void {
    this.socket?.emit('cast:start', {
      targetIds,
      track,
      position,
      isPlaying,
    });
  }

  // 停止投射
  stopCast(targetIds: string[]): void {
    this.socket?.emit('cast:stop', { targetIds });
  }

  // 發送控制命令
  sendCommand(
    targetIds: string[],
    command: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'volume',
    payload?: { position?: number; volume?: number }
  ): void {
    this.socket?.emit('control:command', {
      targetIds,
      command,
      payload,
    });
  }

  // ===== Radio methods =====

  // 建立電台
  createRadioStation(stationName?: string, djName?: string): void {
    const hostData = {
      deviceId: this.deviceId,
      hostName: djName || this.deviceName,
      stationName,
    };
    
    // 保存到 localStorage 用於刷新後恢復
    localStorage.setItem('radio_host_data', JSON.stringify(hostData));
    
    this.socket?.emit('radio:create', hostData);
  }

  // 關閉電台
  closeRadioStation(): void {
    // 清除 localStorage
    localStorage.removeItem('radio_host_data');
    localStorage.removeItem('radio_listener_data');
    
    this.socket?.emit('radio:close');
  }

  // 加入電台
  joinRadioStation(stationId: string): void {
    // 保存到 localStorage 用於刷新後恢復
    localStorage.setItem('radio_listener_data', JSON.stringify({ stationId }));
    
    this.socket?.emit('radio:join', { stationId });
  }

  // 離開電台
  leaveRadioStation(): void {
    // 清除 localStorage
    localStorage.removeItem('radio_listener_data');
    
    this.socket?.emit('radio:leave');
  }

  // 發現電台
  discoverRadioStations(): void {
    this.socket?.emit('radio:discover');
  }

  // 檢查是否有待接管的電台
  checkPendingStation(): void {
    this.socket?.emit('radio:check-pending', { deviceId: this.deviceId });
  }

  // 自動重連電台（刷新後恢復）
  private autoReconnectRadio(): void {
    // 延遲 500ms 讓 socket 事件監聽器設置完成
    setTimeout(() => {
      // 檢查是否是 DJ（有保存的主播資料）
      const hostDataStr = localStorage.getItem('radio_host_data');
      if (hostDataStr) {
        try {
          const hostData = JSON.parse(hostDataStr);
          console.log('📻 檢測到未關閉的電台，嘗試重新創建:', hostData.stationName);
          // 檢查是否有待接管的電台
          this.checkPendingStation();
        } catch (e) {
          console.error('Failed to parse host data:', e);
          localStorage.removeItem('radio_host_data');
        }
        return;
      }

      // 檢查是否是聽眾（有保存的聽眾資料）
      const listenerDataStr = localStorage.getItem('radio_listener_data');
      if (listenerDataStr) {
        try {
          const listenerData = JSON.parse(listenerDataStr);
          console.log('📻 檢測到刷新前正在收聽電台，嘗試重新加入:', listenerData.stationId);
          // 先發現電台列表，確認電台還存在
          this.discoverRadioStations();
          // 延遲一下讓 discover 完成，然後嘗試加入
          setTimeout(() => {
            this.joinRadioStation(listenerData.stationId);
          }, 500);
        } catch (e) {
          console.error('Failed to parse listener data:', e);
          localStorage.removeItem('radio_listener_data');
        }
      }
    }, 500);
  }

  // 主播：曲目變更
  radioTrackChange(track: RadioTrack | null): void {
    this.socket?.emit('radio:track-change', { track });
  }

  // 主播：播放狀態變更
  radioPlayState(isPlaying: boolean, currentTime: number): void {
    this.socket?.emit('radio:play-state', { isPlaying, currentTime });
  }

  // 主播：時間同步
  radioTimeSync(currentTime: number): void {
    this.socket?.emit('radio:time-sync', { currentTime });
  }

  // 主播：seek
  radioSeek(currentTime: number): void {
    this.socket?.emit('radio:seek', { currentTime });
  }

  // 主播：顯示模式變更
  radioDisplayMode(displayMode: DisplayMode): void {
    this.socket?.emit('radio:display-mode', { displayMode });
  }

  // 斷開連接
  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  // 取得連接狀態
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  // 取得或建立裝置 ID
  private getOrCreateDeviceId(): string {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('deviceId', id);
    }
    return id;
  }

  // 取得裝置名稱
  private getDeviceName(): string {
    const saved = localStorage.getItem('deviceName');
    if (saved) return saved;

    const type = this.detectDeviceType();
    const defaultName = `${type.charAt(0).toUpperCase() + type.slice(1)} ${this.deviceId.slice(-4)}`;
    return defaultName;
  }

  // 設定裝置名稱
  setDeviceName(name: string): void {
    this.deviceName = name;
    localStorage.setItem('deviceName', name);
    // 重新註冊
    if (this.socket?.connected) {
      this.registerDevice();
    }
  }

  // 偵測裝置類型
  private detectDeviceType(): 'mobile' | 'desktop' | 'tv' {
    const ua = navigator.userAgent.toLowerCase();
    if (/mobile|android|iphone|ipad|ipod/.test(ua)) return 'mobile';
    if (/smart-tv|webos|tizen|roku/.test(ua)) return 'tv';
    return 'desktop';
  }

  // 取得當前裝置 ID
  getDeviceId(): string {
    return this.deviceId;
  }
}

export const socketService = new SocketService();
