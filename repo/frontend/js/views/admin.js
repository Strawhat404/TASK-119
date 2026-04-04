import DB from '../database.js';
import Store from '../store.js';
import { requireRole, getCurrentUser } from '../services/auth-service.js';
import { getAuditLogs, formatAuditTimestamp, addAuditLog } from '../services/audit.js';
import { renderPaginatedTable } from '../components/table.js';
import { showModal, closeModal } from '../components/modal.js';
import { showNotification } from '../components/notifications.js';
import { createNotification } from '../services/notifications.js';
import { getRateLimits, createRateLimit, updateRateLimit, deleteRateLimit } from '../services/rate-limits.js';

export async function renderAdmin(container) {
  if (!requireRole(['admin'])) return;
  const user = getCurrentUser();

  const [users, auditLogs, reports, rateLimits] = await Promise.all([
    DB.getAll('users'),
    getAuditLogs(),
    DB.getAll('reports'),
    getRateLimits()
  ]);

  container.innerHTML = `
    <div class="view-header">
      <h1>Admin Console</h1>
    </div>

    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="users">Users</button>
      <button class="admin-tab" data-tab="audit">Audit Log</button>
      <button class="admin-tab" data-tab="reports">Reports</button>
      <button class="admin-tab" data-tab="rate-limits">Rate Limits</button>
    </div>

    <div id="admin-tab-content">
      <!-- Users Tab -->
      <div id="tab-users" class="admin-panel">
        <h2>User Management</h2>
        <div id="users-table"></div>
      </div>

      <!-- Audit Tab -->
      <div id="tab-audit" class="admin-panel" style="display:none">
        <h2>Audit Log (Immutable)</h2>
        <div class="filters">
          <input type="text" id="audit-actor-filter" placeholder="Filter by actor..." class="input" />
          <select id="audit-action-filter" class="input">
            <option value="">All Actions</option>
            ${[...new Set(auditLogs.map(l => l.action))].map(a => `<option value="${a}">${a}</option>`).join('')}
          </select>
        </div>
        <div id="audit-table"></div>
      </div>

      <!-- Reports Tab -->
      <div id="tab-reports" class="admin-panel" style="display:none">
        <h2>Reports</h2>
        <button class="btn btn-primary" id="create-report-btn">+ Create Report</button>
        <div id="reports-table"></div>
      </div>

      <!-- Rate Limits Tab -->
      <div id="tab-rate-limits" class="admin-panel" style="display:none">
        <h2>Rate Limit Rules</h2>
        <p class="hint">Define locally-enforced rate limits for key actions. Rules are checked client-side using the audit log as a usage counter.</p>
        <button class="btn btn-primary" id="create-rate-limit-btn">+ Add Rule</button>
        <div id="rate-limits-table"></div>
      </div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      container.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
      document.getElementById('tab-' + tab.dataset.tab).style.display = '';
    });
  });

  // === Users Table ===
  const userColumns = [
    { key: 'username', label: 'Username', sortable: true },
    { key: 'role', label: 'Role', sortable: true, render: (val) => `<span class="badge badge-info">${val}</span>` },
    { key: 'banned', label: 'Status', render: (val) => val ? '<span class="badge badge-denied">Banned</span>' : '<span class="badge badge-approved">Active</span>' },
    { key: 'failedAttempts', label: 'Failed Attempts' },
    { key: 'lastLogin', label: 'Last Login', sortable: true, render: (val) => val ? new Date(val).toLocaleString() : 'Never' },
    { key: 'actions', label: 'Actions', render: (_, row) => {
      let btns = '';
      if (!row.banned) {
        btns += `<button class="btn btn-sm btn-danger" data-action="ban" data-id="${row.id}">Ban</button>`;
      } else {
        btns += `<button class="btn btn-sm btn-primary" data-action="unban" data-id="${row.id}">Unban</button>`;
      }
      btns += ` <button class="btn btn-sm" data-action="change-role" data-id="${row.id}">Change Role</button>`;
      btns += ` <button class="btn btn-sm" data-action="reset-lockout" data-id="${row.id}">Reset Lockout</button>`;
      return btns;
    }}
  ];

  // Don't display password hashes/salts
  const safeUsers = users.map(u => ({
    ...u,
    passwordHash: undefined,
    passwordSalt: undefined
  }));

  Store.initTable('admin-users', safeUsers, { pageSize: 10, sortKey: 'username' });
  renderPaginatedTable(document.getElementById('users-table'), 'admin-users', userColumns, bindUserActions);

  function bindUserActions() {
    document.querySelectorAll('[data-action="ban"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = await DB.get('users', Number(btn.dataset.id));
        if (!u) return;
        const before = { banned: false };
        u.banned = true;
        await DB.put('users', u);
        await addAuditLog('user_banned', user.username, { targetUser: u.username }, before, { banned: true });
        await createNotification({ userId: u.id, templateId: 'user_banned', variables: { username: u.username, reason: 'Admin decision' }, type: 'error' });
        showNotification(`${u.username} banned`, 'warning');
        renderAdmin(container);
      });
    });

    document.querySelectorAll('[data-action="unban"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = await DB.get('users', Number(btn.dataset.id));
        if (!u) return;
        u.banned = false;
        await DB.put('users', u);
        await addAuditLog('user_unbanned', user.username, { targetUser: u.username });
        showNotification(`${u.username} unbanned`, 'success');
        renderAdmin(container);
      });
    });

    document.querySelectorAll('[data-action="change-role"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = await DB.get('users', Number(btn.dataset.id));
        if (!u) return;
        showModal('Change Role: ' + u.username, `
          <form id="role-form">
            <label class="form-label">Role
              <select name="role" class="input">
                <option value="visitor" ${u.role === 'visitor' ? 'selected' : ''}>Regular User</option>
                <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>Merchant/Operator</option>
                <option value="reviewer" ${u.role === 'reviewer' ? 'selected' : ''}>Reviewer</option>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrator</option>
              </select>
            </label>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Update</button>
              <button type="button" class="btn btn-secondary" id="cancel-role">Cancel</button>
            </div>
          </form>
        `);

        document.getElementById('cancel-role').addEventListener('click', closeModal);
        document.getElementById('role-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const before = { role: u.role };
          u.role = new FormData(e.target).get('role');
          await DB.put('users', u);
          await addAuditLog('role_changed', user.username, { targetUser: u.username }, before, { role: u.role });
          showNotification('Role updated', 'success');
          closeModal();
          renderAdmin(container);
        });
      });
    });

    document.querySelectorAll('[data-action="reset-lockout"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const u = await DB.get('users', Number(btn.dataset.id));
        if (!u) return;
        u.failedAttempts = 0;
        u.lockedUntil = null;
        await DB.put('users', u);
        await addAuditLog('lockout_reset', user.username, { targetUser: u.username });
        showNotification('Lockout reset', 'success');
        renderAdmin(container);
      });
    });
  }

  // === Audit Log Table ===
  const auditColumns = [
    { key: 'formattedTimestamp', label: 'Timestamp', sortable: true },
    { key: 'actor', label: 'Actor', sortable: true },
    { key: 'actorRole', label: 'Role' },
    { key: 'action', label: 'Action', sortable: true },
    { key: 'details', label: 'Details', render: (val) => val ? `<code>${JSON.stringify(val).slice(0, 80)}</code>` : '' },
    { key: 'actions', label: '', render: (_, row) => `<button class="btn btn-sm" data-action="view-audit" data-id="${row.id}">View</button>` }
  ];

  Store.initTable('admin-audit', auditLogs, { pageSize: 15, sortKey: 'timestamp', sortDir: 'desc' });
  renderPaginatedTable(document.getElementById('audit-table'), 'admin-audit', auditColumns, bindAuditActions);

  document.getElementById('audit-actor-filter')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    Store.setTableFilter('admin-audit', q ? (l => l.actor.toLowerCase().includes(q)) : null);
    renderPaginatedTable(document.getElementById('audit-table'), 'admin-audit', auditColumns, bindAuditActions);
  });

  document.getElementById('audit-action-filter')?.addEventListener('change', (e) => {
    const a = e.target.value;
    Store.setTableFilter('admin-audit', a ? (l => l.action === a) : null);
    renderPaginatedTable(document.getElementById('audit-table'), 'admin-audit', auditColumns, bindAuditActions);
  });

  function bindAuditActions() {
    document.querySelectorAll('[data-action="view-audit"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const log = await DB.get('audit_logs', Number(btn.dataset.id));
        if (!log) return;
        showModal('Audit Entry', `
          <dl class="audit-detail">
            <dt>Timestamp</dt><dd>${log.formattedTimestamp}</dd>
            <dt>Actor</dt><dd>${log.actor}</dd>
            <dt>Role</dt><dd>${log.actorRole}</dd>
            <dt>Action</dt><dd>${log.action}</dd>
            <dt>Details</dt><dd><pre>${JSON.stringify(log.details, null, 2)}</pre></dd>
            ${log.before ? `<dt>Before</dt><dd><pre>${JSON.stringify(log.before, null, 2)}</pre></dd>` : ''}
            ${log.after ? `<dt>After</dt><dd><pre>${JSON.stringify(log.after, null, 2)}</pre></dd>` : ''}
          </dl>
          <div class="form-actions"><button class="btn btn-secondary" id="close-audit-modal">Close</button></div>
        `);
        document.getElementById('close-audit-modal').addEventListener('click', closeModal);
      });
    });
  }

  // === Reports ===
  const reportColumns = [
    { key: 'title', label: 'Title', sortable: true },
    { key: 'type', label: 'Type', sortable: true },
    { key: 'status', label: 'Status', render: (val) => `<span class="badge badge-${val === 'resolved' ? 'approved' : 'pending'}">${val}</span>` },
    { key: 'createdAt', label: 'Created', sortable: true, render: (val) => new Date(val).toLocaleString() },
    { key: 'actions', label: '', render: (_, row) => `
      <button class="btn btn-sm" data-action="view-report" data-id="${row.id}">View</button>
      ${row.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-action="resolve-report" data-id="${row.id}">Resolve</button>` : ''}
    `}
  ];

  Store.initTable('admin-reports', reports, { pageSize: 10, sortKey: 'createdAt', sortDir: 'desc' });
  renderPaginatedTable(document.getElementById('reports-table'), 'admin-reports', reportColumns, bindReportActions);

  document.getElementById('create-report-btn')?.addEventListener('click', () => {
    showModal('Create Report', `
      <form id="report-form">
        <label class="form-label">Title
          <input type="text" name="title" class="input" required />
        </label>
        <label class="form-label">Type
          <select name="type" class="input">
            <option value="incident">Incident</option>
            <option value="compliance">Compliance</option>
            <option value="access">Access Violation</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label class="form-label">Description
          <textarea name="description" class="input" rows="4" required></textarea>
        </label>
        <label class="form-label">Evidence / Notes
          <textarea name="evidence" class="input" rows="3"></textarea>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create</button>
          <button type="button" class="btn btn-secondary" id="cancel-report">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('cancel-report').addEventListener('click', closeModal);
    document.getElementById('report-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);
      data.status = 'pending';
      data.createdBy = user.username;
      data.createdAt = Date.now();
      data.evidenceChain = [{ note: data.evidence, by: user.username, at: Date.now() }];
      await DB.add('reports', data);
      await addAuditLog('report_created', user.username, { title: data.title, type: data.type });
      showNotification('Report created', 'success');
      closeModal();
      renderAdmin(container);
    });
  });

  function bindReportActions() {
    document.querySelectorAll('[data-action="view-report"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await DB.get('reports', Number(btn.dataset.id));
        if (!r) return;
        showModal('Report: ' + r.title, `
          <p><strong>Type:</strong> ${r.type} | <strong>Status:</strong> ${r.status}</p>
          <p><strong>Description:</strong></p><p>${r.description}</p>
          <h4>Evidence Chain</h4>
          <ul>${(r.evidenceChain || []).map(e => `<li>${new Date(e.at).toLocaleString()} — ${e.by}: ${e.note}</li>`).join('')}</ul>
          ${r.decision ? `<p><strong>Decision:</strong> ${r.decision}</p>` : ''}
          <div class="form-actions"><button class="btn btn-secondary" id="close-report-modal">Close</button></div>
        `);
        document.getElementById('close-report-modal').addEventListener('click', closeModal);
      });
    });

    document.querySelectorAll('[data-action="resolve-report"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const r = await DB.get('reports', Number(btn.dataset.id));
        if (!r) return;
        showModal('Resolve Report', `
          <form id="resolve-form">
            <label class="form-label">Decision
              <textarea name="decision" class="input" rows="3" required></textarea>
            </label>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">Resolve</button>
              <button type="button" class="btn btn-secondary" id="cancel-resolve">Cancel</button>
            </div>
          </form>
        `);
        document.getElementById('cancel-resolve').addEventListener('click', closeModal);
        document.getElementById('resolve-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const decision = new FormData(e.target).get('decision');
          const before = { status: r.status };
          r.status = 'resolved';
          r.decision = decision;
          r.resolvedBy = user.username;
          r.resolvedAt = Date.now();
          r.evidenceChain.push({ note: `Resolved: ${decision}`, by: user.username, at: Date.now() });
          await DB.put('reports', r);
          await addAuditLog('report_resolved', user.username, { reportId: r.id }, before, { status: 'resolved', decision });
          showNotification('Report resolved', 'success');
          closeModal();
          renderAdmin(container);
        });
      });
    });
  }

  // === Rate Limits ===
  const rateLimitColumns = [
    { key: 'scope',     label: 'Scope',    sortable: true },
    { key: 'action',   label: 'Action',   sortable: true },
    { key: 'maxCount', label: 'Max Count' },
    { key: 'windowSec', label: 'Window (s)' },
    { key: 'enabled',  label: 'Status',   render: (val) => val
      ? '<span class="badge badge-approved">Enabled</span>'
      : '<span class="badge badge-denied">Disabled</span>' },
    { key: 'actions',  label: 'Actions',  render: (_, row) => `
      <button class="btn btn-sm" data-action="toggle-rl" data-id="${row.id}" data-enabled="${row.enabled}">
        ${row.enabled ? 'Disable' : 'Enable'}
      </button>
      <button class="btn btn-sm btn-danger" data-action="delete-rl" data-id="${row.id}">Delete</button>
    `}
  ];

  Store.initTable('admin-rate-limits', rateLimits, { pageSize: 10, sortKey: 'scope' });
  renderPaginatedTable(document.getElementById('rate-limits-table'), 'admin-rate-limits', rateLimitColumns, bindRateLimitActions);

  document.getElementById('create-rate-limit-btn')?.addEventListener('click', () => {
    showModal('Add Rate Limit Rule', `
      <form id="rate-limit-form">
        <label class="form-label">Scope
          <select name="scope" class="input" required>
            <option value="user">User</option>
            <option value="zone">Zone</option>
            <option value="device">Device</option>
            <option value="global">Global</option>
          </select>
        </label>
        <label class="form-label">Action
          <input type="text" name="action" class="input" placeholder="e.g. unlock, reservation, login" required />
        </label>
        <label class="form-label">Max Count
          <input type="number" name="maxCount" class="input" min="1" value="5" required />
        </label>
        <label class="form-label">Window (seconds)
          <input type="number" name="windowSec" class="input" min="1" value="3600" required />
        </label>
        <label class="form-label">
          <input type="checkbox" name="enabled" checked /> Enabled
        </label>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create</button>
          <button type="button" class="btn btn-secondary" id="cancel-rl">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('cancel-rl').addEventListener('click', closeModal);
    document.getElementById('rate-limit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const rule = {
        scope:     fd.get('scope'),
        action:    fd.get('action').trim(),
        maxCount:  Number(fd.get('maxCount')),
        windowSec: Number(fd.get('windowSec')),
        enabled:   fd.has('enabled')
      };
      const result = await createRateLimit(rule, user.username);
      if (!result.success) {
        showNotification('Failed: ' + result.error, 'error');
        return;
      }
      showNotification('Rate limit rule created', 'success');
      closeModal();
      renderAdmin(container);
    });
  });

  function bindRateLimitActions() {
    document.querySelectorAll('[data-action="toggle-rl"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const currentlyEnabled = btn.dataset.enabled === 'true';
        const result = await updateRateLimit(Number(btn.dataset.id), { enabled: !currentlyEnabled }, user.username);
        if (!result.success) { showNotification('Update failed', 'error'); return; }
        showNotification(`Rule ${currentlyEnabled ? 'disabled' : 'enabled'}`, 'success');
        renderAdmin(container);
      });
    });

    document.querySelectorAll('[data-action="delete-rl"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const result = await deleteRateLimit(Number(btn.dataset.id), user.username);
        if (!result.success) { showNotification('Delete failed', 'error'); return; }
        showNotification('Rule deleted', 'success');
        renderAdmin(container);
      });
    });
  }
}
