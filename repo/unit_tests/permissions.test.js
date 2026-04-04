import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production logic from lib
import {
  calculatePermissionWindow,
  isWithinPermissionWindow,
  createPermissionObject,
  consumeEntry,
  getPermissionStatusLabel,
  WINDOW_BEFORE_MS,
  WINDOW_AFTER_MS
} from '../frontend/js/lib/permissions-logic.js';

describe('Permission Time Window', () => {
  it('should calculate window 15 min before to 30 min after', () => {
    const startTime = '2026-06-15T10:00:00';
    const { windowStart, windowEnd } = calculatePermissionWindow(startTime);
    const start = new Date(startTime).getTime();

    assert.equal(windowStart, start - WINDOW_BEFORE_MS);
    assert.equal(windowEnd, start + WINDOW_AFTER_MS);
  });

  it('should use correct window constants', () => {
    assert.equal(WINDOW_BEFORE_MS, 15 * 60 * 1000);
    assert.equal(WINDOW_AFTER_MS, 30 * 60 * 1000);
  });

  it('should detect time within window', () => {
    const startTime = '2026-06-15T10:00:00';
    const perm = createPermissionObject(startTime);
    const start = new Date(startTime).getTime();

    assert.equal(isWithinPermissionWindow(perm, start), true);
    assert.equal(isWithinPermissionWindow(perm, start - 10 * 60 * 1000), true);
    assert.equal(isWithinPermissionWindow(perm, start + 20 * 60 * 1000), true);
  });

  it('should detect time outside window (too early)', () => {
    const startTime = '2026-06-15T10:00:00';
    const perm = createPermissionObject(startTime);
    const start = new Date(startTime).getTime();

    assert.equal(isWithinPermissionWindow(perm, start - 20 * 60 * 1000), false);
  });

  it('should detect time outside window (too late)', () => {
    const startTime = '2026-06-15T10:00:00';
    const perm = createPermissionObject(startTime);
    const start = new Date(startTime).getTime();

    assert.equal(isWithinPermissionWindow(perm, start + 31 * 60 * 1000), false);
  });

  it('should allow at exact boundary (15 min before)', () => {
    const startTime = '2026-06-15T10:00:00';
    const perm = createPermissionObject(startTime);
    assert.equal(isWithinPermissionWindow(perm, perm.windowStart), true);
  });

  it('should allow at exact boundary (30 min after)', () => {
    const startTime = '2026-06-15T10:00:00';
    const perm = createPermissionObject(startTime);
    assert.equal(isWithinPermissionWindow(perm, perm.windowEnd), true);
  });
});

describe('Single-Use Permission', () => {
  it('should allow one entry', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'single-use');
    const now = new Date('2026-06-15T10:00:00').getTime();

    assert.equal(perm.maxEntries, 1);
    const result = consumeEntry(perm, now);
    assert.equal(result.success, true);
    assert.equal(perm.status, 'consumed');
  });

  it('should reject second entry on single-use', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'single-use');
    const now = new Date('2026-06-15T10:00:00').getTime();

    consumeEntry(perm, now);
    const result = consumeEntry(perm, now);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('consumed'));
  });
});

describe('Multi-Use Permission', () => {
  it('should allow up to 5 entries', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'multi-use');
    const now = new Date('2026-06-15T10:00:00').getTime();

    assert.equal(perm.maxEntries, 5);

    for (let i = 0; i < 5; i++) {
      const result = consumeEntry(perm, now);
      assert.equal(result.success, true);
    }
    assert.equal(perm.status, 'consumed');
    assert.equal(perm.usedEntries, 5);
  });

  it('should reject 6th entry on multi-use', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'multi-use');
    const now = new Date('2026-06-15T10:00:00').getTime();

    for (let i = 0; i < 5; i++) consumeEntry(perm, now);
    const result = consumeEntry(perm, now);
    assert.equal(result.success, false);
  });

  it('should track used entries count', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'multi-use');
    const now = new Date('2026-06-15T10:00:00').getTime();

    consumeEntry(perm, now);
    assert.equal(perm.usedEntries, 1);
    consumeEntry(perm, now);
    assert.equal(perm.usedEntries, 2);
  });
});

describe('Permission Edge Cases', () => {
  it('should reject entry outside time window', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'single-use');
    const tooEarly = new Date('2026-06-15T10:00:00').getTime() - 20 * 60 * 1000;

    const result = consumeEntry(perm, tooEarly);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Outside'));
  });

  it('should reject entry on expired permission', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00', 'single-use');
    perm.status = 'expired';

    const result = consumeEntry(perm, Date.now());
    assert.equal(result.success, false);
    assert.ok(result.error.includes('expired'));
  });
});

describe('Permission Status Label', () => {
  it('should return Consumed for consumed permission', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00');
    perm.status = 'consumed';
    assert.equal(getPermissionStatusLabel(perm), 'Consumed');
  });

  it('should return Expired for expired permission', () => {
    const perm = createPermissionObject('2026-06-15T10:00:00');
    perm.status = 'expired';
    assert.equal(getPermissionStatusLabel(perm), 'Expired');
  });
});
