import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import production logic modules for behavioral integration tests
import {
  validatePassword, ROLE_DEFINITIONS, hasPermissionForRole,
  isAccountLocked, processFailedLogin, processSuccessfulLogin,
  isSessionExpired, isSessionWarningDue,
  MAX_ATTEMPTS, LOCKOUT_DURATION, SESSION_TIMEOUT, SESSION_WARNING
} from '../frontend/js/lib/auth-logic.js';
import {
  resolveTemplate, TEMPLATES, createNotificationObject,
  applyDelivery, applyFailedDelivery, MAX_RETRIES
} from '../frontend/js/lib/notification-logic.js';
import {
  scanContent, canTransition, WORKFLOW_STATES, VALID_TRANSITIONS, generateDiff
} from '../frontend/js/lib/content-logic.js';
import {
  calculatePermissionWindow, createPermissionObject, consumeEntry,
  isWithinPermissionWindow, getPermissionStatusLabel,
  WINDOW_BEFORE_MS, WINDOW_AFTER_MS
} from '../frontend/js/lib/permissions-logic.js';
import {
  validateUnlockReason, createCommandObject,
  applyAckTimeout, applyAck, applyRetry,
  ACK_TIMEOUT, MAX_RETRY_DURATION, MIN_REASON_LENGTH
} from '../frontend/js/lib/device-logic.js';
import { formatAuditTimestamp, createAuditEntry } from '../frontend/js/lib/audit-logic.js';
import {
  distanceFeet, searchByRadius, searchByZone,
  pointInPolygon, searchByPolygon,
  calculateWalkTime, planRoute, getEntryPoints, suggestNearestEntry,
  DEFAULT_WALK_SPEED_MPH, FEET_PER_MILE
} from '../frontend/js/lib/map-logic.js';

// ============================================================================
// AUTH — Password Policy
// ============================================================================

describe('Auth — Password Policy', () => {
  it('should reject passwords shorter than 12 characters', () => {
    const result = validatePassword('Short1!abc');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('12 characters')));
  });

  it('should reject passwords missing uppercase', () => {
    const result = validatePassword('alllowercase1!');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('uppercase')));
  });

  it('should reject passwords missing lowercase', () => {
    const result = validatePassword('ALLUPPERCASE1!');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('lowercase')));
  });

  it('should reject passwords missing numbers', () => {
    const result = validatePassword('NoNumbersHere!@');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('number')));
  });

  it('should reject passwords missing symbols', () => {
    const result = validatePassword('NoSymbolHere1A');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('symbol')));
  });

  it('should accept a fully compliant password', () => {
    const result = validatePassword('StrongP@ss12345');
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should accumulate multiple failing rules', () => {
    const result = validatePassword('a');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3, `Expected >=3 errors, got ${result.errors.length}`);
  });
});

// ============================================================================
// AUTH — Account Lockout
// ============================================================================

describe('Auth — Account Lockout', () => {
  it('should not lock before reaching MAX_ATTEMPTS', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const r = processFailedLogin(user);
      assert.equal(r.locked, false);
      assert.equal(r.attemptsLeft, MAX_ATTEMPTS - (i + 1));
    }
  });

  it('should lock account on the 5th failed attempt', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) processFailedLogin(user);
    const final = processFailedLogin(user);
    assert.equal(final.locked, true);
    assert.ok(user.lockedUntil > Date.now());
  });

  it('lockout duration should be exactly 15 minutes', () => {
    assert.equal(LOCKOUT_DURATION, 15 * 60 * 1000);
  });

  it('should report locked state during lockout window', () => {
    const now = Date.now();
    assert.equal(isAccountLocked({ lockedUntil: now + 60000 }, now), true);
  });

  it('should report unlocked after lockout expires', () => {
    const now = Date.now();
    assert.equal(isAccountLocked({ lockedUntil: now - 1000 }, now), false);
  });

  it('should report unlocked when no lockout set', () => {
    assert.equal(isAccountLocked({ lockedUntil: null }), false);
  });

  it('successful login should reset failed attempts and lockout', () => {
    const user = { failedAttempts: 3, lockedUntil: Date.now() + 60000 };
    processSuccessfulLogin(user);
    assert.equal(user.failedAttempts, 0);
    assert.equal(user.lockedUntil, null);
    assert.ok(user.lastLogin > 0);
  });
});

