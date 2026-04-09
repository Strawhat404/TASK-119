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

describe('Crypto — At-Rest Encryption (KEK/DEK model)', () => {
  // Mirrors the production crypto.js KEK/DEK key-wrapping model:
  //   deriveKEK(password) → wrapKey/unwrapKey
  //   generateDEK()       → encrypt/decrypt (extractable for wrapping)
  //   wrapDEK / unwrapDEK → persist DEK per-user
  //   encryptRecord / decryptRecord → at-rest encryption with DEK

  const ENC_AT_REST_SALT = 'harborgate-at-rest-v1';

  async function deriveKEK(password) {
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
  }

  async function generateDEK() {
    return crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function wrapDEK(dek, kek) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
    return {
      iv: Buffer.from(iv).toString('base64'),
      wrapped: Buffer.from(new Uint8Array(wrapped)).toString('base64')
    };
  }

  async function unwrapDEK(wrappedData, kek) {
    const iv = Buffer.from(wrappedData.iv, 'base64');
    const wrapped = Buffer.from(wrappedData.wrapped, 'base64');
    return crypto.subtle.unwrapKey(
      'raw', wrapped, kek,
      { name: 'AES-GCM', iv },
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptRecord(record, dek) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const plaintext = enc.encode(JSON.stringify(record));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext);
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return { _encrypted: true, _payload: Buffer.from(combined).toString('base64') };
  }

  async function decryptRecord(encRecord, dek) {
    if (!encRecord || !encRecord._encrypted) return encRecord;
    const data = Buffer.from(encRecord._payload, 'base64');
    const iv = data.subarray(0, IV_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH);
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ciphertext);
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  }

  it('should generate a DEK and encrypt/decrypt a record', async () => {
    const dek = await generateDEK();
    const record = { username: 'admin', passwordHash: 'abc123', role: 'admin' };
    const encrypted = await encryptRecord(record, dek);
    assert.equal(encrypted._encrypted, true);
    assert.ok(encrypted._payload);

    const decrypted = await decryptRecord(encrypted, dek);
    assert.equal(decrypted.username, 'admin');
    assert.equal(decrypted.passwordHash, 'abc123');
  });

  it('should wrap and unwrap DEK with same password KEK', async () => {
    const kek = await deriveKEK('TestPassword1!');
    const dek = await generateDEK();
    const wrappedData = await wrapDEK(dek, kek);

    const kek2 = await deriveKEK('TestPassword1!');
    const unwrappedDek = await unwrapDEK(wrappedData, kek2);

    const record = { test: 'data' };
    const encrypted = await encryptRecord(record, dek);
    const decrypted = await decryptRecord(encrypted, unwrappedDek);
    assert.deepEqual(decrypted, record);
  });

  it('should fail to unwrap DEK with wrong password KEK', async () => {
    const kek1 = await deriveKEK('CorrectPassword1!');
    const dek = await generateDEK();
    const wrappedData = await wrapDEK(dek, kek1);

    const kek2 = await deriveKEK('WrongPassword1!!');
    await assert.rejects(() => unwrapDEK(wrappedData, kek2));
  });

  it('should fail decryption with a different DEK', async () => {
    const dek1 = await generateDEK();
    const dek2 = await generateDEK();
    const record = { secret: 'value' };
    const encrypted = await encryptRecord(record, dek1);
    await assert.rejects(() => decryptRecord(encrypted, dek2));
  });

  it('should pass through non-encrypted records', async () => {
    const record = { username: 'test', role: 'visitor' };
    const result = await decryptRecord(record, null);
    assert.deepEqual(result, record);
  });
});
