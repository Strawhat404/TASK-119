/**
 * Device service layer — HTTP/MQTT/WebSocket adapters.
 * - Remote unlock with confirmation modal
 * - ACK required within 2 seconds → else queued
 * - Retry every 10 seconds for up to 2 minutes
 * - Local command outbox for offline fault tolerance
 */
import DB from '../database.js';
import { addAuditLog } from './audit.js';

const ACK_TIMEOUT = 2000;       // 2 seconds
const RETRY_INTERVAL = 10000;   // 10 seconds
const MAX_RETRY_DURATION = 120000; // 2 minutes

const DeviceService = {
  _devices: [],
  _listeners: [],
  _retryTimers: {},

  async init() {
    this._devices = await DB.getAll('devices');
    // Process any pending outbox commands
    this._processOutbox();
  },

  async registerDevice(device) {
    const record = {
      ...device,
      status: 'online',
      lastSeen: Date.now(),
      secret: undefined // never expose device secrets
    };
    const id = await DB.add('devices', record);
    record.id = id;
    this._devices.push(record);
    this._emit('device:registered', record);
    return record;
  },

  async getDevices() {
    return DB.getAll('devices');
  },

  getDevicesSync() {
    return [...this._devices];
  },

  async sendUnlockCommand(deviceId, reason, actor) {
    if (!reason || reason.length < 10) {
      return { success: false, error: 'Reason must be at least 10 characters' };
    }

    const device = this._devices.find(d => d.id === deviceId);
    if (!device) return { success: false, error: `Device ${deviceId} not found` };

    const command = {
      deviceId,
      type: 'unlock',
      reason,
      actor,
      status: 'pending',
      createdAt: Date.now(),
      ackAt: null,
      retryCount: 0,
      lastRetry: null
    };

    const cmdId = await DB.add('command_outbox', command);
    command.id = cmdId;

    await addAuditLog('unlock_command', actor, {
      deviceId,
      deviceName: device.name,
      reason,
      commandId: cmdId
    });

    // Attempt to send with ACK timeout
    const result = await this._attemptSend(command);
    return result;
  },

  async _attemptSend(command) {
    return new Promise(async (resolve) => {
      let ackReceived = false;

      // Simulate sending command
      this._emit('device:command', { deviceId: command.deviceId, command: command.type });

      // ACK timeout
      const timer = setTimeout(async () => {
        if (!ackReceived) {
          command.status = 'queued';
          await DB.put('command_outbox', command);
          this._startRetry(command);
          resolve({ success: true, status: 'queued', commandId: command.id });
        }
      }, ACK_TIMEOUT);

      // Simulate ACK (in real system this comes from device)
      // For now, check device status
      const device = this._devices.find(d => d.id === command.deviceId);
      if (device && device.status === 'online' && !device.simulateOffline) {
        // Simulate immediate ACK for online devices
        setTimeout(async () => {
          ackReceived = true;
          clearTimeout(timer);
          command.status = 'acknowledged';
          command.ackAt = Date.now();
          await DB.put('command_outbox', command);
          this._emit('device:ack', { commandId: command.id, deviceId: command.deviceId });
          resolve({ success: true, status: 'acknowledged', commandId: command.id });
        }, 500);
      }
      // If device offline, timer will fire and queue the command
    });
  },

  _startRetry(command) {
    const startTime = command.createdAt;

    const retry = async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_RETRY_DURATION) {
        command.status = 'failed';
        await DB.put('command_outbox', command);
        this._emit('device:command_failed', { commandId: command.id });
        delete this._retryTimers[command.id];
        return;
      }

      command.retryCount += 1;
      command.lastRetry = Date.now();

      const device = this._devices.find(d => d.id === command.deviceId);
      if (device && device.status === 'online' && !device.simulateOffline) {
        command.status = 'acknowledged';
        command.ackAt = Date.now();
        await DB.put('command_outbox', command);
        this._emit('device:ack', { commandId: command.id, deviceId: command.deviceId });
        delete this._retryTimers[command.id];
        return;
      }

      await DB.put('command_outbox', command);
      this._retryTimers[command.id] = setTimeout(retry, RETRY_INTERVAL);
    };

    this._retryTimers[command.id] = setTimeout(retry, RETRY_INTERVAL);
  },

  async _processOutbox() {
    const commands = await DB.getByIndex('command_outbox', 'status', 'queued');
    for (const cmd of commands) {
      if (Date.now() - cmd.createdAt < MAX_RETRY_DURATION) {
        this._startRetry(cmd);
      } else {
        cmd.status = 'failed';
        await DB.put('command_outbox', cmd);
      }
    }
  },

  async getOutbox() {
    return DB.getAll('command_outbox');
  },

  onEvent(callback) {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  },

  _emit(type, payload) {
    for (const listener of this._listeners) {
      listener({ type, payload, timestamp: Date.now() });
    }
  },

  async setDeviceStatus(deviceId, status) {
    const device = this._devices.find(d => d.id === deviceId);
    if (device) {
      device.status = status;
      device.lastSeen = Date.now();
      await DB.put('devices', device);
    }
  },

  simulateHeartbeat() {
    for (const device of this._devices) {
      device.lastSeen = Date.now();
    }
    this._emit('devices:heartbeat', { count: this._devices.length });
  },

  destroy() {
    for (const timer of Object.values(this._retryTimers)) {
      clearTimeout(timer);
    }
    this._retryTimers = {};
    this._listeners = [];
  }
};

export default DeviceService;