// ============================================================================
// AUTH — Session Expiry
// ============================================================================

describe('Auth — Session Expiry', () => {
  it('session timeout should be 30 minutes', () => {
    assert.equal(SESSION_TIMEOUT, 30 * 60 * 1000);
  });

  it('session warning should be at 25 minutes', () => {
    assert.equal(SESSION_WARNING, 25 * 60 * 1000);
  });

  it('should not expire a fresh session', () => {
    assert.equal(isSessionExpired({ lastActivity: Date.now() }), false);
  });

  it('should expire a session after 30 minutes of inactivity', () => {
    assert.equal(isSessionExpired({ lastActivity: Date.now() - SESSION_TIMEOUT - 1000 }), true);
  });

  it('should trigger warning at 25 minutes', () => {
    const now = Date.now();
    assert.equal(isSessionWarningDue({ lastActivity: now - SESSION_WARNING - 1000 }, now), true);
    assert.equal(isSessionWarningDue({ lastActivity: now - SESSION_WARNING + 5000 }, now), false);
  });
});

// ============================================================================
// AUTH — Role Permission Matrix
// ============================================================================

describe('Auth — Role Permission Matrix', () => {
  it('should define exactly 4 roles', () => {
    assert.equal(ROLE_DEFINITIONS.length, 4);
    const names = ROLE_DEFINITIONS.map(r => r.name).sort();
    assert.deepStrictEqual(names, ['admin', 'operator', 'reviewer', 'visitor']);
  });

  it('admin should have wildcard permissions', () => {
    assert.ok(ROLE_DEFINITIONS.find(r => r.name === 'admin').permissions.includes('*'));
  });

  it('admin has access to everything', () => {
    assert.equal(hasPermissionForRole('admin', 'reservations.manage'), true);
    assert.equal(hasPermissionForRole('admin', 'devices.unlock'), true);
    assert.equal(hasPermissionForRole('admin', 'content.moderate'), true);
    assert.equal(hasPermissionForRole('admin', 'anything.at.all'), true);
  });

  it('visitor has limited access', () => {
    assert.equal(hasPermissionForRole('visitor', 'reservations.view'), true);
    assert.equal(hasPermissionForRole('visitor', 'reservations.create'), true);
    assert.equal(hasPermissionForRole('visitor', 'reservations.manage'), false);
    assert.equal(hasPermissionForRole('visitor', 'devices.unlock'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.view'), false);
  });

  it('operator has device access but not content', () => {
    assert.equal(hasPermissionForRole('operator', 'devices.unlock'), true);
    assert.equal(hasPermissionForRole('operator', 'devices.view'), true);
    assert.equal(hasPermissionForRole('operator', 'reservations.manage'), true);
    assert.equal(hasPermissionForRole('operator', 'content.review'), false);
    assert.equal(hasPermissionForRole('operator', 'content.moderate'), false);
  });

  it('reviewer has content access but not devices', () => {
    assert.equal(hasPermissionForRole('reviewer', 'content.view'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.review'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.moderate'), true);
    assert.equal(hasPermissionForRole('reviewer', 'devices.unlock'), false);
  });

  it('unknown role returns false', () => {
    assert.equal(hasPermissionForRole('unknown_role', 'reservations.view'), false);
  });
});

// ============================================================================
// PERMISSIONS — Window & Consumption
// ============================================================================

describe('Permissions — Window & Consumption', () => {
  it('should create 15-min-before / 30-min-after permission window', () => {
    const startTime = Date.now() + 3600000;
    const w = calculatePermissionWindow(startTime);
    assert.equal(w.windowStart, startTime - WINDOW_BEFORE_MS);
    assert.equal(w.windowEnd, startTime + WINDOW_AFTER_MS);
  });

  it('should create single-use permission with maxEntries=1', () => {
    const perm = createPermissionObject(Date.now(), 'single-use');
    assert.equal(perm.maxEntries, 1);
    assert.equal(perm.usedEntries, 0);
    assert.equal(perm.status, 'active');
    assert.equal(perm.policy, 'single-use');
  });

  it('should create multi-use permission with maxEntries=5', () => {
    const perm = createPermissionObject(Date.now(), 'multi-use');
    assert.equal(perm.maxEntries, 5);
    assert.equal(perm.policy, 'multi-use');
  });

  it('should consume single-use permission and mark consumed', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');
    const r = consumeEntry(perm, now);
    assert.equal(r.success, true);
    assert.equal(perm.status, 'consumed');
    assert.equal(perm.usedEntries, 1);
  });

  it('should reject consumption of already consumed permission', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');
    consumeEntry(perm, now);
    const r = consumeEntry(perm, now);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('consumed'));
  });

  it('should allow 5 consumptions on multi-use then reject', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'multi-use');
    for (let i = 0; i < 4; i++) {
      assert.equal(consumeEntry(perm, now).success, true);
      assert.equal(perm.status, 'active');
    }
    assert.equal(consumeEntry(perm, now).success, true);
    assert.equal(perm.status, 'consumed');
    assert.equal(consumeEntry(perm, now).success, false);
  });

  it('should reject consumption outside time window', () => {
    const farFuture = Date.now() + 999999999;
    const perm = createPermissionObject(farFuture, 'single-use');
    const r = consumeEntry(perm, Date.now());
    assert.equal(r.success, false);
    assert.ok(r.error.includes('window'));
  });

  it('should reject consumption of expired permission', () => {
    const perm = createPermissionObject(Date.now(), 'single-use');
    perm.status = 'expired';
    assert.equal(consumeEntry(perm, Date.now()).success, false);
  });

  it('should correctly detect within/outside window', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');
    assert.equal(isWithinPermissionWindow(perm, now), true);
    assert.equal(isWithinPermissionWindow(perm, now + WINDOW_AFTER_MS + 60000), false);
  });

  it('should return correct status labels', () => {
    const now = Date.now();
    assert.equal(getPermissionStatusLabel(createPermissionObject(now, 'single-use'), now), 'Active');

    const consumed = createPermissionObject(now, 'single-use');
    consumeEntry(consumed, now);
    assert.equal(getPermissionStatusLabel(consumed, now), 'Consumed');

    assert.equal(getPermissionStatusLabel(createPermissionObject(now + 999999999, 'single-use'), now), 'Pending');
  });
});

