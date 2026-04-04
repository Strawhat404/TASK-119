/**
 * Pure device/command-outbox logic — no browser/DB dependencies.
 */

export const ACK_TIMEOUT = 2000;       // 2 seconds
export const RETRY_INTERVAL = 10000;   // 10 seconds
export const MAX_RETRY_DURATION = 120000; // 2 minutes
export const MIN_REASON_LENGTH = 10;

export function validateUnlockReason(reason) {
  if (!reason || reason.length < MIN_REASON_LENGTH) {
    return { valid: false, error: 'Reason must be at least 10 characters' };
  }
  return { valid: true };
}

export function createCommandObject(deviceId, reason, actor) {
  return {
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
}

export function applyAckTimeout(command) {
  if (command.status === 'pending') {
    command.status = 'queued';
  }
  return command;
}

export function applyAck(command) {
  command.status = 'acknowledged';
  command.ackAt = Date.now();
  return command;
}

export function applyRetry(command, deviceOnline, now = Date.now()) {
  const elapsed = now - command.createdAt;
  if (elapsed >= MAX_RETRY_DURATION) {
    command.status = 'failed';
    return command;
  }

  command.retryCount += 1;
  command.lastRetry = now;

  if (deviceOnline) {
    command.status = 'acknowledged';
    command.ackAt = now;
  }

  return command;
}
