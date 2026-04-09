/**
 * Authentication & Session service.
 * - Password policy: min 12 chars, 1 upper, 1 lower, 1 number, 1 symbol
 * - 5 failed attempts → 15 min lockout
 * - 30-min idle timeout, "Extend Session" prompt at 25 min
 * - Session token in localStorage
 * - Default admin account seeded on first run
 */
import DB from '../database.js';
import Crypto from '../crypto.js';
import Store from '../store.js';
import { addAuditLog } from './audit.js';
import { checkRateLimit } from './rate-limits.js';
import {
  validatePassword as _validatePassword,
  isAccountLocked as _isAccountLocked,
  processFailedLogin,
  processSuccessfulLogin,
  isSessionExpired,
  MAX_ATTEMPTS,
  LOCKOUT_DURATION,
  SESSION_TIMEOUT,
  SESSION_WARNING,
  ROLE_DEFINITIONS,
  hasPermissionForRole
} from '../lib/auth-logic.js';
import { setEncryptionKey, clearEncryptionKey, getEncryptionKey } from '../database.js';

const SESSION_KEY = 'hg_session';
const WRAPPED_KEYS_KEY = 'hg_wrapped_keys';

function getWrappedKeys() {
  try { return JSON.parse(localStorage.getItem(WRAPPED_KEYS_KEY) || '{}'); } catch { return {}; }
}

function setWrappedKeys(keys) {
  localStorage.setItem(WRAPPED_KEYS_KEY, JSON.stringify(keys));
}

let idleTimer = null;
let warningTimer = null;
let _verifiedUser = null; // DB-verified user; set by requireRole, cleared on logout

function validatePassword(password) {
  return _validatePassword(password);
}

function isAccountLocked(user) {
  return _isAccountLocked(user);
}

async function register(username, password, role = 'visitor') {
  const safeRole = 'visitor';
  const validation = validatePassword(password);
  if (!validation.valid) return { success: false, errors: validation.errors };

  const existing = await DB.getOneByIndex('users', 'username', username);
  if (existing) return { success: false, errors: ['Username already exists'] };

  const { hash, salt } = await Crypto.hashPassword(password);
  const user = {
    username,
    passwordHash: hash,
    passwordSalt: salt,
    role: safeRole,
    failedAttempts: 0,
    lockedUntil: null,
    banned: false,
    createdAt: Date.now()
  };

  const id = await DB.add('users', user);
  await addAuditLog('user_register', 'system', { userId: id, username, role: safeRole });
  return { success: true, userId: id };
}

// Internal helper — creates a user with the given role. No auth check; callers must gate access.
async function _createUserWithRole(username, password, role, auditActor) {
  const validation = validatePassword(password);
  if (!validation.valid) return { success: false, errors: validation.errors };

  const existing = await DB.getOneByIndex('users', 'username', username);
  if (existing) return { success: false, errors: ['Username already exists'] };

  const { hash, salt } = await Crypto.hashPassword(password);
  const user = {
    username,
    passwordHash: hash,
    passwordSalt: salt,
    role,
    failedAttempts: 0,
    lockedUntil: null,
    banned: false,
    createdAt: Date.now()
  };

  const id = await DB.add('users', user);

  // Wrap the shared DEK for this new user using their password-derived KEK
  const kek = await Crypto.deriveKEK(password);
  const wrappedKeys = getWrappedKeys();
  const currentDEK = getEncryptionKey();
  if (currentDEK) {
    // Admin is logged in — wrap existing DEK for the new user
    const wrappedData = await Crypto.wrapDEK(currentDEK, kek);
    wrappedKeys[username] = wrappedData;
  } else {
    // First-run bootstrap (no DEK yet) — generate a new DEK and wrap it
    const dek = await Crypto.generateDEK();
    const wrappedData = await Crypto.wrapDEK(dek, kek);
    wrappedKeys[username] = wrappedData;
  }
  setWrappedKeys(wrappedKeys);

  await addAuditLog('user_register', auditActor, { userId: id, username, role });
  return { success: true, userId: id };
}

async function registerWithRole(username, password, role, actor) {
  // Function-level authorization: actor is required and must be admin — fail closed
  if (!actor || actor.role !== 'admin') {
    return { success: false, errors: ['Only administrators can create users with specific roles'] };
  }
  return _createUserWithRole(username, password, role, actor.username);
}

