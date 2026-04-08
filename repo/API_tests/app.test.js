import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FRONTEND_DIR = resolve(REPO_ROOT, 'frontend');

// Import production logic modules for behavioral tests
import {
  validatePassword, ROLE_DEFINITIONS, hasPermissionForRole,
  isAccountLocked, processFailedLogin, processSuccessfulLogin,
  isSessionExpired, MAX_ATTEMPTS, LOCKOUT_DURATION, SESSION_TIMEOUT
} from '../frontend/js/lib/auth-logic.js';
import { resolveTemplate, TEMPLATES, createNotificationObject, applyDelivery, applyFailedDelivery, MAX_RETRIES } from '../frontend/js/lib/notification-logic.js';
import { scanContent, canTransition, WORKFLOW_STATES, VALID_TRANSITIONS, generateDiff } from '../frontend/js/lib/content-logic.js';
import { calculatePermissionWindow, createPermissionObject, consumeEntry, isWithinPermissionWindow, getPermissionStatusLabel, WINDOW_BEFORE_MS, WINDOW_AFTER_MS } from '../frontend/js/lib/permissions-logic.js';
import { validateUnlockReason, createCommandObject, applyAckTimeout, applyAck, applyRetry, ACK_TIMEOUT, MAX_RETRY_DURATION } from '../frontend/js/lib/device-logic.js';
import { formatAuditTimestamp, createAuditEntry } from '../frontend/js/lib/audit-logic.js';
import { distanceFeet, searchByRadius, searchByZone, pointInPolygon, searchByPolygon, calculateWalkTime, planRoute, getEntryPoints, suggestNearestEntry } from '../frontend/js/lib/map-logic.js';

describe('Application Structure', () => {
  it('should have index.html as entry point', () => {
    assert.ok(existsSync(resolve(FRONTEND_DIR, 'index.html')));
  });

  it('should have all required JS modules', () => {
    for (const mod of ['store.js', 'router.js', 'database.js', 'crypto.js']) {
      assert.ok(existsSync(resolve(FRONTEND_DIR, 'js', mod)), `Missing ${mod}`);
    }
  });

  it('should have all view files', () => {
    const views = ['dashboard.js', 'login.js', 'reservations.js', 'unlock.js', 'map.js', 'content.js', 'notifications.js', 'admin.js', 'settings.js'];
    for (const view of views) {
      assert.ok(existsSync(resolve(FRONTEND_DIR, 'js', 'views', view)), `Missing view ${view}`);
    }
  });

  it('should have all service files', () => {
    for (const svc of ['auth-service.js', 'audit.js', 'permissions.js', 'device.js', 'notifications.js', 'map.js', 'cms.js', 'importexport.js', 'rate-limits.js']) {
      assert.ok(existsSync(resolve(FRONTEND_DIR, 'js', 'services', svc)), `Missing service ${svc}`);
    }
  });

  it('should have all lib modules', () => {
    for (const lib of ['auth-logic.js', 'audit-logic.js', 'permissions-logic.js', 'notification-logic.js', 'map-logic.js', 'device-logic.js', 'content-logic.js']) {
      assert.ok(existsSync(resolve(FRONTEND_DIR, 'js', 'lib', lib)), `Missing lib ${lib}`);
    }
  });

  it('should have all component files', () => {
    for (const comp of ['modal.js', 'drawer.js', 'table.js', 'notifications.js', 'session-warning.js']) {
      assert.ok(existsSync(resolve(FRONTEND_DIR, 'js', 'components', comp)), `Missing component ${comp}`);
    }
  });
});

describe('Default Admin Account', () => {
  it('should use a first-run setup flow instead of hardcoded credentials', () => {
    const authLogic = readFileSync(resolve(FRONTEND_DIR, 'js', 'lib', 'auth-logic.js'), 'utf-8');
    assert.ok(!authLogic.includes('DEFAULT_ADMIN_PASSWORD'), 'auth-logic.js must not contain hardcoded admin password');
    assert.ok(!authLogic.includes('Admin@HarborGate'), 'auth-logic.js must not contain hardcoded admin credentials');
  });

  it('should show setup screen via needsSetup() in index.html startup', () => {
    const html = readFileSync(resolve(FRONTEND_DIR, 'index.html'), 'utf-8');
    assert.ok(html.includes('needsSetup'), 'index.html must call needsSetup()');
    assert.ok(html.includes('setupAdmin'), 'index.html must call setupAdmin()');
  });
});

