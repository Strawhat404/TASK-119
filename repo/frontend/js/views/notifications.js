import DB from '../database.js';
import { requireAuth, getCurrentUser, hasRole } from '../services/auth-service.js';
import { getUserNotifications, retryFailedNotifications, getTemplates } from '../services/notifications.js';
import Store from '../store.js';
import { renderPaginatedTable } from '../components/table.js';
import { showNotification } from '../components/notifications.js';
import { showModal, closeModal, escapeHTML } from '../components/modal.js';

function formatRelativeDate(ts) {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function groupByDate(notifications) {
  const groups = {};
  for (const n of notifications) {
    const ts = n.createdAt || n.timestamp || 0;
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let label;
    if (d.toDateString() === today.toDateString()) {
      label = 'Today';
    } else if (d.toDateString() === yesterday.toDateString()) {
      label = 'Yesterday';
    } else {
      label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    }

    if (!groups[label]) groups[label] = [];
    groups[label].push(n);
  }
  return groups;
}

export async function renderNotifications(container) {
  if (!await requireAuth()) return;
  const user = getCurrentUser();
  const isAdmin = hasRole(['admin']);

  let notifications = isAdmin
    ? await getUserNotifications()
    : await getUserNotifications(user.id);

  notifications.sort((a, b) => (b.createdAt || b.timestamp || 0) - (a.createdAt || a.timestamp || 0));

  const unreadCount = notifications.filter(n => !n.read).length;

  container.innerHTML = `
    <div class="view-header">
      <h1>Notifications${unreadCount > 0 ? ` <span class="notification-badge">${unreadCount}</span>` : ''}</h1>
      <div>
        <button class="btn btn-secondary" id="retry-failed-btn">Retry Undelivered</button>
        <button class="btn btn-secondary" id="mark-all-read">Mark All Read</button>
        <button class="btn btn-danger" id="clear-all-notif">Clear All</button>
      </div>
    </div>
    <div class="filters">
      <select id="notif-status-filter" class="input">
        <option value="">All</option>
        <option value="delivered">Delivered</option>
        <option value="pending">Pending</option>
        <option value="failed">Failed</option>
      </select>
      <select id="notif-type-filter" class="input">
        <option value="">All Types</option>
        <option value="info">Info</option>
        <option value="success">Success</option>
        <option value="warning">Warning</option>
        <option value="error">Error</option>
      </select>
    </div>
    <div id="notifications-inbox"></div>
  `;

  let filtered = notifications;

  function renderInbox(items) {
    const inbox = document.getElementById('notifications-inbox');

    if (items.length === 0) {
      inbox.innerHTML = '<div class="inbox-empty"><p>Your inbox is empty</p></div>';
      return;
    }

    const groups = groupByDate(items);
    let html = '';

    for (const [label, group] of Object.entries(groups)) {
      html += `<div class="inbox-group">
        <div class="inbox-group-header">${label}</div>`;

      for (const n of group) {
        const unreadClass = n.read ? '' : ' inbox-item-unread';
        const typeBadge = `<span class="badge badge-${n.type || 'info'}">${n.type || 'info'}</span>`;
        const deliveryBadge = n.status === 'failed'
          ? ' <span class="badge badge-denied">failed</span>'
          : n.status === 'pending'
            ? ' <span class="badge badge-pending">pending</span>'
            : '';
        const timeStr = formatRelativeDate(n.createdAt || n.timestamp || 0);

        html += `
          <div class="inbox-item${unreadClass}" data-id="${n.id}">
            <div class="inbox-item-indicator">
              ${n.read ? '' : '<span class="unread-dot"></span>'}
            </div>
            <div class="inbox-item-content">
              <div class="inbox-item-header">
                ${typeBadge}${deliveryBadge}
                <span class="inbox-item-time">${timeStr}</span>
              </div>
              <div class="inbox-item-message">${escapeHTML(n.message || n.templateId || '')}</div>
            </div>
            <div class="inbox-item-actions">
              ${!n.read ? `<button class="btn btn-sm" data-action="read" data-id="${n.id}" title="Mark as read">Mark Read</button>` : ''}
              <button class="btn btn-sm btn-danger" data-action="delete" data-id="${n.id}" title="Delete">Delete</button>
            </div>
          </div>`;
      }

      html += '</div>';
    }

    inbox.innerHTML = html;
    bindActions();
  }

  renderInbox(filtered);

  document.getElementById('notif-status-filter').addEventListener('change', (e) => {
    const s = e.target.value;
    filtered = s ? notifications.filter(n => n.status === s) : notifications;
    applyTypeFilter();
  });

  document.getElementById('notif-type-filter').addEventListener('change', () => {
    applyTypeFilter();
  });

  function applyTypeFilter() {
    const s = document.getElementById('notif-status-filter').value;
    const t = document.getElementById('notif-type-filter').value;
    let result = notifications;
    if (s) result = result.filter(n => n.status === s);
    if (t) result = result.filter(n => n.type === t);
    filtered = result;
    renderInbox(filtered);
  }

  document.getElementById('retry-failed-btn').addEventListener('click', async () => {
    const results = await retryFailedNotifications();
    showNotification(`Retried ${results.length} undelivered notification(s)`, 'info');
    renderNotifications(container);
  });

  document.getElementById('mark-all-read').addEventListener('click', async () => {
    for (const n of notifications) {
      if (!n.read) { n.read = true; await DB.put('notifications', n); }
    }
    showNotification('All marked as read', 'success');
    renderNotifications(container);
  });

  document.getElementById('clear-all-notif').addEventListener('click', async () => {
    if (isAdmin) {
      // Admin can clear all notifications
      await DB.clear('notifications');
    } else {
      // Non-admin: only delete own notifications
      for (const n of notifications) {
        await DB.remove('notifications', n.id);
      }
    }
    showNotification('Notifications cleared', 'success');
    renderNotifications(container);
  });

  function bindActions() {
    document.querySelectorAll('[data-action="read"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const n = await DB.get('notifications', Number(btn.dataset.id));
        // Only allow marking own notifications as read
        if (n && (isAdmin || n.userId === user.id)) {
          n.read = true;
          await DB.put('notifications', n);
          renderNotifications(container);
        }
      });
    });

    document.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const n = await DB.get('notifications', Number(btn.dataset.id));
        // Only allow deleting own notifications
        if (n && (isAdmin || n.userId === user.id)) {
          await DB.remove('notifications', n.id);
          renderNotifications(container);
        }
      });
    });
  }
}
