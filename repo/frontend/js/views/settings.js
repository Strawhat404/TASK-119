import Crypto from '../crypto.js';
import { requireAuth, getCurrentUser, hasRole, logout } from '../services/auth-service.js';
import { exportData, importData, downloadJSON, pickFile } from '../services/importexport.js';
import { showNotification } from '../components/notifications.js';
import { escapeHTML } from '../components/modal.js';

export async function renderSettings(container) {
  if (!await requireAuth()) return;
  const user = getCurrentUser();
  const isAdmin = hasRole(['admin']);

  const currentTheme = localStorage.getItem('hg_theme') || 'light';
  const sessionRaw = localStorage.getItem('hg_session');
  const session = sessionRaw ? JSON.parse(sessionRaw) : null;

  container.innerHTML = `
    <div class="view-header">
      <h1>Settings</h1>
    </div>
    <div class="settings-grid">
      <section class="settings-section">
        <h2>Session</h2>
        <p>Logged in as: <strong>${escapeHTML(user.username)}</strong> (${escapeHTML(user.role)})</p>
        <p>Last activity: ${session?.lastActivity ? new Date(session.lastActivity).toLocaleString() : 'N/A'}</p>
        <button class="btn btn-danger" id="logout-btn">Logout</button>
      </section>

      <section class="settings-section">
        <h2>Appearance</h2>
        <label class="form-label">Theme
          <select id="theme-select" class="input">
            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
      </section>

      <section class="settings-section">
        <h2>Encryption Test</h2>
        <form id="encryption-form">
          <label class="form-label">Password
            <input type="password" id="enc-password" class="input" placeholder="Encryption password" />
          </label>
          <label class="form-label">Test Message
            <input type="text" id="enc-test" class="input" placeholder="Message to encrypt/decrypt" />
          </label>
          <div class="form-actions">
            <button type="button" class="btn btn-primary" id="encrypt-btn">Encrypt</button>
            <button type="button" class="btn btn-secondary" id="decrypt-btn">Decrypt</button>
          </div>
          <div id="crypto-result" class="crypto-result"></div>
        </form>
      </section>

      ${isAdmin ? `
      <section class="settings-section">
        <h2>Import / Export <span class="badge badge-admin">Admin Only</span></h2>
        <p class="hint">Export all data as an encrypted JSON bundle for backup or migration. A password is <strong>required</strong> — plaintext export is not permitted.</p>
        <label class="form-label">Backup Password <span class="required-star">*</span>
          <input type="password" id="backup-password" class="input" placeholder="Required — min 8 characters" required />
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" id="export-btn">Export Data</button>
          <button class="btn btn-secondary" id="import-btn">Import Data</button>
        </div>
      </section>

      <section class="settings-section">
        <h2>Data Management <span class="badge badge-admin">Admin Only</span></h2>
        <button class="btn btn-danger" id="clear-all-data">Clear All Data</button>
        <p class="hint">Removes all records from IndexedDB. This cannot be undone.</p>
      </section>
      ` : `
      <section class="settings-section">
        <h2>Data Management</h2>
        <p class="hint">Import/export and data management are restricted to administrators.</p>
      </section>
      `}
    </div>
  `;

  document.getElementById('logout-btn').addEventListener('click', () => {
    logout();
    window.location.hash = '/login';
  });

  document.getElementById('theme-select').addEventListener('change', (e) => {
    localStorage.setItem('hg_theme', e.target.value);
    document.documentElement.setAttribute('data-theme', e.target.value);
    showNotification('Theme updated', 'success');
  });

  document.getElementById('encrypt-btn').addEventListener('click', async () => {
    const pw = document.getElementById('enc-password').value;
    const msg = document.getElementById('enc-test').value;
    if (!pw || !msg) return showNotification('Enter password and message', 'warning');
    const encrypted = await Crypto.encrypt(msg, pw);
    document.getElementById('crypto-result').textContent = encrypted;
  });

  document.getElementById('decrypt-btn').addEventListener('click', async () => {
    const pw = document.getElementById('enc-password').value;
    const cipher = document.getElementById('crypto-result').textContent;
    if (!pw || !cipher) return showNotification('Encrypt something first', 'warning');
    try {
      const decrypted = await Crypto.decrypt(cipher, pw);
      document.getElementById('enc-test').value = decrypted;
      showNotification('Decrypted successfully', 'success');
    } catch {
      showNotification('Decryption failed — wrong password?', 'error');
    }
  });

  if (isAdmin) {
    document.getElementById('export-btn').addEventListener('click', async () => {
      const pw = document.getElementById('backup-password').value.trim();
      if (!pw) {
        showNotification('A backup password is required before exporting.', 'error');
        document.getElementById('backup-password').focus();
        return;
      }
      try {
        const data = await exportData(pw);
        const filename = `harborgate-backup-${new Date().toISOString().slice(0, 10)}.json`;
        downloadJSON(data, filename);
        showNotification('Data exported (encrypted)', 'success');
      } catch (err) {
        showNotification('Export failed: ' + err.message, 'error');
      }
    });

    document.getElementById('import-btn').addEventListener('click', async () => {
      const pw = document.getElementById('backup-password').value.trim();
      if (!pw) {
        showNotification('A backup password is required before importing.', 'error');
        document.getElementById('backup-password').focus();
        return;
      }
      const content = await pickFile();
      if (!content) return;
      try {
        const result = await importData(content, pw);
        showNotification(`Imported ${result.storesImported} stores successfully`, 'success');
      } catch (err) {
        showNotification('Import failed: ' + err.message, 'error');
      }
    });

    document.getElementById('clear-all-data').addEventListener('click', async () => {
      const { default: DB } = await import('../database.js');
      for (const store of ['users', 'roles', 'rate_limits', 'reservations', 'entry_permissions', 'devices', 'pois', 'content', 'reports', 'notifications', 'command_outbox', 'zones', 'geofences']) {
        await DB.clear(store);
      }
      logout();
      showNotification('All data cleared', 'success');
      window.location.hash = '/login';
    });
  }
}
