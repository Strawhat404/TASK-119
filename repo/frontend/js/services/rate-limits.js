/**
 * Rate-Limits service.
 * Manages admin-configurable rate-limit rules persisted in IndexedDB.
 *
 * A rule defines:
 *   - scope     : 'user' | 'zone' | 'device' | 'global'
 *   - action    : e.g. 'unlock_command', 'reservation_created', 'user_login', 'content_workflow'
 *   - maxCount  : maximum number of occurrences allowed
 *   - windowSec : rolling time window in seconds
 *   - enabled   : boolean
 *
 * Enforcement is client-side using in-memory counters derived from the
 * audit_logs store. No server required.
 */
import DB from '../database.js';
import { addAuditLog } from './audit.js';
import { getCurrentUser } from './auth-service.js';

function requireAdminRole() {
  const user = getCurrentUser();
  if (!user || user.role !== 'admin') {
    throw new Error('Unauthorized: rate-limit management requires admin role');
  }
  return user;
}

// --- CRUD ---

export async function getRateLimits() {
  return DB.getAll('rate_limits');
}

export async function getRateLimitByScope(scope, action) {
  const all = await getRateLimits();
  return all.find(r => r.scope === scope && r.action === action) || null;
}

export async function createRateLimit(rule, actorUsername) {
  requireAdminRole();
  if (!rule.scope || !rule.action || !rule.maxCount || !rule.windowSec) {
    return { success: false, error: 'scope, action, maxCount and windowSec are required' };
  }

  const existing = await getRateLimitByScope(rule.scope, rule.action);
  if (existing) {
    return { success: false, error: `A rule for scope="${rule.scope}" action="${rule.action}" already exists` };
  }

  const record = {
    scope: rule.scope,
    action: rule.action,
    maxCount: Number(rule.maxCount),
    windowSec: Number(rule.windowSec),
    enabled: rule.enabled !== false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const id = await DB.add('rate_limits', record);
  await addAuditLog('rate_limit_created', actorUsername, { scope: rule.scope, action: rule.action, maxCount: record.maxCount, windowSec: record.windowSec });
  return { success: true, id };
}

export async function updateRateLimit(id, changes, actorUsername) {
  requireAdminRole();
  const rule = await DB.get('rate_limits', id);
  if (!rule) return { success: false, error: 'Rule not found' };

  const before = { ...rule };
  if (changes.maxCount !== undefined) rule.maxCount = Number(changes.maxCount);
  if (changes.windowSec !== undefined) rule.windowSec = Number(changes.windowSec);
  if (changes.enabled !== undefined) rule.enabled = Boolean(changes.enabled);
  rule.updatedAt = Date.now();

  await DB.put('rate_limits', rule);
  await addAuditLog('rate_limit_updated', actorUsername, { id }, before, rule);
  return { success: true };
}

export async function deleteRateLimit(id, actorUsername) {
  requireAdminRole();
  const rule = await DB.get('rate_limits', id);
  if (!rule) return { success: false, error: 'Rule not found' };

  await DB.remove('rate_limits', id);
  await addAuditLog('rate_limit_deleted', actorUsername, { scope: rule.scope, action: rule.action });
  return { success: true };
}

// --- Enforcement ---

/**
 * Check whether an action is within the configured rate limit.
 * Uses recent audit_log entries as a lightweight usage counter.
 *
 * @param {string} scopeType   - 'user' | 'zone' | 'device' | 'global'
 * @param {string} scopeValue  - e.g. userId, zoneName, deviceId, or '' for global
 * @param {string} action      - audit log action string to count
 * @returns {{ allowed: boolean, remaining: number, rule: object|null }}
 */
export async function checkRateLimit(scopeType, scopeValue, action) {
  const rule = await getRateLimitByScope(scopeType, action);
  if (!rule || !rule.enabled) return { allowed: true, remaining: Infinity, rule: null };

  const cutoff = Date.now() - rule.windowSec * 1000;
  const logs = await DB.getAll('audit_logs');

  const count = logs.filter(l => {
    if (l.action !== action) return false;
    if (l.timestamp < cutoff) return false;
    if (scopeType === 'global') return true;
    if (scopeType === 'user') return l.actor === scopeValue || l.details?.userId === scopeValue;
    if (scopeType === 'zone') return l.details?.zone === scopeValue;
    if (scopeType === 'device') return l.details?.deviceId === scopeValue;
    return false;
  }).length;

  const remaining = Math.max(0, rule.maxCount - count);
  return { allowed: count < rule.maxCount, remaining, rule };
}