// ============================================================================
// CONTENT — Workflow & Compliance
// ============================================================================

describe('Content — Workflow Transitions', () => {
  it('should define exactly 4 workflow states', () => {
    assert.equal(WORKFLOW_STATES.length, 4);
    assert.deepStrictEqual(WORKFLOW_STATES, ['draft', 'review', 'published', 'archived']);
  });

  it('should allow valid transitions', () => {
    assert.equal(canTransition('draft', 'review'), true);
    assert.equal(canTransition('review', 'published'), true);
    assert.equal(canTransition('review', 'draft'), true);
    assert.equal(canTransition('published', 'archived'), true);
    assert.equal(canTransition('published', 'draft'), true);
    assert.equal(canTransition('archived', 'draft'), true);
  });

  it('should reject invalid transitions', () => {
    assert.equal(canTransition('draft', 'published'), false);
    assert.equal(canTransition('draft', 'archived'), false);
    assert.equal(canTransition('review', 'archived'), false);
    assert.equal(canTransition('archived', 'published'), false);
    assert.equal(canTransition('archived', 'review'), false);
  });
});

describe('Content — Compliance Scanning', () => {
  it('should detect SSN patterns', () => {
    const v = scanContent('SSN: 123-45-6789');
    assert.ok(v.some(x => x.ruleId === 'pii'));
  });

  it('should detect credit card number patterns', () => {
    const v = scanContent('Card: 1234567890123456');
    assert.ok(v.some(x => x.ruleId === 'pii'));
  });

  it('should detect restricted words', () => {
    const v = scanContent('This content is banned and restricted');
    assert.ok(v.some(x => x.ruleId === 'profanity'));
    assert.ok(v.find(x => x.ruleId === 'profanity').matches >= 2);
  });

  it('should detect external URLs', () => {
    const v = scanContent('Visit https://example.com');
    assert.ok(v.some(x => x.ruleId === 'url'));
  });

  it('should return no violations for clean content', () => {
    assert.equal(scanContent('Perfectly clean paragraph.').length, 0);
  });

  it('should detect multiple violation types in same text', () => {
    const v = scanContent('SSN 123-45-6789 at https://evil.com, this is banned');
    assert.ok(v.length >= 3);
  });
});

