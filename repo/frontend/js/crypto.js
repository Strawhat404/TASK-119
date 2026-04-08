/**
 * Web Crypto API helpers — AES-GCM encryption with PBKDF2 key derivation.
 */
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100000;
const ENC_AT_REST_SALT = 'harborgate-at-rest-v1';

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

const Crypto = {
  async encrypt(plaintext, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password, salt);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );

    const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

    return btoa(String.fromCharCode(...combined));
  },

  async decrypt(encoded, password) {
    const data = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const salt = data.slice(0, SALT_LENGTH);
    const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);

    const key = await deriveKey(password, salt);

    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(plainBuffer);
  },

  generateId() {
    return crypto.getRandomValues(new Uint8Array(16))
      .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  },

  async hashPassword(password, salt) {
    const enc = new TextEncoder();
    const saltBytes = salt ? Uint8Array.from(atob(salt), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
    const saltB64 = salt || btoa(String.fromCharCode(...saltBytes));
    return { hash: hashB64, salt: saltB64 };
  },

  async verifyPassword(password, storedHash, storedSalt) {
    const { hash } = await this.hashPassword(password, storedSalt);
    return hash === storedHash;
  },

  async encryptObject(obj, password) {
    const json = JSON.stringify(obj);
    return this.encrypt(json, password);
  },

  async decryptObject(encrypted, password) {
    const json = await this.decrypt(encrypted, password);
    return JSON.parse(json);
  },

  /**
   * Derive a Key Encryption Key (KEK) from the user's password.
   * Used to wrap/unwrap the shared Data Encryption Key (DEK).
   */
  async deriveKEK(password) {
    const enc = new TextEncoder();
    const salt = enc.encode(ENC_AT_REST_SALT);
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey']
    );
  },

  /**
   * Generate a random Data Encryption Key (DEK) for at-rest encryption.
   * Created once during initial setup; shared across all users via key wrapping.
   */
  async generateDEK() {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,  // extractable — required for wrapKey
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Wrap (encrypt) the DEK with a user's KEK for persistent storage.
   * Returns { iv, wrapped } as base64 strings.
   */
  async wrapDEK(dek, kek) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
    return {
      iv: btoa(String.fromCharCode(...iv)),
      wrapped: btoa(String.fromCharCode(...new Uint8Array(wrapped)))
    };
  },

  /**
   * Unwrap (decrypt) the DEK using a user's KEK.
   * Returns a CryptoKey suitable for encrypt/decrypt operations.
   */
  async unwrapDEK(wrappedData, kek) {
    const iv = Uint8Array.from(atob(wrappedData.iv), c => c.charCodeAt(0));
    const wrapped = Uint8Array.from(atob(wrappedData.wrapped), c => c.charCodeAt(0));
    return crypto.subtle.unwrapKey(
      'raw', wrapped, kek,
      { name: 'AES-GCM', iv },
      { name: 'AES-GCM', length: 256 },
      true,  // extractable — so admin can re-wrap for new users
      ['encrypt', 'decrypt']
    );
  },

  /**
   * Encrypt a record payload with a CryptoKey (for at-rest encryption).
   */
  async encryptRecord(record, cryptoKey) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintext = enc.encode(JSON.stringify(record));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return {
      _encrypted: true,
      _payload: btoa(String.fromCharCode(...combined))
    };
  },

  /**
   * Decrypt a record payload with a CryptoKey (for at-rest decryption).
   */
  async decryptRecord(encRecord, cryptoKey) {
    if (!encRecord || !encRecord._encrypted) return encRecord;
    const data = Uint8Array.from(atob(encRecord._payload), c => c.charCodeAt(0));
    const iv = data.slice(0, IV_LENGTH);
    const ciphertext = data.slice(IV_LENGTH);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  }
};

export default Crypto;
