import DB from '../database.js';
import { requireRole, getCurrentUser } from '../services/auth-service.js';
import DeviceService from '../services/device.js';
import { getPermissionsForReservation, consumeEntry, getPermissionStatusLabel } from '../services/permissions.js';
import { checkRateLimit } from '../services/rate-limits.js';
import { showDrawer, closeDrawer } from '../components/drawer.js';
import { showModal, closeModal } from '../components/modal.js';
import { showNotification } from '../components/notifications.js';
import { addAuditLog } from '../services/audit.js';

export async function renderUnlock(container) {
  if (!requireRole(['admin', 'operator'])) return;
  const user = getCurrentUser();

  await DeviceService.init();
  const devices = await DeviceService.getDevices();
  const outbox = await DeviceService.getOutbox();

  container.innerHTML = `
    <div class="view-header">
      <h1>Remote Unlock</h1>
      <button class="btn btn-primary" id="add-device-btn">+ Add Device</button>
    </div>
    <div class="device-grid">
      ${devices.length === 0 ? '<p class="empty-state">No devices registered. Add a device to get started.</p>' : ''}
      ${devices.map(d => `
        <div class="device-card device-${d.status}" data-device-id="${d.id}">
          <div class="device-header">
            <h3>${d.name}</h3>
            <span class="badge badge-${d.status === 'online' ? 'approved' : 'denied'}">${d.status}</span>
          </div>
          <p class="device-zone">Zone: ${d.zone || 'Unassigned'}</p>
          <p class="device-type">Type: ${d.type || 'door'}</p>
          <p class="device-seen">Last seen: ${d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'Never'}</p>
          <button class="btn btn-primary btn-block unlock-btn" data-device-id="${d.id}" data-device-name="${d.name}">
            Unlock
          </button>
        </div>
      `).join('')}
    </div>

    <h2 style="margin-top:24px">Command Outbox</h2>
    <div id="outbox-list">
      ${outbox.length === 0 ? '<p class="empty-state">No pending commands.</p>' : ''}
      <table class="data-table">
        <thead><tr><th>Device</th><th>Type</th><th>Status</th><th>Retries</th><th>Created</th><th>Reason</th></tr></thead>
        <tbody>
          ${outbox.map(cmd => `<tr>
            <td>${cmd.deviceId}</td>
            <td>${cmd.type}</td>
            <td><span class="badge badge-${cmd.status === 'acknowledged' ? 'approved' : cmd.status === 'failed' ? 'denied' : 'pending'}">${cmd.status}</span></td>
            <td>${cmd.retryCount}</td>
            <td>${new Date(cmd.createdAt).toLocaleString()}</td>
            <td>${cmd.reason || ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Unlock button handlers
  container.querySelectorAll('.unlock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const deviceId = Number(btn.dataset.deviceId);
      const deviceName = btn.dataset.deviceName;
      openUnlockDrawer(deviceId, deviceName);
    });
  });

  // Add device button
  document.getElementById('add-device-btn').addEventListener('click', () => {
    showModal('Add Device', `
      <form id="device-form">
        <label class="form-label">Device Name
          <input type="text" name="name" class="input" required />
        </label>
        <label class="form-label">Type
          <select name="type" class="input">
            <option value="door">Door</option>
            <option value="gate">Gate</option>
            <option value="camera">Camera</option>
            <option value="sensor">Sensor</option>
          </select>
        </label>
        <label class="form-label">Zone
          <select name="zone" class="input">
            <option value="lobby">Lobby</option>
            <option value="office-a">Office A</option>
            <option value="office-b">Office B</option>
            <option value="warehouse">Warehouse</option>
            <option value="dock">Dock</option>
          </select>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add Device</button>
          <button type="button" class="btn btn-secondary" id="cancel-device">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('cancel-device').addEventListener('click', closeModal);
    document.getElementById('device-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);
      await DeviceService.registerDevice(data);
      showNotification('Device added', 'success');
      closeModal();
      renderUnlock(container);
    });
  });

  function openUnlockDrawer(deviceId, deviceName) {
    showDrawer('Unlock: ' + deviceName, `
      <form id="unlock-form">
        <p>You are about to unlock <strong>${deviceName}</strong>.</p>
        <p class="hint">This action will be recorded in the audit log.</p>
        <label class="form-label">Reservation ID (required for visitor access)
          <input type="text" name="reservationId" class="input" placeholder="Enter reservation ID or leave blank for operator override" />
        </label>
        <label class="form-label">Reason (min 10 characters)
          <textarea name="reason" class="input" rows="3" required minlength="10"></textarea>
        </label>
        <div id="unlock-error" class="auth-error"></div>
        <div class="form-actions">
          <button type="submit" class="btn btn-danger">Confirm Unlock</button>
          <button type="button" class="btn btn-secondary" id="cancel-unlock">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('cancel-unlock').addEventListener('click', closeDrawer);
    document.getElementById('unlock-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const reason = fd.get('reason');
      const reservationId = fd.get('reservationId')?.trim();

      if (reason.length < 10) {
        document.getElementById('unlock-error').textContent = 'Reason must be at least 10 characters';
        return;
      }

      // Validate permission BEFORE showing the confirmation modal
      let activePermission = null;
      if (reservationId) {
        const permissions = await getPermissionsForReservation(Number(reservationId));
        activePermission = permissions.find(p => p.status === 'active');
        if (!activePermission) {
          document.getElementById('unlock-error').textContent =
            'No active entry permission found for this reservation. Permission may be expired, consumed, or outside the allowed time window.';
          return;
        }
      }

      // Rate-limit check: device-scoped and global unlock rules
      const [deviceRl, globalRl] = await Promise.all([
        checkRateLimit('device', String(deviceId), 'unlock'),
        checkRateLimit('global', '', 'unlock')
      ]);
      if (!deviceRl.allowed || !globalRl.allowed) {
        document.getElementById('unlock-error').textContent =
          'Unlock rate limit reached for this device. Try again later.';
        await addAuditLog('unlock_rate_limited', user.username, { deviceId, remaining: Math.min(deviceRl.remaining, globalRl.remaining) });
        return;
      }

      // Show confirmation modal (prompt requirement: Drawer + Modal for unlock)
      closeDrawer();
      showModal('Confirm Remote Unlock', `
        <div class="confirm-unlock-panel">
          <p>You are about to remotely unlock <strong>${deviceName}</strong>.</p>
          ${reservationId ? `<p><strong>Reservation ID:</strong> ${reservationId}</p>` : '<p><em>Operator override — no reservation.</em></p>'}
          <p><strong>Reason recorded:</strong> ${reason}</p>
          <p class="hint">This action will be immutably recorded in the audit log.</p>
          <div id="confirm-unlock-error" class="auth-error"></div>
          <div class="form-actions">
            <button class="btn btn-danger" id="confirm-unlock-yes">Yes, Unlock Now</button>
            <button class="btn btn-secondary" id="confirm-unlock-no">Cancel</button>
          </div>
        </div>
      `);

      document.getElementById('confirm-unlock-no').addEventListener('click', closeModal);
      document.getElementById('confirm-unlock-yes').addEventListener('click', async () => {
        closeModal();
        showNotification('Sending unlock command...', 'info');
        const result = await DeviceService.sendUnlockCommand(deviceId, reason, user.username);

        if (result.success) {
          // Consume the permission ONLY after a successful/acknowledged unlock command
          if (activePermission && result.status === 'acknowledged') {
            const consumeResult = await consumeEntry(activePermission.id, user);
            if (!consumeResult.success) {
              showNotification('Unlock sent but failed to consume permission: ' + consumeResult.error, 'warning');
            }
          }

          if (result.status === 'acknowledged') {
            showNotification('Door unlocked successfully', 'success');
          } else {
            showNotification('Command queued — waiting for device ACK', 'warning');
          }
          renderUnlock(container);
        } else {
          showNotification('Unlock failed: ' + result.error, 'error');
        }
      });
    });
  }
}
