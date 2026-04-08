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

const ADAPTER_TYPES = ['http', 'mqtt', 'websocket'];

// Local-network hostname check — adapters must target local controllers only.
function isLocalTarget(hostname) {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^192\.168\./.test(hostname);
}

const DeviceService = {
  _devices: [],
  _listeners: [],
  _retryTimers: {},
  _adapters: {},

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

  registerAdapter(type, config) {
    if (!ADAPTER_TYPES.includes(type)) {
      throw new Error(`Unknown adapter type: ${type}. Must be one of: ${ADAPTER_TYPES.join(', ')}`);
    }
    if (type === 'http') {
      if (!config.endpoint) throw new Error('HTTP adapter requires endpoint');
      const url = new URL(config.endpoint);
      if (!isLocalTarget(url.hostname)) {
        throw new Error('HTTP adapter endpoint must target a local-network controller');
      }
    } else if (type === 'websocket') {
      if (!config.url) throw new Error('WebSocket adapter requires url');
      const url = new URL(config.url);
      if (!isLocalTarget(url.hostname)) {
        throw new Error('WebSocket adapter url must target a local-network controller');
      }
    } else if (type === 'mqtt') {
      if (!config.topic) throw new Error('MQTT adapter requires topic');
      if (!config.brokerUrl) throw new Error('MQTT adapter requires brokerUrl');
      const brokerUrl = new URL(config.brokerUrl);
      if (!isLocalTarget(brokerUrl.hostname)) {
        throw new Error('MQTT adapter brokerUrl must target a local-network controller');
      }
    }
    this._adapters[type] = config;
  },

  async _dispatchViaAdapter(adapterType, command) {
    const config = this._adapters[adapterType];
    if (!config) throw new Error(`No adapter registered for type: ${adapterType}`);

    if (adapterType === 'http') {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: command.deviceId,
          type: command.type,
          commandId: command.id,
          reason: command.reason
        })
      });
      if (!response.ok) throw new Error(`HTTP adapter error: ${response.status}`);
      return await response.json();
    }

    if (adapterType === 'websocket') {
      return new Promise((resolve, reject) => {
        try {
          const ws = new WebSocket(config.url);
          ws.onopen = () => {
            ws.send(JSON.stringify({
              deviceId: command.deviceId,
              type: command.type,
              commandId: command.id,
              reason: command.reason
            }));
            ws.close();
            resolve({ sent: true });
          };
          ws.onerror = () => reject(new Error('WebSocket adapter connection failed'));
        } catch (e) { reject(e); }
      });
    }

    if (adapterType === 'mqtt') {
      // MQTT requires an external broker client injected via the config.send callback.
      if (typeof config.send !== 'function') {
        throw new Error('MQTT adapter requires a config.send(topic, payload) function');
      }
      await config.send(config.topic, { deviceId: command.deviceId, type: command.type, commandId: command.id, reason: command.reason });
      return { sent: true };
    }
  },

  async _attemptSend(command) {
    const device = this._devices.find(d => d.id === command.deviceId);
    const adapterType = device?.adapterType;

    // Use registered adapter if device has one configured
    if (adapterType && this._adapters[adapterType]) {
      this._emit('device:command', { deviceId: command.deviceId, command: command.type });
      try {
        // Enforce ACK_TIMEOUT: adapter must respond within 2 seconds
        const ackPromise = this._dispatchViaAdapter(adapterType, command);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ACK timeout')), ACK_TIMEOUT)
        );
        await Promise.race([ackPromise, timeoutPromise]);
        command.status = 'acknowledged';
        command.ackAt = Date.now();
        await DB.put('command_outbox', command);
        this._emit('device:ack', { commandId: command.id, deviceId: command.deviceId });
        return { success: true, status: 'acknowledged', commandId: command.id };
      } catch {
        command.status = 'queued';
        await DB.put('command_outbox', command);
        this._startRetry(command);
        return { success: true, status: 'queued', commandId: command.id };
      }
    }

    // No adapter registered: simulation path (development / testing)
    return new Promise(async (resolve) => {
      let ackReceived = false;

      this._emit('device:command', { deviceId: command.deviceId, command: command.type });

      const timer = setTimeout(async () => {
        if (!ackReceived) {
          command.status = 'queued';
          await DB.put('command_outbox', command);
          this._startRetry(command);
          resolve({ success: true, status: 'queued', commandId: command.id });
        }
      }, ACK_TIMEOUT);

      if (device && device.status === 'online' && !device.simulateOffline) {
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