describe('Registration Only Creates Visitor Accounts', () => {
  it('should not expose role selection in registration form', () => {
    const loginView = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'login.js'), 'utf-8');
    // The form should have a hidden input with value="visitor", not a select with operator/reviewer
    assert.ok(!loginView.includes('<option value="operator">'), 'Registration form must not offer operator role');
    assert.ok(!loginView.includes('<option value="reviewer">'), 'Registration form must not offer reviewer role');
    assert.ok(!loginView.includes('<option value="admin">'), 'Registration form must not offer admin role');
  });

  it('should hardcode visitor role in registration', () => {
    const loginView = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'login.js'), 'utf-8');
    assert.ok(loginView.includes('value="visitor"'), 'Registration form must default to visitor');
  });

  it('should enforce visitor role in auth service register()', () => {
    const authService = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'auth-service.js'), 'utf-8');
    // register() should force visitor role regardless of parameter
    assert.ok(authService.includes("const safeRole = 'visitor'"), 'register() must enforce visitor role');
  });
});

describe('Content Route is Role-Protected', () => {
  it('should use requireRole for content view', () => {
    const contentView = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'content.js'), 'utf-8');
    assert.ok(contentView.includes("requireRole(['admin', 'reviewer'])"), 'Content view must check for admin/reviewer role');
    assert.ok(!contentView.includes('requireAuth()'), 'Content view should not use requireAuth() alone');
  });

  it('should check role before content mutations', () => {
    const contentView = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'content.js'), 'utf-8');
    // Count the number of role checks for mutation actions
    const roleChecks = (contentView.match(/hasRole\(\['admin', 'reviewer'\]\)/g) || []).length;
    assert.ok(roleChecks >= 5, `Expected at least 5 role checks for mutations, found ${roleChecks}`);
  });

  it('visitors should not have content permissions', () => {
    assert.equal(hasPermissionForRole('visitor', 'content.view'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.review'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.moderate'), false);
  });

  it('reviewers should have content permissions', () => {
    assert.equal(hasPermissionForRole('reviewer', 'content.view'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.review'), true);
  });
});

describe('Encryption at Rest', () => {
  it('should define encrypted stores in database.js', () => {
    const db = readFileSync(resolve(FRONTEND_DIR, 'js', 'database.js'), 'utf-8');
    assert.ok(db.includes('ENCRYPTED_STORES'), 'database.js must define ENCRYPTED_STORES');
    // users is INTENTIONALLY excluded from ENCRYPTED_STORES to prevent pre-auth lockout
    assert.ok(
      db.includes("intentionally excluded") || !db.includes("'users',           // password"),
      'users must be excluded from ENCRYPTED_STORES to allow pre-auth login reads'
    );
    assert.ok(db.includes("'reservations'"), 'reservations must be in ENCRYPTED_STORES');
    assert.ok(db.includes("'rate_limits'"), 'rate_limits must be in ENCRYPTED_STORES');
  });

  it('should have setEncryptionKey and clearEncryptionKey exports', () => {
    const db = readFileSync(resolve(FRONTEND_DIR, 'js', 'database.js'), 'utf-8');
    assert.ok(db.includes('setEncryptionKey'), 'database.js must export setEncryptionKey');
    assert.ok(db.includes('clearEncryptionKey'), 'database.js must export clearEncryptionKey');
  });

  it('should derive encryption key on login via KEK/DEK wrapping', () => {
    const auth = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'auth-service.js'), 'utf-8');
    assert.ok(auth.includes('deriveKEK'), 'auth-service.js must call deriveKEK on login');
    assert.ok(auth.includes('unwrapDEK'), 'auth-service.js must call unwrapDEK to recover shared data key');
    assert.ok(auth.includes('setEncryptionKey'), 'auth-service.js must call setEncryptionKey after unwrapping DEK');
  });

  it('should clear encryption key on logout', () => {
    const auth = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'auth-service.js'), 'utf-8');
    assert.ok(auth.includes('clearEncryptionKey'), 'auth-service.js must call clearEncryptionKey on logout');
  });

  it('should encrypt records before writing to IndexedDB', () => {
    const db = readFileSync(resolve(FRONTEND_DIR, 'js', 'database.js'), 'utf-8');
    assert.ok(db.includes('encryptIfNeeded'), 'database.js add/put must call encryptIfNeeded');
    assert.ok(db.includes('decryptIfNeeded'), 'database.js get must call decryptIfNeeded');
  });

  it('should have KEK/DEK key management in crypto.js', () => {
    const crypto = readFileSync(resolve(FRONTEND_DIR, 'js', 'crypto.js'), 'utf-8');
    assert.ok(crypto.includes('deriveKEK'), 'crypto.js must export deriveKEK');
    assert.ok(crypto.includes('generateDEK'), 'crypto.js must export generateDEK');
    assert.ok(crypto.includes('wrapDEK'), 'crypto.js must export wrapDEK');
    assert.ok(crypto.includes('unwrapDEK'), 'crypto.js must export unwrapDEK');
    assert.ok(crypto.includes('encryptRecord'), 'crypto.js must export encryptRecord');
    assert.ok(crypto.includes('decryptRecord'), 'crypto.js must export decryptRecord');
  });

  it('should never persist the encryption key', () => {
    const db = readFileSync(resolve(FRONTEND_DIR, 'js', 'database.js'), 'utf-8');
    assert.ok(db.includes('never persisted'), 'Encryption key must be documented as never persisted');
    assert.ok(!db.includes('localStorage.setItem') || !db.includes('encryptionKey'), 'Must not store key in localStorage');
  });
});

