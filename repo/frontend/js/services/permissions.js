/**
 * Entry Permissions service.
 * - Permission window: 15 min before → 30 min after reservation
 * - Entry policy: single-use (consumed on first unlock) OR multi-use (up to 5 entries)
 */
import DB from '../database.js';
import { addAuditLog } from './audit.js';
import {
  calculatePermissionWindow,
  isWithinPermissionWindow,
  createPermissionObject,
  consumeEntry as _consumeEntry,
  getPermissionStatusLabel
} from '../lib/permissions-logic.js';

// Re-export pure functions
export { calculatePermissionWindow, isWithinPermissionWindow, getPermissionStatusLabel } from '../lib/permissions-logic.js';

export async function createEntryPermission(reservation, policy = 'single-use') {
  const startTime = new Date(`${reservation.date}T${reservation.time}`).getTime();
  const permObj = createPermissionObject(startTime, policy);

  const permission = {
    ...permObj,
    reservationId: reservation.id,
    userId: reservation.userId,
    zone: reservation.zone,
    createdAt: Date.now()
  };

  const id = await DB.add('entry_permissions', permission);
  await addAuditLog('permission_created', null, {
    permissionId: id,
    reservationId: reservation.id,
    policy,
    windowStart: new Date(permission.windowStart).toISOString(),
    windowEnd: new Date(permission.windowEnd).toISOString()
  });
  return { ...permission, id };
}

export async function consumeEntry(permissionId, actor = null) {
  const perm = await DB.get('entry_permissions', permissionId);
  if (!perm) return { success: false, error: 'Permission not found' };

  // Object-level authorization: only the permission owner, admin, or operator may consume
  if (actor) {
    const isOwner = perm.userId === actor.id;
    const isPrivileged = actor.role === 'admin' || actor.role === 'operator';
    if (!isOwner && !isPrivileged) {
      return { success: false, error: 'Not authorized to consume this entry permission' };
    }
  }

  const before = { ...perm };
  const result = _consumeEntry(perm);
  if (!result.success) return result;

  await DB.put('entry_permissions', perm);
  await addAuditLog('entry_consumed', actor?.username || null, {
    permissionId: perm.id,
    usedEntries: perm.usedEntries,
    maxEntries: perm.maxEntries
  }, before, perm);

  return { success: true, permission: perm };
}

export async function expirePermissions() {
  const all = await DB.getAll('entry_permissions');
  const now = Date.now();
  let expired = 0;

  for (const perm of all) {
    if (perm.status === 'active' && now > perm.windowEnd) {
      perm.status = 'expired';
      await DB.put('entry_permissions', perm);
      expired++;
    }
  }

  return expired;
}

/**
 * Get all entry permissions for a reservation.
 * If actor is provided, verifies the actor owns the reservation or is privileged.
 * Returns [] (not an error) for unauthorized access to avoid leaking existence.
 */
export async function getPermissionsForReservation(reservationId, actor = null) {
  if (actor) {
    const reservation = await DB.get('reservations', reservationId);
    if (reservation) {
      const isOwner = reservation.userId === actor.id;
      const isPrivileged = actor.role === 'admin' || actor.role === 'operator';
      if (!isOwner && !isPrivileged) return [];
    }
  }
  return DB.getByIndex('entry_permissions', 'reservationId', reservationId);
}
