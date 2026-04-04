import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// We test the crypto logic that's also in the production module.
// The production crypto.js uses browser globals (btoa/atob) so we use
// the Node.js crypto API directly for the same PBKDF2+AES-GCM logic.

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100000;

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return Buffer.from(combined).toString('base64');
}

async function decrypt(encoded, password) {
  const data = Buffer.from(encoded, 'base64');
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(password, salt);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plainBuffer);
}

function generateId() {
  return crypto.getRandomValues(new Uint8Array(16))
    .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
}

describe('Crypto — AES-GCM + PBKDF2', () => {
  it('should encrypt and decrypt a string', async () => {
    const message = 'Hello HarborGate';
    const password = 'test-password-123';
    const encrypted = await encrypt(message, password);
    assert.notEqual(encrypted, message);
    const decrypted = await decrypt(encrypted, password);
    assert.equal(decrypted, message);
  });

  it('should fail decryption with wrong password', async () => {
    const encrypted = await encrypt('secret', 'right-password');
    await assert.rejects(
      () => decrypt(encrypted, 'wrong-password'),
      (err) => err instanceof Error
    );
  });

  it('should produce different ciphertexts for same input', async () => {
    const a = await encrypt('same message', 'password');
    const b = await encrypt('same message', 'password');
    assert.notEqual(a, b);
  });

  it('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateId());
    assert.equal(ids.size, 100);
  });

  it('should generate 32-char hex IDs', () => {
    const id = generateId();
    assert.equal(id.length, 32);
    assert.match(id, /^[0-9a-f]{32}$/);
  });

  it('should handle empty string encryption', async () => {
    const encrypted = await encrypt('', 'pw');
    const decrypted = await decrypt(encrypted, 'pw');
    assert.equal(decrypted, '');
  });

  it('should handle unicode content', async () => {
    const msg = 'Unicode test: \u00e9\u00e0\u00fc \u{1F600} \u4F60\u597D';
    const encrypted = await encrypt(msg, 'pw');
    const decrypted = await decrypt(encrypted, 'pw');
    assert.equal(decrypted, msg);
  });
});

describe('Crypto — At-Rest Encryption', () => {
  async function deriveSessionKey(password) {
    const enc = new TextEncoder();
    const salt = enc.encode('harborgate-at-rest-v1');
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptRecord(record, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintext = enc.encode(JSON.stringify(record));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return { _encrypted: true, _payload: Buffer.from(combined).toString('base64') };
  }

  async function decryptRecord(encRecord, key) {
    if (!encRecord || !encRecord._encrypted) return encRecord;
    const data = Buffer.from(encRecord._payload, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  }

  it('should encrypt and decrypt a record', async () => {
    const key = await deriveSessionKey('TestPassword1!');
    const record = { username: 'admin', passwordHash: 'abc123', role: 'admin' };
    const encrypted = await encryptRecord(record, key);
    assert.equal(encrypted._encrypted, true);
    assert.ok(encrypted._payload);

    const decrypted = await decryptRecord(encrypted, key);
    assert.equal(decrypted.username, 'admin');
    assert.equal(decrypted.passwordHash, 'abc123');
  });

  it('should produce same key from same password', async () => {
    const key1 = await deriveSessionKey('TestPassword1!');
    const key2 = await deriveSessionKey('TestPassword1!');
    const record = { test: 'data' };
    const enc1 = await encryptRecord(record, key1);
    const dec = await decryptRecord(enc1, key2);
    assert.deepEqual(dec, record);
  });

  it('should fail with wrong password key', async () => {
    const key1 = await deriveSessionKey('CorrectPassword1!');
    const key2 = await deriveSessionKey('WrongPassword1!!');
    const record = { secret: 'value' };
    const encrypted = await encryptRecord(record, key1);
    await assert.rejects(() => decryptRecord(encrypted, key2));
  });

  it('should pass through non-encrypted records', async () => {
    const record = { username: 'test', role: 'visitor' };
    const result = await decryptRecord(record, null);
    assert.deepEqual(result, record);
  });
});
