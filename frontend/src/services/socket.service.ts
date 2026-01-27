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

type DeviceListCallback = (devices: Device[]) => void;
type CastReceiveCallback = (data: CastReceiveData) => void;
type ControlExecuteCallback = (data: ControlExecuteData) => void;
type CastEndedCallback = () => void;
type ConnectedCallback = (connected: boolean) => void;

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
