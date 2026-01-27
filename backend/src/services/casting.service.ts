import { Device, DeviceInfo, CastSession } from '../types/casting.types';

class CastingService {
  private devices: Map<string, Device> = new Map();
  private sessions: Map<string, CastSession> = new Map();
  private socketToDevice: Map<string, string> = new Map();

  registerDevice(socketId: string, deviceInfo: DeviceInfo): Device {
    const device: Device = {
      id: deviceInfo.deviceId,
      socketId,
      name: deviceInfo.deviceName,
      type: deviceInfo.deviceType,
      lastSeen: new Date(),
      isAvailable: true,
    };

    this.devices.set(device.id, device);
    this.socketToDevice.set(socketId, device.id);

    return device;
  }

  unregisterDevice(socketId: string): Device | null {
    const deviceId = this.socketToDevice.get(socketId);
    if (!deviceId) return null;

    const device = this.devices.get(deviceId);
    this.devices.delete(deviceId);
    this.socketToDevice.delete(socketId);

    // 清理相關的 session
    this.cleanupDeviceSessions(deviceId);

    return device || null;
  }

  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  getDeviceBySocketId(socketId: string): Device | undefined {
    const deviceId = this.socketToDevice.get(socketId);
    return deviceId ? this.devices.get(deviceId) : undefined;
  }

  getAvailableDevices(excludeDeviceId?: string): Device[] {
    const devices: Device[] = [];
    this.devices.forEach((device) => {
      if (device.isAvailable && device.id !== excludeDeviceId) {
        devices.push(device);
      }
    });
    return devices;
  }

  updateDeviceHeartbeat(socketId: string): void {
    const deviceId = this.socketToDevice.get(socketId);
    if (deviceId) {
      const device = this.devices.get(deviceId);
      if (device) {
        device.lastSeen = new Date();
      }
    }
  }

  createSession(sourceId: string, targetIds: string[]): CastSession {
    const session: CastSession = {
      id: `session_${Date.now()}`,
      sourceId,
      targetIds,
      createdAt: new Date(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getSessionBySource(sourceId: string): CastSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.sourceId === sourceId) {
        return session;
      }
    }
    return undefined;
  }

  addTargetToSession(sessionId: string, targetId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.targetIds.includes(targetId)) {
      session.targetIds.push(targetId);
    }
  }

  removeTargetFromSession(sessionId: string, targetId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.targetIds = session.targetIds.filter((id) => id !== targetId);
      if (session.targetIds.length === 0) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private cleanupDeviceSessions(deviceId: string): void {
    // 如果是 source，刪除整個 session
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.sourceId === deviceId) {
        this.sessions.delete(sessionId);
      } else if (session.targetIds.includes(deviceId)) {
        // 如果是 target，從 session 移除
        this.removeTargetFromSession(sessionId, deviceId);
      }
    }
  }
}

export const castingService = new CastingService();
