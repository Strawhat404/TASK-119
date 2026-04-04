import Store from '../store.js';
import { refreshSession, logout } from '../services/auth-service.js';

let warningEl = null;

export function initSessionWarning() {
  Store.subscribe((key, value) => {
    if (key === 'sessionWarning' && value === true) {
      showSessionWarning();
    }
    if (key === 'sessionExpired' && value === true) {
      hideSessionWarning();
      showExpiredNotice();
    }
  });
}

function showSessionWarning() {
  if (warningEl) return;

  warningEl = document.createElement('div');
  warningEl.className = 'session-warning-overlay';
  warningEl.innerHTML = `
    <div class="session-warning">
      <h2>Session Expiring</h2>
      <p>Your session will expire in 5 minutes due to inactivity.</p>
      <div class="form-actions">
        <button class="btn btn-primary" id="extend-session-btn">Extend Session</button>
        <button class="btn btn-secondary" id="logout-session-btn">Logout</button>
      </div>
    </div>
  `;

  document.body.appendChild(warningEl);

  document.getElementById('extend-session-btn').addEventListener('click', () => {
    refreshSession();
    Store.set('sessionWarning', false);
    hideSessionWarning();
  });

  document.getElementById('logout-session-btn').addEventListener('click', () => {
    logout();
    hideSessionWarning();
    window.location.hash = '/login';
  });
}

function hideSessionWarning() {
  if (warningEl) {
    warningEl.remove();
    warningEl = null;
  }
}

function showExpiredNotice() {
  const el = document.createElement('div');
  el.className = 'session-warning-overlay';
  el.innerHTML = `
    <div class="session-warning">
      <h2>Session Expired</h2>
      <p>Your session has expired due to inactivity. Please log in again.</p>
      <div class="form-actions">
        <button class="btn btn-primary" id="relogin-btn">Log In</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  document.getElementById('relogin-btn').addEventListener('click', () => {
    el.remove();
    window.location.hash = '/login';
  });
}
