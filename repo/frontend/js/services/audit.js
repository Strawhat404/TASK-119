/**
 * Immutable Audit Log service.
 * Timestamp format: MM/DD/YYYY 12-hour
 * Fields: timestamp, actor, actorRole, action, before, after, details
 */
import DB from '../database.js';
import { formatAuditTimestamp, createAuditEntry } from '../lib/audit-logic.js';

// Re-export pure functions
export { formatAuditTimestamp, createAuditEntry } from '../lib/audit-logic.js';

export async function addAuditLog(action, actor, details = {}, before = null, after = null) {
  const session = JSON.parse(localStorage.getItem('hg_session') || 'null');
  const actorRole = session?.role || details.role || 'system';
  const entry = createAuditEntry(action, actor || session?.username || 'system', details, before, after, actorRole);

  // Audit entries are immutable — add only, never update
  await DB.add('audit_logs', entry);
  return entry;
}

export async function getAuditLogs(filters = {}) {
  let logs = await DB.getAll('audit_logs');

  if (filters.actor) {
    logs = logs.filter(l => l.actor === filters.actor);
  }
  if (filters.action) {
    logs = logs.filter(l => l.action === filters.action);
  }
  if (filters.from) {
    logs = logs.filter(l => l.timestamp >= filters.from);
  }
  if (filters.to) {
    logs = logs.filter(l => l.timestamp <= filters.to);
  }

  // Sort newest first
  logs.sort((a, b) => b.timestamp - a.timestamp);
  return logs;
}
