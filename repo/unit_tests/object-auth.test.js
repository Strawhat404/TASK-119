import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Object-level authorization tests.
 *
 * The service layer enforces ownership and role checks at the object level:
 *   - permissions.consumeEntry: only owner / operator / admin may consume
 *   - permissions.getPermissionsForReservation: only owner / operator / admin
 *   - notifications.getUserNotifications: userId scoping
 *   - auth-service.registerWithRole: only admin actor allowed
 *
 * Since the service modules depend on IndexedDB, we test the authorization
 * decision logic in isolation by replicating the guard conditions.
 */

import { hasPermissionForRole } from '../frontend/js/lib/auth-logic.js';

// --------------------------------------------------------------------------
// Helpers — replicate the object-level guard logic from the service modules
// so we can unit-test the authorization decisions without IndexedDB.
// --------------------------------------------------------------------------

/**
 * Mirrors permissions.js:consumeEntry authorization check (lines 47-51).
 * Returns true if actor is authorized to consume the given permission.
 */
function isAuthorizedToConsume(permission, actor) {
  if (!actor) return false;
  const isOwner = permission.userId === actor.id;
  const isPrivileged = actor.role === 'admin' || actor.role === 'operator';
  return isOwner || isPrivileged;
}

/**
 * Mirrors permissions.js:getPermissionsForReservation authorization (lines 91-98).
 * Returns true if actor may view permissions for the reservation.
 */
function isAuthorizedToViewPermissions(reservation, actor) {
  if (!actor) return false;
  const isOwner = reservation.userId === actor.id;
  const isPrivileged = actor.role === 'admin' || actor.role === 'operator';
  return isOwner || isPrivileged;
}

/**
 * Mirrors auth-service.js:registerWithRole authorization (lines 120-124).
 * Returns true if actor may create users with arbitrary roles.
 */
function isAuthorizedToRegisterWithRole(actor) {
  if (!actor) return false;
  return actor.role === 'admin';
}

// --------------------------------------------------------------------------
// Entry permission — consumeEntry cross-user denial
// --------------------------------------------------------------------------
describe('Object-Level Auth — consumeEntry', () => {
  const permission = { id: 1, userId: 100, reservationId: 10, status: 'active' };

  it('should allow the permission owner to consume', () => {
    const actor = { id: 100, username: 'owner', role: 'visitor' };
    assert.equal(isAuthorizedToConsume(permission, actor), true);
  });

  it('should allow an operator to consume any permission', () => {
    const actor = { id: 200, username: 'op', role: 'operator' };
    assert.equal(isAuthorizedToConsume(permission, actor), true);
  });

  it('should allow an admin to consume any permission', () => {
    const actor = { id: 300, username: 'admin', role: 'admin' };
    assert.equal(isAuthorizedToConsume(permission, actor), true);
  });

  it('should deny a different visitor from consuming', () => {
    const actor = { id: 999, username: 'other', role: 'visitor' };
    assert.equal(isAuthorizedToConsume(permission, actor), false);
  });

  it('should deny a reviewer from consuming (not owner, not operator/admin)', () => {
    const actor = { id: 400, username: 'reviewer', role: 'reviewer' };
    assert.equal(isAuthorizedToConsume(permission, actor), false);
  });

  it('should deny when no actor is provided', () => {
    assert.equal(isAuthorizedToConsume(permission, null), false);
  });

  it('should deny when actor is undefined', () => {
    assert.equal(isAuthorizedToConsume(permission, undefined), false);
  });
});

// --------------------------------------------------------------------------
// Entry permission — getPermissionsForReservation cross-user denial
// --------------------------------------------------------------------------
describe('Object-Level Auth — getPermissionsForReservation', () => {
  const reservation = { id: 10, userId: 100, zone: 'A', status: 'approved' };

  it('should allow the reservation owner to view permissions', () => {
    const actor = { id: 100, username: 'owner', role: 'visitor' };
    assert.equal(isAuthorizedToViewPermissions(reservation, actor), true);
  });

  it('should allow an operator to view any reservation permissions', () => {
    const actor = { id: 200, username: 'op', role: 'operator' };
    assert.equal(isAuthorizedToViewPermissions(reservation, actor), true);
  });

  it('should allow an admin to view any reservation permissions', () => {
    const actor = { id: 300, username: 'admin', role: 'admin' };
    assert.equal(isAuthorizedToViewPermissions(reservation, actor), true);
  });

  it('should deny a different visitor from viewing permissions', () => {
    const actor = { id: 999, username: 'other', role: 'visitor' };
    assert.equal(isAuthorizedToViewPermissions(reservation, actor), false);
  });

  it('should deny a reviewer from viewing permissions (not owner, not operator/admin)', () => {
    const actor = { id: 400, username: 'reviewer', role: 'reviewer' };
    assert.equal(isAuthorizedToViewPermissions(reservation, actor), false);
  });

  it('should deny when no actor is provided', () => {
    assert.equal(isAuthorizedToViewPermissions(reservation, null), false);
  });
});