async function login(username, password) {
  const [userRl, globalRl] = await Promise.all([
    checkRateLimit('user', username, 'user_login'),
    checkRateLimit('global', '', 'user_login')
  ]);
  if (!userRl.allowed || !globalRl.allowed) {
    await addAuditLog('login_rate_limited', username, { remaining: Math.min(userRl.remaining, globalRl.remaining) });
    return { success: false, error: 'Too many login attempts. Please try again later.' };
  }

  const user = await DB.getOneByIndex('users', 'username', username);
  if (!user) return { success: false, error: 'Invalid credentials' };
  if (user.banned) return { success: false, error: 'Account is banned' };
  if (isAccountLocked(user)) {
    const remaining = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    return { success: false, error: `Account locked. Try again in ${remaining} minute(s).` };
  }

  // Derive KEK and try to unwrap DEK before password verification so that
  // encrypted credential fields (passwordHash, passwordSalt) can be decrypted.
  const kek = await Crypto.deriveKEK(password);
  const wrappedKeys = getWrappedKeys();
  const userWrapped = wrappedKeys[username];
  let fullUser = user;

  if (userWrapped) {
    try {
      const dek = await Crypto.unwrapDEK(userWrapped, kek);
      setEncryptionKey(dek);
      // Re-fetch user with decryption now enabled to access passwordHash/Salt
      fullUser = await DB.getOneByIndex('users', 'username', username);
    } catch {
      // DEK unwrap failed — password is wrong
      const result = processFailedLogin(user);
      await DB.put('users', user);
      if (result.locked) {
        await addAuditLog('account_locked', username, { reason: 'max_failed_attempts' });
        return { success: false, error: 'Account locked for 15 minutes due to too many failed attempts.' };
      }
      return { success: false, error: 'Invalid credentials', attemptsLeft: result.attemptsLeft };
    }
  }

  const valid = await Crypto.verifyPassword(password, fullUser.passwordHash, fullUser.passwordSalt);
  if (!valid) {
    const result = processFailedLogin(user);
    clearEncryptionKey();
    await DB.put('users', user);
    if (result.locked) {
      await addAuditLog('account_locked', username, { reason: 'max_failed_attempts' });
      return { success: false, error: 'Account locked for 15 minutes due to too many failed attempts.' };
    }
    return { success: false, error: 'Invalid credentials', attemptsLeft: result.attemptsLeft };
  }

  processSuccessfulLogin(user);
  await DB.put('users', user);

  const token = Crypto.generateId();
  const session = {
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  Store.set('session', session);
  Store.set('currentUser', { id: user.id, username: user.username, role: user.role });

  startIdleTimer();
  await addAuditLog('user_login', username, { userId: user.id });
  return { success: true, session };
}

function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (isSessionExpired(session)) {
      logout();
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function refreshSession() {
  const session = getSession();
  if (session) {
    session.lastActivity = Date.now();
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    Store.set('session', session);
    startIdleTimer();
    return true;
  }
  return false;
}

function startIdleTimer() {
  clearTimeout(idleTimer);
  clearTimeout(warningTimer);
  warningTimer = setTimeout(() => {
    Store.set('sessionWarning', true);
  }, SESSION_WARNING);
  idleTimer = setTimeout(() => {
    Store.set('sessionWarning', false);
    Store.set('sessionExpired', true);
    logout();
  }, SESSION_TIMEOUT);
}

function logout() {
  clearTimeout(idleTimer);
  clearTimeout(warningTimer);
  _verifiedUser = null;
  let session = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) session = JSON.parse(raw);
  } catch (e) {}
  localStorage.removeItem(SESSION_KEY);
  Store.set('session', null);
  Store.set('currentUser', null);
  clearEncryptionKey();
  if (session) {
    addAuditLog('user_logout', session.username, { userId: session.userId });
  }
}

function getCurrentUser() {
  if (_verifiedUser) return { ..._verifiedUser };
  // No verified user available — return null (fail closed).
  // Views must call requireAuth/requireRole before getCurrentUser.
  return null;
}

function hasRole(requiredRoles) {
  const user = getCurrentUser();
  if (!user) return false;
  if (typeof requiredRoles === 'string') requiredRoles = [requiredRoles];
  return requiredRoles.includes(user.role);
}

async function verifySessionUser(session) {
  // Authoritative lookup by immutable userId, not mutable username
  const user = await DB.get('users', session.userId);
  if (!user) return null;
  // Cross-check: session username must match DB record — fail closed on mismatch
  if (user.username !== session.username) return null;
  if (user.banned) return null;
  return user;
}

async function requireAuth() {
  const session = getSession();
  if (!session) {
    window.location.hash = '/login';
    return false;
  }
  try {
    const user = await verifySessionUser(session);
    if (!user) { logout(); window.location.hash = '/login'; return false; }
    _verifiedUser = { id: user.id, username: user.username, role: user.role };
  } catch {
    // DB unavailable — fail closed: do not authorize from unverified session
    logout();
    window.location.hash = '/login';
    return false;
  }
  refreshSession();
  return true;
}

async function requireRole(roles) {
  const session = getSession();
  if (!session) {
    window.location.hash = '/login';
    return false;
  }
  if (typeof roles === 'string') roles = [roles];
  try {
    const user = await verifySessionUser(session);
    if (!user) {
      logout();
      window.location.hash = '/login';
      return false;
    }
    _verifiedUser = { id: user.id, username: user.username, role: user.role };
    if (!roles.includes(user.role)) {
      window.location.hash = '/';
      return false;
    }
  } catch {
    // DB unavailable — fail closed: do not authorize from unverified session
    logout();
    window.location.hash = '/login';
    return false;
  }
  refreshSession();
  return true;
}

async function initRoles() {
  const existing = await DB.getAll('roles');
  if (existing.length > 0) return;
  for (const role of ROLE_DEFINITIONS) {
    await DB.add('roles', role);
  }
}

async function needsSetup() {
  const users = await DB.getAll('users');
  return users.length === 0;
}

async function setupAdmin(username, password) {
  const users = await DB.getAll('users');
  if (users.length > 0) return { success: false, errors: ['Setup already completed'] };
  // Bootstrap path: no actor exists yet, use internal helper directly
  return _createUserWithRole(username, password, 'admin', 'system');
}

function hasPermission(permission) {
  const user = getCurrentUser();
  if (!user) return false;
  return hasPermissionForRole(user.role, permission);
}

async function loadRoles() {
  const roles = await DB.getAll('roles');
  Store.set('roles', roles);
  return roles;
}

export {
  validatePassword,
  isAccountLocked,
  register,
  registerWithRole,
  login,
  getSession,
  refreshSession,
  startIdleTimer,
  logout,
  getCurrentUser,
  hasRole,
  requireAuth,
  requireRole,
  initRoles,
  needsSetup,
  setupAdmin,
  hasPermission,
  loadRoles
};
