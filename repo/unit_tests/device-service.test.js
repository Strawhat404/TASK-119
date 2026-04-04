import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production logic from lib
import {
  validateUnlockReason,
  createCommandObject,
  applyAckTimeout,
  applyAck,
  applyRetry,
  ACK_TIMEOUT,
  RETRY_INTERVAL,
  MAX_RETRY_DURATION,
  MIN_REASON_LENGTH
} from '../frontend/js/lib/device-logic.js';

describe('Device Service - Command Creation', () => {
  it('should reject reason shorter than 10 characters', () => {
    const result = validateUnlockReason('short');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('10 characters'));
  });

  it('should accept valid reason', () => {
    const result = validateUnlockReason('Valid reason text here');
    assert.equal(result.valid, true);
  });

  it('should reject empty reason', () => {
    assert.equal(validateUnlockReason('').valid, false);
    assert.equal(validateUnlockReason(null).valid, false);
  });

  it('should create command with correct fields', () => {
    const cmd = createCommandObject(1, 'Maintenance access needed', 'operator');
    assert.equal(cmd.deviceId, 1);
    assert.equal(cmd.type, 'unlock');
    assert.equal(cmd.reason, 'Maintenance access needed');
    assert.equal(cmd.actor, 'operator');
    assert.equal(cmd.status, 'pending');
    assert.equal(cmd.retryCount, 0);
    assert.equal(cmd.ackAt, null);
  });

  it('should use correct constants', () => {
    assert.equal(ACK_TIMEOUT, 2000);
    assert.equal(RETRY_INTERVAL, 10000);
    assert.equal(MAX_RETRY_DURATION, 120000);
    assert.equal(MIN_REASON_LENGTH, 10);
  });
});

describe('Device Service - ACK Timeout & Queued State', () => {
  it('should transition to queued on ACK timeout', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    applyAckTimeout(cmd);
    assert.equal(cmd.status, 'queued');
  });

  it('should not change non-pending command on ACK timeout', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    cmd.status = 'acknowledged';
    applyAckTimeout(cmd);
    assert.equal(cmd.status, 'acknowledged');
  });

  it('should transition to acknowledged on ACK', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    applyAck(cmd);
    assert.equal(cmd.status, 'acknowledged');
    assert.ok(cmd.ackAt);
  });
});

describe('Device Service - Retry Logic', () => {
  it('should retry queued command and stay queued when offline', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    applyAckTimeout(cmd);
    applyRetry(cmd, false);
    assert.equal(cmd.retryCount, 1);
    assert.equal(cmd.status, 'queued');
  });

  it('should acknowledge on retry when device comes online', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    applyAckTimeout(cmd);
    applyRetry(cmd, true);
    assert.equal(cmd.status, 'acknowledged');
  });

  it('should fail after max retry duration (2 minutes)', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    applyAckTimeout(cmd);
    cmd.createdAt = Date.now() - MAX_RETRY_DURATION - 1000;
    applyRetry(cmd, false);
    assert.equal(cmd.status, 'failed');
  });

  it('should increment retry count', () => {
    const cmd = createCommandObject(1, 'Valid reason text here', 'admin');
    applyAckTimeout(cmd);
    applyRetry(cmd, false);
    applyRetry(cmd, false);
    assert.equal(cmd.retryCount, 2);
  });
});
