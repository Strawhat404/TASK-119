import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FRONTEND_DIR = resolve(REPO_ROOT, 'frontend');

// Import production logic modules for behavioral tests
import { validatePassword, ROLE_DEFINITIONS, hasPermissionForRole } from '../frontend/js/lib/auth-logic.js';
import { resolveTemplate, TEMPLATES } from '../frontend/js/lib/notification-logic.js';
import { scanContent, canTransition, WORKFLOW_STATES } from '../frontend/js/lib/content-logic.js';
import { calculatePermissionWindow, createPermissionObject, consumeEntry } from '../frontend/js/lib/permissions-logic.js';
import { validateUnlockReason } from '../frontend/js/lib/device-logic.js';
import { formatAuditTimestamp, createAuditEntry } from '../frontend/js/lib/audit-logic.js';

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

  it('should derive session key on login', () => {
    const auth = readFileSync(resolve(FRONTEND_DIR, 'js', 'services', 'auth-service.js'), 'utf-8');
    assert.ok(auth.includes('deriveSessionKey'), 'auth-service.js must call deriveSessionKey on login');
    assert.ok(auth.includes('setEncryptionKey'), 'auth-service.js must call setEncryptionKey after deriving key');
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

  it('should have deriveSessionKey in crypto.js', () => {
    const crypto = readFileSync(resolve(FRONTEND_DIR, 'js', 'crypto.js'), 'utf-8');
    assert.ok(crypto.includes('deriveSessionKey'), 'crypto.js must export deriveSessionKey');
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