describe('Content — Diff Generation', () => {
  it('should detect changed lines', () => {
    const diff = generateDiff('line1\nline2\nline3', 'line1\nmodified\nline3');
    assert.ok(diff.some(d => d.type === 'removed' && d.content === 'line2'));
    assert.ok(diff.some(d => d.type === 'added' && d.content === 'modified'));
  });

  it('should detect added lines', () => {
    const diff = generateDiff('line1', 'line1\nline2');
    assert.ok(diff.some(d => d.type === 'added' && d.content === 'line2'));
  });

  it('should detect removed lines', () => {
    const diff = generateDiff('line1\nline2', 'line1');
    assert.ok(diff.some(d => d.type === 'removed' && d.content === 'line2'));
  });

  it('should show unchanged lines', () => {
    const diff = generateDiff('same\nsame', 'same\nsame');
    assert.ok(diff.every(d => d.type === 'unchanged'));
  });
});

// ============================================================================
// DEVICE — Command Lifecycle
// ============================================================================

describe('Device — Unlock Reason Validation', () => {
  it('should reject empty reason', () => {
    assert.equal(validateUnlockReason('').valid, false);
    assert.equal(validateUnlockReason(null).valid, false);
  });

  it('should reject reason shorter than 10 characters', () => {
    assert.equal(validateUnlockReason('short').valid, false);
  });

  it('should accept valid reason', () => {
    assert.equal(validateUnlockReason('This is a valid reason for unlock').valid, true);
  });

  it('MIN_REASON_LENGTH should be 10', () => {
    assert.equal(MIN_REASON_LENGTH, 10);
  });
});

describe('Device — Command State Machine', () => {
  it('should create a pending command', () => {
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    assert.equal(cmd.deviceId, 1);
    assert.equal(cmd.status, 'pending');
    assert.equal(cmd.retryCount, 0);
    assert.equal(cmd.type, 'unlock');
    assert.equal(cmd.actor, 'admin');
    assert.equal(cmd.ackAt, null);
  });

  it('pending → queued on ACK timeout', () => {
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    applyAckTimeout(cmd);
    assert.equal(cmd.status, 'queued');
  });

  it('should not change non-pending status on ACK timeout', () => {
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    cmd.status = 'acknowledged';
    applyAckTimeout(cmd);
    assert.equal(cmd.status, 'acknowledged');
  });

  it('pending → acknowledged on ACK', () => {
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    applyAck(cmd);
    assert.equal(cmd.status, 'acknowledged');
    assert.ok(cmd.ackAt > 0);
  });

  it('retry succeeds when device comes online', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    cmd.createdAt = now;
    applyRetry(cmd, true, now + 10000);
    assert.equal(cmd.status, 'acknowledged');
    assert.equal(cmd.retryCount, 1);
  });

  it('retry keeps queued when device stays offline', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    cmd.createdAt = now;
    cmd.status = 'queued';
    applyRetry(cmd, false, now + 10000);
    assert.equal(cmd.retryCount, 1);
    assert.notEqual(cmd.status, 'acknowledged');
  });

  it('command fails after max retry duration', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Valid reason here', 'admin');
    cmd.createdAt = now - MAX_RETRY_DURATION - 1000;
    applyRetry(cmd, false, now);
    assert.equal(cmd.status, 'failed');
  });

  it('ACK_TIMEOUT should be 2 seconds', () => {
    assert.equal(ACK_TIMEOUT, 2000);
  });

  it('MAX_RETRY_DURATION should be 2 minutes', () => {
    assert.equal(MAX_RETRY_DURATION, 120000);
  });
});

// ============================================================================
// NOTIFICATIONS — Templates & Retry
// ============================================================================

