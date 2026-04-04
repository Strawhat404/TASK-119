/**
 * Pure audit-log logic — no browser/DB dependencies.
 */

export function formatAuditTimestamp(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  const sec = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} ${h}:${min}:${sec} ${ampm}`;
}

export function createAuditEntry(action, actor, details = {}, before = null, after = null, actorRole = 'system') {
  return {
    timestamp: Date.now(),
    formattedTimestamp: formatAuditTimestamp(Date.now()),
    actor: actor || 'system',
    actorRole,
    action,
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: after ? JSON.parse(JSON.stringify(after)) : null,
    details: JSON.parse(JSON.stringify(details))
  };
}
