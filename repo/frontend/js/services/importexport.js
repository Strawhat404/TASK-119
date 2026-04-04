/**
 * Import/Export service.
 * - Browser-side Blob downloads and file pickers
 * - Encrypted JSON bundles for backup/migration
 */
import DB from '../database.js';
import Crypto from '../crypto.js';

const EXPORT_STORES = [
  'users', 'roles', 'reservations', 'entry_permissions', 'devices',
  'pois', 'content', 'reports', 'audit_logs', 'notifications',
  'command_outbox', 'zones', 'geofences'
];

export async function exportData(password) {
  if (!password || password.trim() === '') {
    throw new Error('A backup password is required. Plaintext export is not permitted.');
  }

  const bundle = {
    version: 1,
    exportedAt: Date.now(),
    stores: {}
  };

  for (const store of EXPORT_STORES) {
    bundle.stores[store] = await DB.getAll(store);
  }

  const encrypted = await Crypto.encryptObject(bundle, password);
  return { encrypted: true, data: encrypted };
}

export function downloadJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importData(fileContent, password) {
  if (!password || password.trim() === '') {
    throw new Error('A backup password is required. Plaintext import is not permitted.');
  }

  const parsed = JSON.parse(fileContent);

  if (!parsed.encrypted) {
    throw new Error('This backup is not encrypted. Only encrypted backups are accepted.');
  }

  const bundle = await Crypto.decryptObject(parsed.data, password);

  if (!bundle.stores) throw new Error('Invalid backup format');

  for (const [storeName, records] of Object.entries(bundle.stores)) {
    if (!EXPORT_STORES.includes(storeName)) continue;
    await DB.clear(storeName);
    for (const record of records) {
      await DB.add(storeName, record);
    }
  }

  return { success: true, storesImported: Object.keys(bundle.stores).length };
}

export function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(file);
    };
    input.click();
  });
}