describe('Mandatory Backup Encryption', () => {
  it('should not allow unencrypted export', () => {
    const ie = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'importexport.js'), 'utf-8');
    assert.ok(ie.includes('Plaintext export is not permitted'), 'importexport.js must block plaintext export');
  });

  it('should not allow unencrypted import', () => {
    const ie = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'importexport.js'), 'utf-8');
    assert.ok(ie.includes('Plaintext import is not permitted') || ie.includes('Only encrypted backups are accepted'), 'importexport.js must reject plaintext import');
  });

  it('settings UI should label backup password as required', () => {
    const settings = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'settings.js'), 'utf-8');
    assert.ok(!settings.includes('Leave empty for unencrypted'), 'settings.js must not suggest unencrypted export is possible');
  });
});

describe('Rate Limits Service', () => {
  it('should have rate-limits.js service', () => {
    assert.ok(existsSync(resolve(FRONTEND_DIR, 'js', 'services', 'rate-limits.js')));
  });

  it('should export required functions', () => {
    const rl = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'rate-limits.js'), 'utf-8');
    assert.ok(rl.includes('export async function getRateLimits'), 'must export getRateLimits');
    assert.ok(rl.includes('export async function createRateLimit'), 'must export createRateLimit');
    assert.ok(rl.includes('export async function updateRateLimit'), 'must export updateRateLimit');
    assert.ok(rl.includes('export async function deleteRateLimit'), 'must export deleteRateLimit');
    assert.ok(rl.includes('export async function checkRateLimit'), 'must export checkRateLimit');
  });

  it('admin view should include Rate Limits tab', () => {
    const admin = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'admin.js'), 'utf-8');
    assert.ok(admin.includes('rate-limits'), 'admin.js must include the Rate Limits tab');
    assert.ok(admin.includes('createRateLimit'), 'admin.js must call createRateLimit');
  });
});

describe('Permission Consumption Authorization', () => {
  it('consumeEntry must accept an actor parameter', () => {
    const perms = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'permissions.js'), 'utf-8');
    assert.ok(perms.includes('actor = null'), 'consumeEntry must accept actor parameter');
    assert.ok(perms.includes('Not authorized to consume'), 'consumeEntry must enforce authorization');
  });

  it('unlock view must consume permission only after acknowledged unlock', () => {
    const unlock = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'unlock.js'), 'utf-8');
    // The consume call must come AFTER the sendUnlockCommand result check
    const consumeIdx = unlock.indexOf('consumeEntry(activePermission.id, user)');
    const sendIdx    = unlock.indexOf('sendUnlockCommand(');
    const resultIdx  = unlock.indexOf("result.status === 'acknowledged'");
    assert.ok(consumeIdx > sendIdx, 'consumeEntry must be called after sendUnlockCommand');
    assert.ok(consumeIdx > resultIdx, 'consumeEntry must be inside the acknowledged-result block');
  });
});

describe('Docker Configuration', () => {
  let compose;

  before(() => {
    compose = readFileSync(resolve(REPO_ROOT, 'docker-compose.yml'), 'utf-8');
  });

  it('should use nginx:alpine image', () => {
    assert.ok(compose.includes('nginx:alpine'));
  });

  it('should expose port 8080', () => {
    assert.ok(compose.includes('8080'));
  });

  it('should mount frontend directory', () => {
    assert.ok(compose.includes('./frontend:/usr/share/nginx/html'));
  });
});

describe('Role System Behavioral Tests', () => {
  it('should define exactly 4 roles', () => {
    assert.equal(ROLE_DEFINITIONS.length, 4);
  });

  it('admin should have wildcard permissions', () => {
    const admin = ROLE_DEFINITIONS.find(r => r.name === 'admin');
    assert.ok(admin.permissions.includes('*'));
  });

  it('visitor cannot access devices or content', () => {
    assert.equal(hasPermissionForRole('visitor', 'devices.unlock'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.view'), false);
  });

  it('operator can access devices but not content moderation', () => {
    assert.equal(hasPermissionForRole('operator', 'devices.unlock'), true);
    assert.equal(hasPermissionForRole('operator', 'content.moderate'), false);
  });

  it('non-admin cannot assign roles (only admin console does this)', () => {
    // Verify the admin view requires admin role
    const adminView = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'admin.js'), 'utf-8');
    assert.ok(adminView.includes("requireRole(['admin'])"), 'Admin console must require admin role');
  });
});