// --------------------------------------------------------------------------
// Notifications — cross-user access
// --------------------------------------------------------------------------

/**
 * Mirrors notifications view (notifications.js:52-54) authorization logic.
 * Non-admin users only see their own notifications; admins see all.
 * Returns the filtered notification list for the given actor.
 */
function filterNotificationsForActor(allNotifications, actor) {
  if (!actor) return [];
  if (actor.role === 'admin') return allNotifications;
  return allNotifications.filter(n => n.userId === actor.id);
}

/**
 * Mirrors notifications view (notifications.js:195-199, 205-209) action authorization.
 * Only owner or admin may mark-read / delete a notification.
 */
function isAuthorizedForNotificationAction(notification, actor) {
  if (!actor) return false;
  return notification.userId === actor.id || actor.role === 'admin';
}

describe('Object-Level Auth — notification scoping', () => {
  const notifications = [
    { id: 1, userId: 100, message: 'user100 notif', read: false },
    { id: 2, userId: 200, message: 'user200 notif', read: false },
    { id: 3, userId: 100, message: 'user100 notif 2', read: true },
    { id: 4, userId: 300, message: 'user300 notif', read: false }
  ];

  it('should return only own notifications for a non-admin user', () => {
    const actor = { id: 100, username: 'alice', role: 'visitor' };
    const result = filterNotificationsForActor(notifications, actor);
    assert.equal(result.length, 2);
    assert.ok(result.every(n => n.userId === 100));
  });

  it('should deny a non-admin user from seeing another user\'s notifications', () => {
    const actor = { id: 100, username: 'alice', role: 'visitor' };
    const result = filterNotificationsForActor(notifications, actor);
    assert.ok(result.every(n => n.userId !== 200 && n.userId !== 300));
  });

  it('should return all notifications for an admin', () => {
    const actor = { id: 999, username: 'superadmin', role: 'admin' };
    const result = filterNotificationsForActor(notifications, actor);
    assert.equal(result.length, notifications.length);
  });

  it('should return no notifications when actor is null', () => {
    const result = filterNotificationsForActor(notifications, null);
    assert.equal(result.length, 0);
  });

  it('should return no notifications when actor is undefined', () => {
    const result = filterNotificationsForActor(notifications, undefined);
    assert.equal(result.length, 0);
  });

  it('should deny operator from seeing other users\' notifications', () => {
    const actor = { id: 500, username: 'op', role: 'operator' };
    const result = filterNotificationsForActor(notifications, actor);
    assert.equal(result.length, 0, 'operator with no matching userId should see nothing');
  });

  it('should allow owner to mark-read their own notification', () => {
    const actor = { id: 100, username: 'alice', role: 'visitor' };
    assert.equal(isAuthorizedForNotificationAction(notifications[0], actor), true);
  });

  it('should deny a different user from marking another user\'s notification as read', () => {
    const actor = { id: 999, username: 'other', role: 'visitor' };
    assert.equal(isAuthorizedForNotificationAction(notifications[0], actor), false);
  });

  it('should allow admin to act on any user\'s notification', () => {
    const actor = { id: 999, username: 'superadmin', role: 'admin' };
    assert.equal(isAuthorizedForNotificationAction(notifications[0], actor), true);
    assert.equal(isAuthorizedForNotificationAction(notifications[1], actor), true);
  });

  it('should deny action when actor is null', () => {
    assert.equal(isAuthorizedForNotificationAction(notifications[0], null), false);
  });

  it('should deny a reviewer from acting on another user\'s notification', () => {
    const actor = { id: 400, username: 'reviewer', role: 'reviewer' };
    assert.equal(isAuthorizedForNotificationAction(notifications[0], actor), false);
  });
});

// --------------------------------------------------------------------------
// Auth service — registerWithRole function-level auth
// --------------------------------------------------------------------------
describe('Object-Level Auth — registerWithRole', () => {
  it('should allow admin to create users with any role', () => {
    const actor = { id: 1, username: 'admin', role: 'admin' };
    assert.equal(isAuthorizedToRegisterWithRole(actor), true);
  });

  it('should deny visitor from creating users with roles', () => {
    const actor = { id: 2, username: 'visitor', role: 'visitor' };
    assert.equal(isAuthorizedToRegisterWithRole(actor), false);
  });

  it('should deny operator from creating users with roles', () => {
    const actor = { id: 3, username: 'operator', role: 'operator' };
    assert.equal(isAuthorizedToRegisterWithRole(actor), false);
  });

  it('should deny reviewer from creating users with roles', () => {
    const actor = { id: 4, username: 'reviewer', role: 'reviewer' };
    assert.equal(isAuthorizedToRegisterWithRole(actor), false);
  });

  it('should deny when no actor is provided', () => {
    assert.equal(isAuthorizedToRegisterWithRole(null), false);
  });

  it('should deny when actor is undefined', () => {
    assert.equal(isAuthorizedToRegisterWithRole(undefined), false);
  });
});
