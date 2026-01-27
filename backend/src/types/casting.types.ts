export interface Device {
  id: string;
  socketId: string;
  name: string;
  type: 'mobile' | 'desktop' | 'tv';
  lastSeen: Date;
  isAvailable: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'mobile' | 'desktop' | 'tv';
}

export interface CastSession {
  id: string;
  sourceId: string;
  targetIds: string[];
  createdAt: Date;
}

export interface CastStartPayload {
  targetIds: string[];
  track: {
    videoId: string;
    title: string;
    channel: string;
    duration: number;
    thumbnail: string;
  };
  position: number;
  isPlaying: boolean;
}

export interface ControlCommandPayload {
  targetIds: string[];
  command: 'play' | 'pause' | 'next' | 'previous' | 'seek' | 'volume';
  payload?: {
    position?: number;
    volume?: number;
  };
}