describe('README Accuracy', () => {
  let readme;

  before(() => {
    readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf-8');
  });

  it('should document the first-run setup flow', () => {
    assert.ok(
      readme.includes('First-Run Setup') || readme.includes('first-run setup') || readme.includes('setup screen') || readme.includes('Setup'),
      'README must mention first-run setup'
    );
    assert.ok(!readme.includes('Admin@HarborGate'), 'README must not contain hardcoded admin password');
    assert.ok(!readme.includes('Default Admin Account') || readme.includes('no hardcoded'), 'README must not document hardcoded admin credentials');
  });

  it('should mention changing password after first login', () => {
    assert.ok(readme.includes('Change') || readme.includes('change'), 'README must advise changing default password');
  });

  it('should describe self-registration as visitor-only', () => {
    assert.ok(readme.includes('visitor'), 'README must mention visitor-only registration');
  });

  it('should document encryption at rest', () => {
    assert.ok(readme.includes('Encryption at Rest') || readme.includes('encryption at rest') || readme.includes('encrypted'), 'README must mention encryption at rest');
  });
});

describe('Rate-Limit Enforcement — Call Sites', () => {
  it('login() must call checkRateLimit', () => {
    const auth = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'auth-service.js'), 'utf-8');
    assert.ok(auth.includes("checkRateLimit('user'"), 'auth-service.js login must check user-scoped rate limit');
    assert.ok(auth.includes("checkRateLimit('global'"), 'auth-service.js login must check global rate limit');
    assert.ok(auth.includes('Too many login attempts'), 'auth-service.js must surface rate-limit error');
  });

  it('unlock submit must call checkRateLimit', () => {
    const unlock = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'unlock.js'), 'utf-8');
    assert.ok(unlock.includes("checkRateLimit('device'"), 'unlock.js must check device-scoped rate limit');
    assert.ok(unlock.includes("checkRateLimit('global'"), 'unlock.js must check global rate limit');
    assert.ok(unlock.includes('rate limit'), 'unlock.js must surface rate-limit error');
  });

  it('reservation creation must call checkRateLimit', () => {
    const res = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'reservations.js'), 'utf-8');
    assert.ok(res.includes("checkRateLimit('user'"), 'reservations.js must check user-scoped rate limit');
    assert.ok(res.includes('Reservation rate limit'), 'reservations.js must surface rate-limit error');
  });

  it('content publish (approve) must call checkRateLimit', () => {
    const content = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'content.js'), 'utf-8');
    assert.ok(content.includes("checkRateLimit('user'"), 'content.js must check user-scoped rate limit for publish');
    assert.ok(content.includes('content_publish'), 'content.js must use content_publish action in rate limit check');
  });
});

describe('Unlock Confirmation Modal', () => {
  it('unlock flow must show a confirmation modal before dispatching command', () => {
    const unlock = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'unlock.js'), 'utf-8');
    assert.ok(unlock.includes('showModal'), 'unlock.js must call showModal for confirmation');
    assert.ok(unlock.includes('Confirm Remote Unlock'), 'unlock.js must show a "Confirm Remote Unlock" modal');
    assert.ok(unlock.includes('confirm-unlock-yes'), 'unlock.js must have a final confirm button');
    // Ensure sendUnlockCommand is inside the modal confirmation handler, not directly in the drawer submit
    const modalYesIdx   = unlock.indexOf('confirm-unlock-yes');
    const sendIdx       = unlock.indexOf('sendUnlockCommand(');
    assert.ok(sendIdx > modalYesIdx, 'sendUnlockCommand must be called after user confirms the modal');
  });
});

describe('Service-Layer Authorization', () => {
  it('getPermissionsForReservation must accept an actor parameter', () => {
    const perms = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'permissions.js'), 'utf-8');
    assert.ok(perms.includes('actor = null'), 'getPermissionsForReservation must accept actor');
    assert.ok(perms.includes('isOwner') && perms.includes('isPrivileged'), 'getPermissionsForReservation must check ownership/role');
  });

  it('reservations must be loaded by userId index for non-privileged users', () => {
    const res = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'reservations.js'), 'utf-8');
    assert.ok(res.includes("getByIndex('reservations', 'userId'"), 'reservations.js must load by userId index for isolation');
  });

  it('approve/deny handlers must enforce canManage before mutating', () => {
    const res = readFileSync(resolve(FRONTEND_DIR, 'js', 'views', 'reservations.js'), 'utf-8');
    assert.ok(res.includes('Not authorized to approve') && res.includes('Not authorized to deny'),
      'reservations.js must enforce canManage on approve/deny actions');
  });
});