describe('Notifications — Template Resolution', () => {
  it('should resolve all templates with complete variables', () => {
    const vars = {
      reservationId: '42', zone: 'Lobby', doorName: 'Main Gate',
      contentTitle: 'Policy Doc', itemDescription: 'Badge',
      details: 'missing ID', username: 'testuser', reason: 'policy violation'
    };
    for (const [id, _template] of Object.entries(TEMPLATES)) {
      const msg = resolveTemplate(id, vars);
      assert.ok(typeof msg === 'string' && msg.length > 0, `${id} failed`);
      assert.ok(!msg.includes('{'), `${id} has unresolved placeholder: ${msg}`);
    }
  });

  it('should leave placeholders when variables are missing', () => {
    const msg = resolveTemplate('reservation_approved', {});
    assert.ok(msg.includes('{reservationId}'));
  });

  it('should return templateId for unknown templates', () => {
    assert.equal(resolveTemplate('nonexistent', {}), 'nonexistent');
  });

  it('should substitute the same variable multiple times', () => {
    const msg = resolveTemplate('missing_materials', { reservationId: '99', details: 'badges' });
    assert.ok(msg.includes('99'));
    assert.ok(msg.includes('badges'));
  });
});

describe('Notifications — Lifecycle State Machine', () => {
  it('should create notification with correct initial state', () => {
    const n = createNotificationObject({
      userId: 42, templateId: 'reservation_approved',
      variables: { reservationId: '7' }, type: 'success'
    });
    assert.equal(n.userId, 42);
    assert.equal(n.status, 'pending');
    assert.equal(n.retryCount, 0);
    assert.equal(n.type, 'success');
    assert.equal(n.read, false);
    assert.ok(n.message.includes('7'));
    assert.equal(n.deliveredAt, null);
    assert.equal(n.failedAt, null);
  });

  it('should mark as delivered', () => {
    const n = createNotificationObject({ templateId: 'account_locked', variables: {} });
    applyDelivery(n);
    assert.equal(n.status, 'delivered');
    assert.ok(n.deliveredAt > 0);
  });

  it('should keep pending status when retries remain', () => {
    const n = createNotificationObject({ templateId: 'account_locked', variables: {} });
    applyFailedDelivery(n);
    assert.equal(n.retryCount, 1);
    assert.equal(n.status, 'pending');
  });

  it('should mark as failed only after MAX_RETRIES exhausted', () => {
    const n = createNotificationObject({ templateId: 'account_locked', variables: {} });
    for (let i = 0; i < MAX_RETRIES; i++) applyFailedDelivery(n);
    assert.equal(n.status, 'failed');
    assert.equal(n.retryCount, MAX_RETRIES);
    assert.ok(n.failedAt > 0);
  });

  it('MAX_RETRIES should be 3', () => {
    assert.equal(MAX_RETRIES, 3);
  });

  it('delivery after partial failures should succeed', () => {
    const n = createNotificationObject({ templateId: 'account_locked', variables: {} });
    applyFailedDelivery(n);
    applyFailedDelivery(n);
    applyDelivery(n);
    assert.equal(n.status, 'delivered');
    assert.equal(n.retryCount, 2);
  });

  it('should support scheduled future notifications', () => {
    const future = Date.now() + 3600000;
    const n = createNotificationObject({
      templateId: 'reservation_reminder_1h',
      variables: { reservationId: '1', zone: 'Dock' },
      scheduledFor: future
    });
    assert.equal(n.scheduledFor, future);
    assert.equal(n.status, 'pending');
  });
});

// ============================================================================
// AUDIT — Entry Creation & Formatting
// ============================================================================

describe('Audit — Entry Creation', () => {
  it('should create entry with all required fields', () => {
    const e = createAuditEntry('user_login', 'admin', { userId: 1 }, null, null, 'admin');
    assert.equal(e.action, 'user_login');
    assert.equal(e.actor, 'admin');
    assert.equal(e.actorRole, 'admin');
    assert.ok(e.timestamp > 0);
    assert.ok(e.formattedTimestamp.length > 0);
    assert.deepStrictEqual(e.details, { userId: 1 });
    assert.equal(e.before, null);
    assert.equal(e.after, null);
  });

  it('should deep-clone before/after snapshots to prevent mutation', () => {
    const before = { status: 'pending' };
    const after = { status: 'approved' };
    const e = createAuditEntry('test', 'op', {}, before, after, 'operator');
    before.status = 'mutated';
    after.status = 'mutated';
    assert.equal(e.before.status, 'pending');
    assert.equal(e.after.status, 'approved');
  });

  it('should default actor to system when null', () => {
    assert.equal(createAuditEntry('test', null, {}).actor, 'system');
  });

  it('should deep-clone details', () => {
    const details = { foo: 'bar' };
    const e = createAuditEntry('test', 'x', details);
    details.foo = 'mutated';
    assert.equal(e.details.foo, 'bar');
  });
});

