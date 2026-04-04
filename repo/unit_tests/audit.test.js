import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production logic from lib
import { formatAuditTimestamp, createAuditEntry } from '../frontend/js/lib/audit-logic.js';

describe('Audit Log Entry Creation', () => {
  it('should create entry with all fields', () => {
    const entry = createAuditEntry('user_login', 'admin', { userId: 1 });
    assert.ok(entry.timestamp);
    assert.ok(entry.formattedTimestamp);
    assert.equal(entry.actor, 'admin');
    assert.equal(entry.action, 'user_login');
    assert.deepEqual(entry.details, { userId: 1 });
    assert.equal(entry.before, null);
    assert.equal(entry.after, null);
  });

  it('should store before/after snapshots', () => {
    const before = { status: 'pending', name: 'Test' };
    const after = { status: 'approved', name: 'Test' };
    const entry = createAuditEntry('reservation_approved', 'operator', {}, before, after);

    assert.deepEqual(entry.before, { status: 'pending', name: 'Test' });
    assert.deepEqual(entry.after, { status: 'approved', name: 'Test' });
  });

  it('should deep-copy before/after to ensure immutability', () => {
    const before = { status: 'pending' };
    const entry = createAuditEntry('test', 'system', {}, before, null);

    before.status = 'modified';
    assert.equal(entry.before.status, 'pending');
  });

  it('should deep-copy details to ensure immutability', () => {
    const details = { key: 'original' };
    const entry = createAuditEntry('test', 'system', details);

    details.key = 'modified';
    assert.equal(entry.details.key, 'original');
  });
});

describe('Audit Timestamp Format (MM/DD/YYYY 12-hour)', () => {
  it('should format morning time correctly', () => {
    const ts = new Date(2026, 0, 15, 9, 5, 30).getTime();
    const formatted = formatAuditTimestamp(ts);
    assert.equal(formatted, '01/15/2026 9:05:30 AM');
  });

  it('should format afternoon time correctly', () => {
    const ts = new Date(2026, 2, 3, 14, 30, 0).getTime();
    const formatted = formatAuditTimestamp(ts);
    assert.equal(formatted, '03/03/2026 2:30:00 PM');
  });

  it('should format midnight as 12:xx AM', () => {
    const ts = new Date(2026, 5, 1, 0, 15, 0).getTime();
    const formatted = formatAuditTimestamp(ts);
    assert.ok(formatted.startsWith('06/01/2026 12:15:00 AM'));
  });

  it('should format noon as 12:xx PM', () => {
    const ts = new Date(2026, 5, 1, 12, 0, 0).getTime();
    const formatted = formatAuditTimestamp(ts);
    assert.ok(formatted.startsWith('06/01/2026 12:00:00 PM'));
  });

  it('should pad month and day with zeros', () => {
    const ts = new Date(2026, 0, 5, 8, 0, 0).getTime();
    const formatted = formatAuditTimestamp(ts);
    assert.ok(formatted.startsWith('01/05/2026'));
  });
});

describe('Audit Before/After Snapshot Format', () => {
  it('should capture role change', () => {
    const entry = createAuditEntry('role_changed', 'admin',
      { targetUser: 'john' },
      { role: 'visitor' },
      { role: 'operator' }
    );
    assert.equal(entry.before.role, 'visitor');
    assert.equal(entry.after.role, 'operator');
  });

  it('should capture ban/unban', () => {
    const entry = createAuditEntry('user_banned', 'admin',
      { targetUser: 'spammer' },
      { banned: false },
      { banned: true }
    );
    assert.equal(entry.before.banned, false);
    assert.equal(entry.after.banned, true);
  });

  it('should capture content workflow transition', () => {
    const entry = createAuditEntry('content_workflow', 'reviewer',
      { contentId: 5, newState: 'published' },
      { workflowState: 'review' },
      { workflowState: 'published' }
    );
    assert.equal(entry.before.workflowState, 'review');
    assert.equal(entry.after.workflowState, 'published');
  });

  it('should handle complex nested details', () => {
    const entry = createAuditEntry('unlock_command', 'operator', {
      deviceId: 1,
      deviceName: 'Main Gate',
      reason: 'Emergency access required',
      commandId: 42
    });
    assert.equal(entry.details.deviceName, 'Main Gate');
    assert.equal(entry.details.commandId, 42);
  });
});