// ============================================================================
// BEHAVIORAL INTEGRATION TESTS — exercise pure logic modules end-to-end
// ============================================================================

describe('Auth Logic — Password Policy Integration', () => {
  it('should reject passwords shorter than 12 characters', () => {
    const result = validatePassword('Short1!abc');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('12 characters')));
  });

  it('should reject passwords missing uppercase', () => {
    const result = validatePassword('alllowercase1!');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('uppercase')));
  });

  it('should reject passwords missing symbols', () => {
    const result = validatePassword('NoSymbolHere1A');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('symbol')));
  });

  it('should accept a compliant password', () => {
    const result = validatePassword('StrongP@ss12345');
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should accumulate all failing rules', () => {
    const result = validatePassword('a');
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3);
  });
});

describe('Auth Logic — Account Lockout Integration', () => {
  it('should lock account after 5 failed attempts', () => {
    const user = { failedAttempts: 0, lockedUntil: null };
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      const r = processFailedLogin(user);
      assert.equal(r.locked, false);
    }
    const final = processFailedLogin(user);
    assert.equal(final.locked, true);
    assert.ok(user.lockedUntil > Date.now());
  });

  it('should report locked state during lockout window', () => {
    const now = Date.now();
    const user = { lockedUntil: now + 60000 };
    assert.equal(isAccountLocked(user, now), true);
  });

  it('should report unlocked after lockout expires', () => {
    const now = Date.now();
    const user = { lockedUntil: now - 1000 };
    assert.equal(isAccountLocked(user, now), false);
  });

  it('successful login should reset failed attempts and lockout', () => {
    const user = { failedAttempts: 3, lockedUntil: Date.now() + 60000 };
    processSuccessfulLogin(user);
    assert.equal(user.failedAttempts, 0);
    assert.equal(user.lockedUntil, null);
  });
});

describe('Auth Logic — Session Expiry Integration', () => {
  it('should not expire a fresh session', () => {
    const session = { lastActivity: Date.now() };
    assert.equal(isSessionExpired(session), false);
  });

  it('should expire a session after 30 minutes of inactivity', () => {
    const session = { lastActivity: Date.now() - SESSION_TIMEOUT - 1000 };
    assert.equal(isSessionExpired(session), true);
  });

  it('should not expire a session at exactly the timeout boundary', () => {
    const now = Date.now();
    const session = { lastActivity: now - SESSION_TIMEOUT + 1000 };
    assert.equal(isSessionExpired(session, now), false);
  });
});

describe('Permissions Logic — Window & Consumption Integration', () => {
  it('should create 15-min-before / 30-min-after permission window', () => {
    const startTime = Date.now() + 3600000;
    const window = calculatePermissionWindow(startTime);
    assert.equal(window.windowStart, startTime - WINDOW_BEFORE_MS);
    assert.equal(window.windowEnd, startTime + WINDOW_AFTER_MS);
  });

  it('should create single-use permission with maxEntries=1', () => {
    const perm = createPermissionObject(Date.now(), 'single-use');
    assert.equal(perm.maxEntries, 1);
    assert.equal(perm.usedEntries, 0);
    assert.equal(perm.status, 'active');
  });

  it('should create multi-use permission with maxEntries=5', () => {
    const perm = createPermissionObject(Date.now(), 'multi-use');
    assert.equal(perm.maxEntries, 5);
  });

  it('should consume a single-use permission and mark as consumed', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');
    const result = consumeEntry(perm, now);
    assert.equal(result.success, true);
    assert.equal(perm.status, 'consumed');
    assert.equal(perm.usedEntries, 1);
  });

  it('should reject consumption of already consumed permission', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');
    consumeEntry(perm, now);
    const result = consumeEntry(perm, now);
    assert.equal(result.success, false);
    assert.ok(result.error.includes('consumed'));
  });

  it('should allow multiple consumptions on multi-use until exhausted', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'multi-use');
    for (let i = 0; i < 4; i++) {
      const r = consumeEntry(perm, now);
      assert.equal(r.success, true);
      assert.equal(perm.status, 'active');
    }
    const last = consumeEntry(perm, now);
    assert.equal(last.success, true);
    assert.equal(perm.status, 'consumed');
  });

  it('should reject consumption outside time window', () => {
    const farFuture = Date.now() + 999999999;
    const perm = createPermissionObject(farFuture, 'single-use');
    const result = consumeEntry(perm, Date.now());
    assert.equal(result.success, false);
    assert.ok(result.error.includes('window'));
  });

  it('should return correct status labels', () => {
    const now = Date.now();
    const active = createPermissionObject(now, 'single-use');
    assert.equal(getPermissionStatusLabel(active, now), 'Active');

    const consumed = createPermissionObject(now, 'single-use');
    consumeEntry(consumed, now);
    assert.equal(getPermissionStatusLabel(consumed, now), 'Consumed');

    const future = createPermissionObject(now + 999999999, 'single-use');
    assert.equal(getPermissionStatusLabel(future, now), 'Pending');
  });
});

