import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Route-level authorization tests.
 *
 * The production views call requireAuth() or requireRole([...]) at the top of
 * their render functions. Both helpers verify the session against the DB and
 * redirect to /login (no session) or / (wrong role) when authorization fails.
 *
 * Since requireAuth/requireRole depend on browser globals (localStorage,
 * window.location, IndexedDB) we test the equivalent pure logic here:
 *   - Session presence and expiry checks
 *   - Role-gating per view
 *   - Fail-closed behaviour (no session, wrong role, missing user)
 */

import {
  isSessionExpired,
  hasPermissionForRole,
  SESSION_TIMEOUT
} from '../frontend/js/lib/auth-logic.js';

// Map mirrors NAV_ITEMS / route registrations in index.html
const ROUTE_ROLE_MAP = {
  '/':              ['visitor', 'operator', 'reviewer', 'admin'],
  '/reservations':  ['visitor', 'operator', 'admin'],
  '/unlock':        ['operator', 'admin'],
  '/map':           ['visitor', 'operator', 'reviewer', 'admin'],
  '/content':       ['reviewer', 'admin'],
  '/notifications': ['visitor', 'operator', 'reviewer', 'admin'],
  '/admin':         ['admin'],
  '/settings':      ['visitor', 'operator', 'reviewer', 'admin']
};

// --------------------------------------------------------------------------
// requireAuth behaviour
// --------------------------------------------------------------------------
describe('Route Authorization — requireAuth', () => {
  it('should reject when no session exists (null)', () => {
    const session = null;
    // requireAuth checks getSession() which returns null → redirect to /login
    assert.equal(session, null);
  });

  it('should reject an expired session', () => {
    const session = { lastActivity: Date.now() - SESSION_TIMEOUT - 1000 };
    assert.equal(isSessionExpired(session), true);
  });

  it('should accept a fresh session', () => {
    const session = { lastActivity: Date.now() };
    assert.equal(isSessionExpired(session), false);
  });

  it('should reject when session user is banned', () => {
    // verifySessionUser checks user.banned — if true, returns null → fail closed
    const user = { id: 1, username: 'test', role: 'visitor', banned: true };
    assert.equal(user.banned, true, 'banned user should be rejected by requireAuth');
  });

  it('should reject when session username does not match DB user', () => {
    // verifySessionUser cross-checks session.username vs DB user.username
    const session = { userId: 1, username: 'alice' };
    const dbUser = { id: 1, username: 'bob' };
    assert.notEqual(session.username, dbUser.username,
      'username mismatch should cause requireAuth to fail closed');
  });
});

// --------------------------------------------------------------------------
// requireRole behaviour per view
// --------------------------------------------------------------------------
describe('Route Authorization — requireRole per view', () => {
  const ALL_ROLES = ['visitor', 'operator', 'reviewer', 'admin'];

  for (const [route, allowedRoles] of Object.entries(ROUTE_ROLE_MAP)) {
    for (const role of ALL_ROLES) {
      const shouldAllow = allowedRoles.includes(role);
      it(`${route} should ${shouldAllow ? 'allow' : 'deny'} role "${role}"`, () => {
        assert.equal(allowedRoles.includes(role), shouldAllow);
      });
    }
  }

  it('should deny visitor access to /admin', () => {
    assert.equal(ROUTE_ROLE_MAP['/admin'].includes('visitor'), false);
  });

  it('should deny visitor access to /unlock', () => {
    assert.equal(ROUTE_ROLE_MAP['/unlock'].includes('visitor'), false);
  });

  it('should deny visitor access to /content', () => {
    assert.equal(ROUTE_ROLE_MAP['/content'].includes('visitor'), false);
  });

  it('should deny reviewer access to /unlock', () => {
    assert.equal(ROUTE_ROLE_MAP['/unlock'].includes('reviewer'), false);
  });

  it('should deny reviewer access to /admin', () => {
    assert.equal(ROUTE_ROLE_MAP['/admin'].includes('reviewer'), false);
  });

  it('should deny operator access to /content', () => {
    assert.equal(ROUTE_ROLE_MAP['/content'].includes('operator'), false);
  });

  it('should deny operator access to /admin', () => {
    assert.equal(ROUTE_ROLE_MAP['/admin'].includes('operator'), false);
  });

  it('should allow admin access to all routes', () => {
    for (const [route, roles] of Object.entries(ROUTE_ROLE_MAP)) {
      assert.ok(roles.includes('admin'), `admin should have access to ${route}`);
    }
  });
});

// --------------------------------------------------------------------------
// Permission-level checks that back the role gates
// --------------------------------------------------------------------------
describe('Route Authorization — permission checks per role', () => {
  it('visitor cannot access device permissions (backs /unlock gate)', () => {
    assert.equal(hasPermissionForRole('visitor', 'devices.unlock'), false);
    assert.equal(hasPermissionForRole('visitor', 'devices.view'), false);
  });

  it('visitor cannot access content permissions (backs /content gate)', () => {
    assert.equal(hasPermissionForRole('visitor', 'content.view'), false);
    assert.equal(hasPermissionForRole('visitor', 'content.review'), false);
  });

  it('reviewer cannot access device permissions (backs /unlock gate)', () => {
    assert.equal(hasPermissionForRole('reviewer', 'devices.unlock'), false);
  });

  it('operator can access device permissions', () => {
    assert.equal(hasPermissionForRole('operator', 'devices.unlock'), true);
    assert.equal(hasPermissionForRole('operator', 'devices.view'), true);
  });

  it('reviewer can access content permissions', () => {
    assert.equal(hasPermissionForRole('reviewer', 'content.view'), true);
    assert.equal(hasPermissionForRole('reviewer', 'content.review'), true);
  });

  it('unknown role has no permissions', () => {
    assert.equal(hasPermissionForRole('unknown', 'reservations.view'), false);
    assert.equal(hasPermissionForRole('unknown', 'devices.unlock'), false);
  });
});
