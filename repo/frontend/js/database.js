/**
 * IndexedDB wrapper for HarborGate data.
 * Supports encryption at rest for sensitive stores via a session-derived CryptoKey.
 */
const DB_NAME = 'harborgate';
const DB_VERSION = 2;

// Stores whose records are encrypted at rest when a session key is available.
// NOTE: 'users' and 'roles' are intentionally excluded — user records must be
// readable pre-auth (before any session key exists) so that login can read
// passwordHash/salt for verification. Auth fields are already protected by
// PBKDF2 hashing; encrypting them with a per-session key would lock users out
// whenever an admin updates their record under a different key.
const ENCRYPTED_STORES = new Set([
  'reservations',
  'devices',
  'reports',
  'audit_logs',
  'notifications',
  'command_outbox',
  'rate_limits'
]);

const STORES = {
  users: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'username', keyPath: 'username', unique: true }, { name: 'role', keyPath: 'role' }] },
  roles: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'name', keyPath: 'name', unique: true }] },
  rate_limits: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'scope', keyPath: 'scope' }, { name: 'action', keyPath: 'action' }] },
  reservations: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'status', keyPath: 'status' }] },
  entry_permissions: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'reservationId', keyPath: 'reservationId' }, { name: 'status', keyPath: 'status' }] },
  devices: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'zone', keyPath: 'zone' }, { name: 'status', keyPath: 'status' }] },
  pois: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'zone', keyPath: 'zone' }] },
  content: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'status', keyPath: 'status' }, { name: 'workflowState', keyPath: 'workflowState' }] },
  reports: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'type', keyPath: 'type' }, { name: 'status', keyPath: 'status' }] },
  audit_logs: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'actor', keyPath: 'actor' }, { name: 'timestamp', keyPath: 'timestamp' }, { name: 'action', keyPath: 'action' }] },
  notifications: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'read', keyPath: 'read' }, { name: 'scheduledFor', keyPath: 'scheduledFor' }] },
  command_outbox: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'status', keyPath: 'status' }, { name: 'deviceId', keyPath: 'deviceId' }] },
  zones: { keyPath: 'id', autoIncrement: true },
  geofences: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'zone', keyPath: 'zone' }] }
};

let dbInstance = null;

// In-memory encryption key — never persisted
let _encryptionKey = null;

function setEncryptionKey(key) {
  _encryptionKey = key;
}

function clearEncryptionKey() {
  _encryptionKey = null;
}

function getEncryptionKey() {
  return _encryptionKey;
}

async function encryptIfNeeded(storeName, record) {
  if (!_encryptionKey || !ENCRYPTED_STORES.has(storeName)) return record;
  try {
    const { default: Crypto } = await import('./crypto.js');
    const indexFields = { id: record.id };
    if (storeName === 'reservations') {
      indexFields.userId = record.userId;
      indexFields.status = record.status;
    } else if (storeName === 'devices') {
      indexFields.zone = record.zone;
      indexFields.status = record.status;
    } else if (storeName === 'reports') {
      indexFields.type = record.type;
      indexFields.status = record.status;
    } else if (storeName === 'audit_logs') {
      indexFields.actor = record.actor;
      indexFields.timestamp = record.timestamp;
      indexFields.action = record.action;
    } else if (storeName === 'notifications') {
      indexFields.userId = record.userId;
      indexFields.read = record.read;
      indexFields.scheduledFor = record.scheduledFor;
    } else if (storeName === 'command_outbox') {
      indexFields.status = record.status;
      indexFields.deviceId = record.deviceId;
    } else if (storeName === 'rate_limits') {
      indexFields.scope = record.scope;
      indexFields.action = record.action;
    }
    const encrypted = await Crypto.encryptRecord(record, _encryptionKey);
    return { ...encrypted, ...indexFields };
  } catch {
    return record;
  }
}

async function decryptIfNeeded(storeName, record) {
  if (!record || !record._encrypted || !_encryptionKey) return record;
  if (!ENCRYPTED_STORES.has(storeName)) return record;
  try {
    const { default: Crypto } = await import('./crypto.js');
    const decrypted = await Crypto.decryptRecord(record, _encryptionKey);
    decrypted.id = record.id;
    return decrypted;
  } catch {
    return record;
  }
}

async function decryptArray(storeName, records) {
  if (!_encryptionKey || !ENCRYPTED_STORES.has(storeName)) return records;
  return Promise.all(records.map(r => decryptIfNeeded(storeName, r)));
}

function open() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const [name, opts] of Object.entries(STORES)) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: opts.keyPath, autoIncrement: opts.autoIncrement });
        } else {
          store = event.target.transaction.objectStore(name);
        }
        if (opts.indexes) {
          for (const idx of opts.indexes) {
            if (!store.indexNames.contains(idx.name)) {
              store.createIndex(idx.name, idx.keyPath, { unique: idx.unique || false });
            }
          }
        }
      }
    };
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

async function getStore(storeName, mode = 'readonly') {
  const db = await open();
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const DB = {
  async getAll(storeName) {
    const store = await getStore(storeName);
    const records = await promisify(store.getAll());
    return decryptArray(storeName, records);
  },
  async get(storeName, id) {
    const store = await getStore(storeName);
    const record = await promisify(store.get(id));
    return decryptIfNeeded(storeName, record);
  },
  async getByIndex(storeName, indexName, value) {
    const store = await getStore(storeName);
    const index = store.index(indexName);
    const records = await promisify(index.getAll(value));
    return decryptArray(storeName, records);
  },
  async getOneByIndex(storeName, indexName, value) {
    const store = await getStore(storeName);
    const index = store.index(indexName);
    const record = await promisify(index.get(value));
    return decryptIfNeeded(storeName, record);
  },
  async add(storeName, record) {
    const encrypted = await encryptIfNeeded(storeName, record);
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.add(encrypted));
  },
  async put(storeName, record) {
    const encrypted = await encryptIfNeeded(storeName, record);
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.put(encrypted));
  },
  async remove(storeName, id) {
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.delete(id));
  },
  async clear(storeName) {
    const store = await getStore(storeName, 'readwrite');
    return promisify(store.clear());
  },
  async count(storeName) {
    const store = await getStore(storeName);
    return promisify(store.count());
  },
  async close() {
    if (dbInstance) {
      dbInstance.close();
      dbInstance = null;
    }
  }
};

export { setEncryptionKey, clearEncryptionKey, getEncryptionKey };
export default DB;