describe('Content Logic — Workflow & Compliance Integration', () => {
  it('should enforce valid workflow transitions', () => {
    assert.equal(canTransition('draft', 'review'), true);
    assert.equal(canTransition('review', 'published'), true);
    assert.equal(canTransition('review', 'draft'), true);
    assert.equal(canTransition('published', 'archived'), true);
    assert.equal(canTransition('published', 'draft'), true);
    assert.equal(canTransition('archived', 'draft'), true);
  });

  it('should reject invalid workflow transitions', () => {
    assert.equal(canTransition('draft', 'published'), false);
    assert.equal(canTransition('draft', 'archived'), false);
    assert.equal(canTransition('review', 'archived'), false);
    assert.equal(canTransition('archived', 'published'), false);
  });

  it('should detect PII violations in content', () => {
    const violations = scanContent('SSN: 123-45-6789');
    assert.ok(violations.length > 0);
    assert.ok(violations.some(v => v.ruleId === 'pii'));
  });

  it('should detect restricted words in content', () => {
    const violations = scanContent('This content is banned and restricted');
    assert.ok(violations.some(v => v.ruleId === 'profanity'));
  });

  it('should detect external URLs in content', () => {
    const violations = scanContent('Visit https://example.com for details');
    assert.ok(violations.some(v => v.ruleId === 'url'));
  });

  it('should return no violations for clean content', () => {
    const violations = scanContent('This is a perfectly clean paragraph.');
    assert.equal(violations.length, 0);
  });

  it('should generate line-by-line diff between two texts', () => {
    const diff = generateDiff('line1\nline2\nline3', 'line1\nmodified\nline3');
    const removed = diff.filter(d => d.type === 'removed');
    const added = diff.filter(d => d.type === 'added');
    assert.ok(removed.some(d => d.content === 'line2'));
    assert.ok(added.some(d => d.content === 'modified'));
  });
});

describe('Device Logic — Command Lifecycle Integration', () => {
  it('should validate unlock reason minimum length', () => {
    assert.equal(validateUnlockReason('short').valid, false);
    assert.equal(validateUnlockReason('This is a valid reason for unlock').valid, true);
  });

  it('should create a pending command object', () => {
    const cmd = createCommandObject(1, 'Test unlock reason', 'admin');
    assert.equal(cmd.deviceId, 1);
    assert.equal(cmd.status, 'pending');
    assert.equal(cmd.retryCount, 0);
    assert.equal(cmd.type, 'unlock');
  });

  it('should transition command to queued on ACK timeout', () => {
    const cmd = createCommandObject(1, 'Test reason', 'admin');
    applyAckTimeout(cmd);
    assert.equal(cmd.status, 'queued');
  });

  it('should transition command to acknowledged on ACK', () => {
    const cmd = createCommandObject(1, 'Test reason', 'admin');
    applyAck(cmd);
    assert.equal(cmd.status, 'acknowledged');
    assert.ok(cmd.ackAt > 0);
  });

  it('should retry and succeed when device comes online', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Test reason', 'admin');
    cmd.createdAt = now;
    applyRetry(cmd, true, now + 10000);
    assert.equal(cmd.status, 'acknowledged');
    assert.equal(cmd.retryCount, 1);
  });

  it('should fail command after max retry duration exceeded', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Test reason', 'admin');
    cmd.createdAt = now - MAX_RETRY_DURATION - 1000;
    applyRetry(cmd, false, now);
    assert.equal(cmd.status, 'failed');
  });

  it('should increment retry count on each failed retry', () => {
    const now = Date.now();
    const cmd = createCommandObject(1, 'Test reason', 'admin');
    cmd.createdAt = now;
    applyRetry(cmd, false, now + 10000);
    assert.equal(cmd.retryCount, 1);
    applyRetry(cmd, false, now + 20000);
    assert.equal(cmd.retryCount, 2);
  });
});