describe('Audit — Timestamp Formatting', () => {
  it('should format as MM/DD/YYYY h:mm:ss AM/PM', () => {
    const ts = new Date('2026-04-02T14:30:00').getTime();
    const f = formatAuditTimestamp(ts);
    assert.ok(/^\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2}:\d{2} (AM|PM)$/.test(f), `Bad format: ${f}`);
    assert.ok(f.includes('2026'));
    assert.ok(f.includes('PM'));
  });

  it('should handle midnight correctly', () => {
    const ts = new Date('2026-01-15T00:05:30').getTime();
    const f = formatAuditTimestamp(ts);
    assert.ok(f.includes('AM'));
    assert.ok(f.startsWith('01/15/2026'));
  });

  it('should handle noon correctly', () => {
    const ts = new Date('2026-06-01T12:00:00').getTime();
    const f = formatAuditTimestamp(ts);
    assert.ok(f.includes('PM'));
  });
});

// ============================================================================
// MAP — Spatial Operations
// ============================================================================

describe('Map — Distance Calculation', () => {
  it('should calculate Pythagorean distance (3-4-5)', () => {
    assert.equal(distanceFeet({ x: 0, y: 0 }, { x: 300, y: 400 }), 500);
  });

  it('should return 0 for same point', () => {
    assert.equal(distanceFeet({ x: 100, y: 200 }, { x: 100, y: 200 }), 0);
  });

  it('should be symmetric', () => {
    const a = { x: 10, y: 20 }, b = { x: 50, y: 80 };
    assert.equal(distanceFeet(a, b), distanceFeet(b, a));
  });
});

describe('Map — Radius Search', () => {
  const pois = [
    { id: 1, x: 100, y: 100 },
    { id: 2, x: 5000, y: 5000 },
    { id: 3, x: 150, y: 150 }
  ];

  it('should find POIs within radius', () => {
    const r = searchByRadius(pois, { x: 0, y: 0 }, 250);
    assert.equal(r.length, 2);
    assert.ok(r.some(p => p.id === 1));
    assert.ok(r.some(p => p.id === 3));
  });

  it('should return empty for no matches', () => {
    assert.equal(searchByRadius(pois, { x: 0, y: 0 }, 10).length, 0);
  });

  it('should return all for very large radius', () => {
    assert.equal(searchByRadius(pois, { x: 0, y: 0 }, 999999).length, 3);
  });
});

describe('Map — Zone Search', () => {
  it('should filter POIs by zone', () => {
    const pois = [{ id: 1, zone: 'lobby' }, { id: 2, zone: 'dock' }, { id: 3, zone: 'lobby' }];
    const r = searchByZone(pois, 'lobby');
    assert.equal(r.length, 2);
  });

  it('should return empty for unknown zone', () => {
    assert.equal(searchByZone([{ id: 1, zone: 'lobby' }], 'nonexistent').length, 0);
  });
});

describe('Map — Polygon Search', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  it('should detect point inside polygon', () => {
    assert.equal(pointInPolygon({ x: 50, y: 50 }, square), true);
  });

  it('should detect point outside polygon', () => {
    assert.equal(pointInPolygon({ x: 200, y: 200 }, square), false);
  });

  it('should search POIs within polygon geofence', () => {
    const pois = [{ id: 1, x: 50, y: 50 }, { id: 2, x: 200, y: 200 }, { id: 3, x: 75, y: 75 }];
    const r = searchByPolygon(pois, square);
    assert.equal(r.length, 2);
    assert.ok(r.every(p => p.id !== 2));
  });
});

