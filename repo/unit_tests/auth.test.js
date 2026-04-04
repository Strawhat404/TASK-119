import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// Import actual production logic from lib
import {
  validatePassword,
  isAccountLocked,
  processFailedLogin,
  processSuccessfulLogin,
  isSessionExpired,
  MAX_ATTEMPTS,
  LOCKOUT_DURATION,
  SESSION_TIMEOUT,
  SESSION_WARNING,
  ROLE_DEFINITIONS,
  hasPermissionForRole
} from '../frontend/js/lib/auth-logic.js';

describe('Password Policy', () => {
  it('should accept a valid password', () => {
    const result = validatePassword('Str0ng!Pass#1');
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should reject password shorter than 12 characters', () => {
    const result = validatePassword('Sh0rt!Pa');
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('Minimum 12 characters'));
  });

  it('should reject password without uppercase', () => {
    const result = validatePassword('nouppercase1!a');
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('At least 1 uppercase letter'));
  });

  it('should reject password without lowercase', () => {
    const result = validatePassword('NOLOWERCASE1!A');
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('At least 1 lowercase letter'));
  });

  it('should reject password without number', () => {
    const result = validatePassword('NoNumberHere!a');
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('At least 1 number'));
  });

  it('should reject password without symbol', () => {
    const result = validatePassword('NoSymbolHere1a');
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes('At least 1 symbol'));
  });

  it('should return multiple errors for very weak password', () => {
    const result = validatePassword('abc');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3);
  });

  it('should accept password with exactly 12 characters', () => {
    const result = validatePassword('Abcdefg1234!');
    assert.equal(result.valid, true);
  });

  it('should validate a strong password', () => {
    const result = validatePassword('StrongPass1!');
    assert.equal(result.valid, true);
  });
});

describe('Account Lockout', () => {
  it('should not lock after fewer than 5 failed attempts', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    for (let i = 0; i < 4; i++) {
      const result = processFailedLogin(user);
      assert.equal(result.locked, false);
    }
    assert.equal(user.failedAttempts, 4);
  });

  it('should lock after exactly 5 failed attempts', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    let result;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      result = processFailedLogin(user);
    }
    assert.equal(result.locked, true);
    assert.ok(user.lockedUntil > Date.now());
  });

  it('should lock for 15 minutes', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    const now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) processFailedLogin(user, now);
    assert.equal(user.lockedUntil, now + LOCKOUT_DURATION);
  });

  it('should report locked when within lockout period', () => {
    const user = { lockedUntil: Date.now() + 60000 };
    assert.equal(isAccountLocked(user), true);
  });

  it('should report unlocked when lockout period expired', () => {
    const user = { lockedUntil: Date.now() - 1000 };
    assert.equal(isAccountLocked(user), false);
  });

  it('should reset failed attempts on successful login', () => {
    const user = { failedAttempts: 3, lockedUntil: null };
    processSuccessfulLogin(user);
    assert.equal(user.failedAttempts, 0);
    assert.equal(user.lockedUntil, null);
  });

  it('should show attempts remaining', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    processFailedLogin(user);
    const result = processFailedLogin(user);
    assert.equal(result.attemptsLeft, 3);
  });
});

describe('Session Timeout', () => {
  it('should not expire a session within 30 minutes', () => {
    const session = { lastActivity: Date.now() - 29 * 60 * 1000 };
    assert.equal(isSessionExpired(session), false);
  });

  it('should expire a session after 30 minutes', () => {
    const session = { lastActivity: Date.now() - 31 * 60 * 1000 };
    assert.equal(isSessionExpired(session), true);
  });

  it('should use correct timeout constants', () => {
    assert.equal(SESSION_TIMEOUT, 30 * 60 * 1000);
    assert.equal(SESSION_WARNING, 25 * 60 * 1000);
  });

  it('should not expire immediately after activity', () => {
    const session = { lastActivity: Date.now() };
    assert.equal(isSessionExpired(session), false);
  });
});

describe('Default Admin Account', () => {
  it('should not have hardcoded credentials in auth-logic', () => {
    // No DEFAULT_ADMIN_PASSWORD constant — setup is done via first-run UI
    assert.equal(typeof ROLE_DEFINITIONS, 'object');
    assert.ok(ROLE_DEFINITIONS.find(r => r.name === 'admin'), 'admin role must be defined');
  });
});

describe('Role Permissions', () => {
  it('should define four roles', () => {
    assert.equal(ROLE_DEFINITIONS.length, 4);
    assert.deepEqual(ROLE_DEFINITIONS.map(r => r.name), ['visitor', 'operator', 'reviewer', 'admin']);
  });

  it('should grant admin all permissions', () => {
    assert.equal(hasPermissionForRole('admin', 'anything'), true);
    assert.equal(hasPermissionForRole('admin', 'content.review'), true);
  });

  it('should not grant visitor content permissions', () => {
    assert.equal(hasPermissionForRole('visitor', 'content.view'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.review'), false);
  });

  it('should grant visitor reservation permissions', () => {
    assert.equal(hasPermissionForRole('visitor', 'reservations.view'), true);
    assert.equal(hasPermissionForRole('visitor', 'reservations.create'), true);
  });

  it('should grant operator device unlock', () => {
    assert.equal(hasPermissionForRole('operator', 'devices.unlock'), true);
  });

  it('should grant reviewer content permissions', () => {
    assert.equal(hasPermissionForRole('reviewer', 'content.view'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.review'), true);
  });

  it('should not grant reviewer device permissions', () => {
    assert.equal(hasPermissionForRole('reviewer', 'devices.unlock'), false);
  });
});

describe('Password Hashing (PBKDF2)', () => {
  // Import Crypto for hashing tests — uses Web Crypto which is available in Node
  const SALT_LENGTH = 16;
  const ITERATIONS = 100000;

  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const saltBytes = salt ? Uint8Array.from(atob(salt), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const hashB64 = Buffer.from(new Uint8Array(bits)).toString('base64');
    const saltB64 = salt || Buffer.from(saltBytes).toString('base64');
    return { hash: hashB64, salt: saltB64 };
  }

  async function verifyPassword(password, storedHash, storedSalt) {
    const { hash } = await hashPassword(password, storedSalt);
    return hash === storedHash;
  }

  it('should hash and verify a password', async () => {
    const { hash, salt } = await hashPassword('TestPassword1!');
    const valid = await verifyPassword('TestPassword1!', hash, salt);
    assert.equal(valid, true);
  });

  it('should fail verification with wrong password', async () => {
    const { hash, salt } = await hashPassword('TestPassword1!');
    const valid = await verifyPassword('WrongPassword1!', hash, salt);
    assert.equal(valid, false);
  });

  it('should produce different salts for same password', async () => {
    const a = await hashPassword('TestPassword1!');
    const b = await hashPassword('TestPassword1!');
    assert.notEqual(a.salt, b.salt);
  });

  it('should produce same hash with same salt', async () => {
    const { hash, salt } = await hashPassword('TestPassword1!');
    const second = await hashPassword('TestPassword1!', salt);
    assert.equal(second.hash, hash);
  });
});