describe('Notification Logic — Template & Retry Integration', () => {
  it('should resolve all standard templates without error', () => {
    const vars = { reservationId: '1', zone: 'Lobby', doorName: 'Main', contentTitle: 'Doc', itemDescription: 'Badge', details: 'missing', username: 'user1', reason: 'policy' };
    for (const templateId of Object.keys(TEMPLATES)) {
      const msg = resolveTemplate(templateId, vars);
      assert.ok(typeof msg === 'string' && msg.length > 0, `Template ${templateId} failed to resolve`);
      assert.ok(!msg.includes('{'), `Template ${templateId} has unresolved placeholders: ${msg}`);
    }
  });

  it('should create notification with correct initial state', () => {
    const notif = createNotificationObject({
      userId: 42,
      templateId: 'reservation_approved',
      variables: { reservationId: '7' },
      type: 'success'
    });
    assert.equal(notif.userId, 42);
    assert.equal(notif.status, 'pending');
    assert.equal(notif.retryCount, 0);
    assert.equal(notif.type, 'success');
    assert.ok(notif.message.includes('7'));
  });

  it('should mark notification as delivered', () => {
    const notif = createNotificationObject({ templateId: 'account_locked', variables: {} });
    applyDelivery(notif);
    assert.equal(notif.status, 'delivered');
    assert.ok(notif.deliveredAt > 0);
  });

  it('should keep pending status when retries remain', () => {
    const notif = createNotificationObject({ templateId: 'account_locked', variables: {} });
    applyFailedDelivery(notif);
    assert.equal(notif.retryCount, 1);
    assert.equal(notif.status, 'pending');
  });

  it('should mark as failed only after MAX_RETRIES exhausted', () => {
    const notif = createNotificationObject({ templateId: 'account_locked', variables: {} });
    for (let i = 0; i < MAX_RETRIES; i++) {
      applyFailedDelivery(notif);
    }
    assert.equal(notif.status, 'failed');
    assert.equal(notif.retryCount, MAX_RETRIES);
    assert.ok(notif.failedAt > 0);
  });
});

describe('Audit Logic — Entry Creation Integration', () => {
  it('should create audit entry with all required fields', () => {
    const entry = createAuditEntry('user_login', 'admin', { userId: 1 }, null, null, 'admin');
    assert.equal(entry.action, 'user_login');
    assert.equal(entry.actor, 'admin');
    assert.equal(entry.actorRole, 'admin');
    assert.ok(entry.timestamp > 0);
    assert.ok(entry.formattedTimestamp.length > 0);
    assert.deepStrictEqual(entry.details, { userId: 1 });
  });

  it('should deep-clone before/after snapshots', () => {
    const before = { status: 'pending' };
    const after = { status: 'approved' };
    const entry = createAuditEntry('reservation_approved', 'op', {}, before, after, 'operator');
    before.status = 'mutated';
    assert.equal(entry.before.status, 'pending');
    assert.equal(entry.after.status, 'approved');
  });

  it('should format timestamp as MM/DD/YYYY 12-hour', () => {
    const ts = new Date('2026-04-02T14:30:00').getTime();
    const formatted = formatAuditTimestamp(ts);
    assert.ok(/^\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2}:\d{2} (AM|PM)$/.test(formatted), `Bad format: ${formatted}`);
    assert.ok(formatted.includes('2026'));
    assert.ok(formatted.includes('PM'));
  });

  it('should default actor to system when null', () => {
    const entry = createAuditEntry('test_action', null, {});
    assert.equal(entry.actor, 'system');
  });
});

describe('Map Logic — Spatial Operations Integration', () => {
  it('should calculate correct distance between two points', () => {
    const d = distanceFeet({ x: 0, y: 0 }, { x: 300, y: 400 });
    assert.equal(d, 500);
  });

  it('should find POIs within radius', () => {
    const pois = [
      { id: 1, x: 100, y: 100 },
      { id: 2, x: 5000, y: 5000 },
      { id: 3, x: 150, y: 150 }
    ];
    const results = searchByRadius(pois, { x: 0, y: 0 }, 250);
    assert.equal(results.length, 2);
    assert.ok(results.some(p => p.id === 1));
    assert.ok(results.some(p => p.id === 3));
  });

  it('should filter POIs by zone', () => {
    const pois = [
      { id: 1, zone: 'lobby' },
      { id: 2, zone: 'dock' },
      { id: 3, zone: 'lobby' }
    ];
    const results = searchByZone(pois, 'lobby');
    assert.equal(results.length, 2);
  });

  it('should detect point inside polygon', () => {
    const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    assert.equal(pointInPolygon({ x: 50, y: 50 }, polygon), true);
    assert.equal(pointInPolygon({ x: 200, y: 200 }, polygon), false);
  });

  it('should search POIs within polygon geofence', () => {
    const pois = [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 200, y: 200 },
      { id: 3, x: 75, y: 75 }
    ];
    const polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const results = searchByPolygon(pois, polygon);
    assert.equal(results.length, 2);
  });

  it('should calculate walk time from distance and speed', () => {
    const time = calculateWalkTime(5280, 3); // 1 mile at 3 mph = 20 min
    assert.equal(time, 20);
  });

  it('should plan a route with correct total distance and segments', () => {
    const route = planRoute({ x: 0, y: 0 }, { x: 300, y: 400 });
    assert.equal(route.totalDistanceFeet, 500);
    assert.equal(route.segments.length, 1);
    assert.equal(route.segments[0].distanceFeet, 500);
  });

  it('should plan a multi-waypoint route', () => {
    const route = planRoute({ x: 0, y: 0 }, { x: 600, y: 0 }, [{ x: 300, y: 0 }]);
    assert.equal(route.segments.length, 2);
    assert.equal(route.totalDistanceFeet, 600);
  });

  it('should suggest nearest entry point', () => {
    const pois = [
      { id: 1, type: 'entry', x: 100, y: 0 },
      { id: 2, type: 'entry', x: 500, y: 0 },
      { id: 3, type: 'general', x: 10, y: 0 }
    ];
    const result = suggestNearestEntry(pois, { x: 0, y: 0 });
    assert.equal(result.poi.id, 1);
    assert.equal(result.distanceFeet, 100);
  });

  it('should return null when no entry points exist', () => {
    const pois = [{ id: 1, type: 'general', x: 0, y: 0 }];
    assert.equal(suggestNearestEntry(pois, { x: 0, y: 0 }), null);
  });
});