describe('Map — Walk Time & Route Planning', () => {
  it('should calculate 20 min for 1 mile at 3 mph', () => {
    assert.equal(calculateWalkTime(FEET_PER_MILE, DEFAULT_WALK_SPEED_MPH), 20);
  });

  it('should plan single-segment route', () => {
    const r = planRoute({ x: 0, y: 0 }, { x: 300, y: 400 });
    assert.equal(r.totalDistanceFeet, 500);
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].distanceFeet, 500);
  });

  it('should plan multi-waypoint route', () => {
    const r = planRoute({ x: 0, y: 0 }, { x: 600, y: 0 }, [{ x: 300, y: 0 }]);
    assert.equal(r.segments.length, 2);
    assert.equal(r.totalDistanceFeet, 600);
  });

  it('should suggest nearest entry point', () => {
    const pois = [
      { id: 1, type: 'entry', x: 100, y: 0 },
      { id: 2, type: 'entry', x: 500, y: 0 },
      { id: 3, type: 'general', x: 10, y: 0 }
    ];
    const r = suggestNearestEntry(pois, { x: 0, y: 0 });
    assert.equal(r.poi.id, 1);
    assert.equal(r.distanceFeet, 100);
  });

  it('should return null when no entry points exist', () => {
    assert.equal(suggestNearestEntry([{ id: 1, type: 'general', x: 0, y: 0 }], { x: 0, y: 0 }), null);
  });

  it('should filter entry points correctly', () => {
    const pois = [
      { type: 'entry' }, { type: 'exit' }, { type: 'entry' }, { type: 'general' }
    ];
    assert.equal(getEntryPoints(pois).length, 2);
  });
});

// ============================================================================
// CROSS-MODULE — End-to-end Integration
// ============================================================================

describe('Integration — Permission Full Lifecycle', () => {
  it('create → consume → reject re-consume (single-use)', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');
    assert.equal(getPermissionStatusLabel(perm, now), 'Active');
    assert.equal(consumeEntry(perm, now).success, true);
    assert.equal(getPermissionStatusLabel(perm, now), 'Consumed');
    assert.equal(consumeEntry(perm, now).success, false);
  });

  it('create → consume×5 → reject (multi-use)', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'multi-use');
    for (let i = 0; i < 5; i++) assert.equal(consumeEntry(perm, now).success, true);
    assert.equal(perm.status, 'consumed');
    assert.equal(consumeEntry(perm, now).success, false);
  });
});

describe('Integration — Auth Lockout → Audit Trail', () => {
  it('should produce audit-ready entries through a lockout sequence', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    for (let i = 0; i < MAX_ATTEMPTS; i++) processFailedLogin(user);
    assert.ok(user.lockedUntil > Date.now());

    const entry = createAuditEntry('account_locked', 'testuser', { reason: 'max_failed_attempts' });
    assert.equal(entry.action, 'account_locked');
    assert.equal(entry.details.reason, 'max_failed_attempts');

    assert.equal(isAccountLocked(user), true);
    user.lockedUntil = Date.now() - 1;
    assert.equal(isAccountLocked(user), false);
    processSuccessfulLogin(user);
    assert.equal(user.failedAttempts, 0);
  });
});

describe('Integration — Device Command → Retry → Fail/Succeed', () => {
  it('should model full command lifecycle: create → timeout → retry → ack', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Maintenance unlock needed', 'operator');
    assert.equal(cmd.status, 'pending');

    applyAckTimeout(cmd);
    assert.equal(cmd.status, 'queued');

    applyRetry(cmd, false, now + 10000);
    assert.equal(cmd.retryCount, 1);

    applyRetry(cmd, true, now + 20000);
    assert.equal(cmd.status, 'acknowledged');
    assert.equal(cmd.retryCount, 2);
  });

  it('should model full command lifecycle: create → timeout → exhaust retries → fail', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Emergency unlock needed', 'admin');
    cmd.createdAt = now - MAX_RETRY_DURATION - 1;

    applyAckTimeout(cmd);
    applyRetry(cmd, false, now);
    assert.equal(cmd.status, 'failed');
  });
});

describe('Integration — Content Compliance + Workflow', () => {
  it('should detect violations and block publish via workflow', () => {
    const violations = scanContent('SSN: 123-45-6789');
    assert.ok(violations.length > 0);
    // Content with violations should not be publishable from draft directly
    assert.equal(canTransition('draft', 'published'), false);
    // Must go through review first
    assert.equal(canTransition('draft', 'review'), true);
    assert.equal(canTransition('review', 'published'), true);
  });
});
