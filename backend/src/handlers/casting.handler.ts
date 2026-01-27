import { Server, Socket } from 'socket.io';
import { castingService } from '../services/casting.service';
import { DeviceInfo, CastStartPayload, ControlCommandPayload } from '../types/casting.types';
import logger from '../utils/logger';

export function setupCastingHandlers(io: Server, socket: Socket): void {
  // 裝置註冊
  socket.on('device:register', (data: DeviceInfo) => {
    try {
      const device = castingService.registerDevice(socket.id, data);
      socket.data.deviceId = device.id;
      socket.join(`device:${device.id}`);

      logger.info(`Device registered: ${device.name} (${device.id})`);

      // 通知所有客戶端更新裝置列表
      io.emit('device:list', castingService.getAvailableDevices());
    } catch (error) {
      logger.error('Device registration failed:', error);
    }
  });

  // 請求裝置列表
  socket.on('device:discover', () => {
    const deviceId = socket.data.deviceId;
    socket.emit('device:list', castingService.getAvailableDevices(deviceId));
  });

  // 開始投射
  socket.on('cast:start', (data: CastStartPayload) => {
    try {
      const sourceDevice = castingService.getDeviceBySocketId(socket.id);
      if (!sourceDevice) {
        logger.warn('Cast start failed: source device not found');
        return;
      }

      const session = castingService.createSession(sourceDevice.id, data.targetIds);
      logger.info(`Cast session created: ${sourceDevice.name} -> ${data.targetIds.join(', ')}`);

      // 通知目標裝置
      data.targetIds.forEach((targetId) => {
        io.to(`device:${targetId}`).emit('cast:receive', {
          sourceId: sourceDevice.id,
          sourceName: sourceDevice.name,
          track: data.track,
          position: data.position,
          isPlaying: data.isPlaying,
        });
      });

      // 確認投射已開始
      socket.emit('cast:started', { sessionId: session.id, targetIds: data.targetIds });
    } catch (error) {
      logger.error('Cast start failed:', error);
    }
  });

  // 停止投射
  socket.on('cast:stop', (data: { targetIds: string[] }) => {
    try {
      const sourceDevice = castingService.getDeviceBySocketId(socket.id);
      if (!sourceDevice) return;

      const session = castingService.getSessionBySource(sourceDevice.id);
      if (session) {
        castingService.endSession(session.id);
      }

      // 通知目標裝置
      data.targetIds.forEach((targetId) => {
        io.to(`device:${targetId}`).emit('cast:ended', {
          sourceId: sourceDevice.id,
        });
      });

      logger.info(`Cast stopped: ${sourceDevice.name}`);
    } catch (error) {
      logger.error('Cast stop failed:', error);
    }
  });

  // 控制命令
  socket.on('control:command', (data: ControlCommandPayload) => {
    try {
      const sourceDevice = castingService.getDeviceBySocketId(socket.id);
      if (!sourceDevice) return;

      logger.debug(`Control command: ${data.command} from ${sourceDevice.name}`);

      // 轉發到目標裝置
      data.targetIds.forEach((targetId) => {
        io.to(`device:${targetId}`).emit('control:execute', {
          sourceId: sourceDevice.id,
          command: data.command,
          payload: data.payload,
        });
      });
    } catch (error) {
      logger.error('Control command failed:', error);
    }
  });

  // 斷線處理
  socket.on('disconnect', () => {
    const device = castingService.unregisterDevice(socket.id);
    if (device) {
      logger.info(`Device disconnected: ${device.name} (${device.id})`);

      // 通知其他裝置 cast 已結束
      const session = castingService.getSessionBySource(device.id);
      if (session) {
        session.targetIds.forEach((targetId) => {
          io.to(`device:${targetId}`).emit('cast:ended', {
            sourceId: device.id,
          });
        });
      }

      // 更新裝置列表
      io.emit('device:list', castingService.getAvailableDevices());
    }
  });
}