describe('Cross-Module Integration — Permission Lifecycle', () => {
  it('should enforce full lifecycle: create → consume → reject re-consume', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'single-use');

    assert.equal(getPermissionStatusLabel(perm, now), 'Active');
    assert.equal(isWithinPermissionWindow(perm, now), true);

    const r1 = consumeEntry(perm, now);
    assert.equal(r1.success, true);
    assert.equal(getPermissionStatusLabel(perm, now), 'Consumed');

    const r2 = consumeEntry(perm, now);
    assert.equal(r2.success, false);
  });

  it('should enforce full lifecycle for multi-use: 5 entries then reject', () => {
    const now = Date.now();
    const perm = createPermissionObject(now, 'multi-use');

    for (let i = 0; i < 5; i++) {
      assert.equal(consumeEntry(perm, now).success, true);
    }
    assert.equal(perm.status, 'consumed');
    assert.equal(consumeEntry(perm, now).success, false);
  });
});

describe('Cross-Module Integration — Role Permission Matrix', () => {
  it('should enforce complete permission matrix across all roles', () => {
    // Visitor: limited access
    assert.equal(hasPermissionForRole('visitor', 'reservations.view'), true);
    assert.equal(hasPermissionForRole('visitor', 'reservations.create'), true);
    assert.equal(hasPermissionForRole('visitor', 'reservations.manage'), false);
    assert.equal(hasPermissionForRole('visitor', 'devices.unlock'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.view'), false);

    // Operator: device access, no content
    assert.equal(hasPermissionForRole('operator', 'devices.unlock'), true);
    assert.equal(hasPermissionForRole('operator', 'devices.view'), true);
    assert.equal(hasPermissionForRole('operator', 'reservations.manage'), true);
    assert.equal(hasPermissionForRole('operator', 'content.review'), false);

    // Reviewer: content access, no devices
    assert.equal(hasPermissionForRole('reviewer', 'content.view'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.review'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.moderate'), true);
    assert.equal(hasPermissionForRole('reviewer', 'devices.unlock'), false);

    // Admin: everything
    assert.equal(hasPermissionForRole('admin', 'reservations.manage'), true);
    assert.equal(hasPermissionForRole('admin', 'devices.unlock'), true);
    assert.equal(hasPermissionForRole('admin', 'content.moderate'), true);
    assert.equal(hasPermissionForRole('admin', 'anything.at.all'), true);
  });

  it('should return false for unknown roles', () => {
    assert.equal(hasPermissionForRole('unknown_role', 'reservations.view'), false);
  });
});

describe('Cross-Module Integration — Audit + Auth Lockout Flow', () => {
  it('should produce audit-ready entries through a lockout sequence', () => {
    const user = { failedAttempts: 0, lockedUntil: null };

    // Simulate 5 failed logins
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      processFailedLogin(user);
    }
    assert.ok(user.lockedUntil > Date.now());

    // Create audit entry for lockout
    const entry = createAuditEntry('account_locked', 'testuser', { reason: 'max_failed_attempts' }, null, null, 'system');
    assert.equal(entry.action, 'account_locked');
    assert.equal(entry.details.reason, 'max_failed_attempts');
    assert.ok(entry.formattedTimestamp.includes('/'));

    // Verify lockout state
    assert.equal(isAccountLocked(user), true);

    // Simulate time passing beyond lockout
    user.lockedUntil = Date.now() - 1;
    assert.equal(isAccountLocked(user), false);

    // Successful login resets
    processSuccessfulLogin(user);
    assert.equal(user.failedAttempts, 0);
    assert.equal(user.lockedUntil, null);
  });
});
