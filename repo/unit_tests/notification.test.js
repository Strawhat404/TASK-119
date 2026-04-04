import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production logic from lib
import {
  resolveTemplate,
  createNotificationObject,
  applyDelivery,
  applyFailedDelivery,
  TEMPLATES,
  MAX_RETRIES
} from '../frontend/js/lib/notification-logic.js';

describe('Template Variable Substitution', () => {
  it('should substitute single variable', () => {
    const msg = resolveTemplate('reservation_approved', { reservationId: '42' });
    assert.equal(msg, 'Your reservation #42 has been approved.');
  });

  it('should substitute multiple variables', () => {
    const msg = resolveTemplate('reservation_reminder_24h', { reservationId: '7', zone: 'Lobby' });
    assert.equal(msg, 'Reminder: Your reservation #7 at Lobby is in 24 hours.');
  });

  it('should substitute doorName in unlock template', () => {
    const msg = resolveTemplate('unlock_success', { doorName: 'Main Entrance' });
    assert.equal(msg, 'Door "Main Entrance" has been unlocked successfully.');
  });

  it('should handle unknown template by returning raw string', () => {
    const msg = resolveTemplate('unknown_template', {});
    assert.equal(msg, 'unknown_template');
  });

  it('should handle missing variables (leave placeholder)', () => {
    const msg = resolveTemplate('reservation_approved', {});
    assert.equal(msg, 'Your reservation #{reservationId} has been approved.');
  });

  it('should substitute all occurrences of same variable', () => {
    const msg = resolveTemplate('missing_materials', { reservationId: '10', details: 'badges' });
    assert.ok(msg.includes('#10'));
    assert.ok(msg.includes('badges'));
  });

  it('should handle content_flagged template', () => {
    const msg = resolveTemplate('content_flagged', { contentTitle: 'Policy Doc' });
    assert.equal(msg, 'Content "Policy Doc" has been flagged for review.');
  });

  it('should handle user_banned template with multiple variables', () => {
    const msg = resolveTemplate('user_banned', { username: 'testuser', reason: 'Violation' });
    assert.equal(msg, 'Account "testuser" has been banned. Reason: Violation');
  });
});

describe('Notification Retry Counting', () => {
  it('should start with 0 retries', () => {
    const notif = createNotificationObject({ templateId: 'reservation_approved', variables: { reservationId: '1' } });
    assert.equal(notif.retryCount, 0);
    assert.equal(notif.status, 'pending');
  });

  it('should increment retry count on failure', () => {
    const notif = createNotificationObject({ templateId: 'reservation_approved', variables: { reservationId: '1' } });
    applyFailedDelivery(notif);
    assert.equal(notif.retryCount, 1);
  });

  it('should mark as failed after 3 retries', () => {
    const notif = createNotificationObject({ templateId: 'reservation_approved', variables: { reservationId: '1' } });
    applyFailedDelivery(notif);
    applyFailedDelivery(notif);
    applyFailedDelivery(notif);
    assert.equal(notif.status, 'failed');
    assert.equal(notif.retryCount, MAX_RETRIES);
    assert.ok(notif.failedAt);
  });

  it('should mark as delivered on success', () => {
    const notif = createNotificationObject({ templateId: 'reservation_approved', variables: { reservationId: '1' } });
    applyDelivery(notif);
    assert.equal(notif.status, 'delivered');
    assert.ok(notif.deliveredAt);
  });

  it('should succeed after previous failures', () => {
    const notif = createNotificationObject({ templateId: 'reservation_approved', variables: { reservationId: '1' } });
    applyFailedDelivery(notif);
    applyFailedDelivery(notif);
    applyDelivery(notif);
    assert.equal(notif.status, 'delivered');
    assert.equal(notif.retryCount, 2);
  });

  it('should use correct MAX_RETRIES constant', () => {
    assert.equal(MAX_RETRIES, 3);
  });
});

describe('Scheduled Notifications', () => {
  it('should set scheduledFor for future notifications', () => {
    const future = Date.now() + 3600000;
    const notif = createNotificationObject({
      templateId: 'reservation_reminder_1h',
      variables: { reservationId: '1', zone: 'Dock' },
      scheduledFor: future
    });
    assert.equal(notif.scheduledFor, future);
  });

  it('should default scheduledFor to now', () => {
    const before = Date.now();
    const notif = createNotificationObject({
      templateId: 'reservation_approved',
      variables: { reservationId: '1' }
    });
    assert.ok(notif.scheduledFor >= before);
    assert.ok(notif.scheduledFor <= Date.now());
  });
});

describe('Template Registry', () => {
  it('should contain all expected templates', () => {
    const expected = [
      'reservation_approved', 'reservation_denied', 'reservation_reminder_24h',
      'reservation_reminder_1h', 'unlock_success', 'unlock_failed',
      'content_flagged', 'content_published', 'overdue_item',
      'missing_materials', 'account_locked', 'user_banned'
    ];
    for (const key of expected) {
      assert.ok(TEMPLATES[key], `Missing template: ${key}`);
    }
  });
});
