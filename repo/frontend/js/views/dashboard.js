import DB from '../database.js';
import { requireAuth, getCurrentUser } from '../services/auth-service.js';
import { createNotificationBadge } from '../components/notifications.js';
import { processScheduledNotifications } from '../services/notifications.js';
import { expirePermissions } from '../services/permissions.js';

export async function renderDashboard(container) {
  if (!requireAuth()) return;
  const user = getCurrentUser();

  // Run scheduled tasks
  await processScheduledNotifications();
  await expirePermissions();

  const [reservations, notifications, content, devices, auditLogs] = await Promise.all([
    DB.getAll('reservations'),
    DB.getAll('notifications'),
    DB.getAll('content'),
    DB.getAll('devices'),
    DB.getAll('audit_logs')
  ]);

  const pendingReservations = reservations.filter(r => r.status === 'pending').length;
  const activeReservations = reservations.filter(r => r.status === 'approved').length;
  const unreadNotifications = notifications.filter(n => !n.read && (n.userId === user.id || user.role === 'admin')).length;
  const flaggedContent = content.filter(c => c.flagged || c.workflowState === 'review').length;
  const onlineDevices = devices.filter(d => d.status === 'online').length;

  const roleCards = {
    visitor: ['reservations', 'notifications'],
    operator: ['reservations', 'devices', 'notifications'],
    reviewer: ['content', 'notifications'],
    admin: ['reservations', 'devices', 'content', 'notifications', 'audit']
  };

  const cards = roleCards[user.role] || roleCards.visitor;

  container.innerHTML = `
    <div class="dashboard">
      <div class="view-header">
        <h1>Dashboard</h1>
        <span class="user-badge">${user.username} (${user.role})</span>
      </div>
      <div class="stats-grid">
        ${cards.includes('reservations') ? `
        <div class="stat-card" data-link="/reservations">
          <h3>Pending Reservations</h3>
          <span class="stat-number">${pendingReservations}</span>
          <p class="stat-sub">${activeReservations} active</p>
        </div>` : ''}
        ${cards.includes('devices') ? `
        <div class="stat-card" data-link="/unlock">
          <h3>Online Devices</h3>
          <span class="stat-number">${onlineDevices}</span>
          <p class="stat-sub">${devices.length} total</p>
        </div>` : ''}
        ${cards.includes('content') ? `
        <div class="stat-card" data-link="/content">
          <h3>Content for Review</h3>
          <span class="stat-number">${flaggedContent}</span>
        </div>` : ''}
        ${cards.includes('notifications') ? `
        <div class="stat-card" data-link="/notifications">
          <h3>Unread Notifications</h3>
          <span class="stat-number">${unreadNotifications}</span>
          ${createNotificationBadge(unreadNotifications)}
        </div>` : ''}
        ${cards.includes('audit') ? `
        <div class="stat-card" data-link="/admin">
          <h3>Audit Entries</h3>
          <span class="stat-number">${auditLogs.length}</span>
        </div>` : ''}
      </div>
      <div class="quick-actions">
        ${cards.includes('reservations') ? '<button class="btn btn-primary" data-action="new-reservation">New Reservation</button>' : ''}
        ${cards.includes('devices') ? '<button class="btn btn-secondary" data-action="unlock">Remote Unlock</button>' : ''}
        ${cards.includes('content') ? '<button class="btn btn-secondary" data-action="review">Review Content</button>' : ''}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-link]').forEach(card => {
    card.addEventListener('click', () => { window.location.hash = card.dataset.link; });
  });

  container.querySelector('[data-action="new-reservation"]')?.addEventListener('click', () => {
    window.location.hash = '/reservations';
  });
  container.querySelector('[data-action="unlock"]')?.addEventListener('click', () => {
    window.location.hash = '/unlock';
  });
  container.querySelector('[data-action="review"]')?.addEventListener('click', () => {
    window.location.hash = '/content';
  });
}
