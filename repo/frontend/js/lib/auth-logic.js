/**
 * Pure authentication logic — no browser/DB dependencies.
 */

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_DURATION = 15 * 60 * 1000;      // 15 minutes
export const SESSION_TIMEOUT = 30 * 60 * 1000;       // 30 minutes
export const SESSION_WARNING = 25 * 60 * 1000;       // 25 minutes

export const PASSWORD_RULES = [
  { test: (p) => p.length >= 12, msg: 'Minimum 12 characters' },
  { test: (p) => /[A-Z]/.test(p), msg: 'At least 1 uppercase letter' },
  { test: (p) => /[a-z]/.test(p), msg: 'At least 1 lowercase letter' },
  { test: (p) => /[0-9]/.test(p), msg: 'At least 1 number' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), msg: 'At least 1 symbol' }
];

export function validatePassword(password) {
  const failures = PASSWORD_RULES.filter(r => !r.test(password));
  return { valid: failures.length === 0, errors: failures.map(f => f.msg) };
}

export function isAccountLocked(user, now = Date.now()) {
  if (!user.lockedUntil) return false;
  return now < user.lockedUntil;
}

export function processFailedLogin(user, now = Date.now()) {
  user.failedAttempts = (user.failedAttempts || 0) + 1;
  if (user.failedAttempts >= MAX_ATTEMPTS) {
    user.lockedUntil = now + LOCKOUT_DURATION;
    user.failedAttempts = 0;
    return { locked: true };
  }
  return { locked: false, attemptsLeft: MAX_ATTEMPTS - user.failedAttempts };
}

export function processSuccessfulLogin(user) {
  user.failedAttempts = 0;
  user.lockedUntil = null;
  user.lastLogin = Date.now();
}

export function isSessionExpired(session, now = Date.now()) {
  return now - session.lastActivity > SESSION_TIMEOUT;
}

export function isSessionWarningDue(session, now = Date.now()) {
  return now - session.lastActivity > SESSION_WARNING;
}

export const ROLE_DEFINITIONS = [
  { name: 'visitor', label: 'Regular User', permissions: ['reservations.view', 'reservations.create', 'map.view', 'notifications.view'] },
  { name: 'operator', label: 'Merchant/Operator', permissions: ['reservations.view', 'reservations.create', 'reservations.manage', 'map.view', 'notifications.view', 'devices.unlock', 'devices.view'] },
  { name: 'reviewer', label: 'Reviewer', permissions: ['content.view', 'content.review', 'content.moderate', 'notifications.view', 'map.view'] },
  { name: 'admin', label: 'Administrator', permissions: ['*'] }
];

export function hasPermissionForRole(roleName, permission) {
  if (roleName === 'admin') return true;
  const role = ROLE_DEFINITIONS.find(r => r.name === roleName);
  if (!role) return false;
  return role.permissions.includes(permission) || role.permissions.includes('*');
}
