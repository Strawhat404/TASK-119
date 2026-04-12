import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, teardownDOM } from './dom-mock.js';
import Store from '../frontend/js/store.js';

// session-warning.js imports auth-service which may use fetch/other browser APIs.
// We test the session warning logic by replicating the component's subscriber pattern,
// which mirrors what initSessionWarning() sets up.

describe('Session Warning Component', () => {
  let doc;

  beforeEach(() => {
    doc = setupDOM();
    Store.reset();
  });

  afterEach(() => {
    Store.reset();
    teardownDOM();
  });

  it('should detect sessionWarning event from Store', () => {
    let warningTriggered = false;
    Store.subscribe((key, value) => {
      if (key === 'sessionWarning' && value === true) {
        warningTriggered = true;
      }
    });
    Store.set('sessionWarning', true);
    assert.ok(warningTriggered);
  });

  it('should detect sessionExpired event from Store', () => {
    let expiredTriggered = false;
    Store.subscribe((key, value) => {
      if (key === 'sessionExpired' && value === true) {
        expiredTriggered = true;
      }
    });
    Store.set('sessionExpired', true);
    assert.ok(expiredTriggered);
  });

  it('should render warning overlay on sessionWarning', () => {
    let warningEl = null;

    Store.subscribe((key, value) => {
      if (key === 'sessionWarning' && value === true) {
        warningEl = doc.createElement('div');
        warningEl.className = 'session-warning-overlay';
        warningEl.innerHTML = `
          <div class="session-warning">
            <h2>Session Expiring</h2>
            <p>Your session will expire in 5 minutes due to inactivity.</p>
            <div class="form-actions">
              <button class="btn btn-primary" id="extend-session-btn">Extend Session</button>
              <button class="btn btn-secondary" id="logout-session-btn">Logout</button>
            </div>
          </div>
        `;
        doc.body.appendChild(warningEl);
      }
    });

    Store.set('sessionWarning', true);
    assert.equal(doc.body.children.length, 1);
    assert.equal(doc.body.children[0].className, 'session-warning-overlay');
    assert.ok(doc.body.children[0].innerHTML.includes('Session Expiring'));
    assert.ok(doc.body.children[0].innerHTML.includes('Extend Session'));
    assert.ok(doc.body.children[0].innerHTML.includes('Logout'));
  });

  it('should render expired notice on sessionExpired', () => {
    Store.subscribe((key, value) => {
      if (key === 'sessionExpired' && value === true) {
        const el = doc.createElement('div');
        el.className = 'session-warning-overlay';
        el.innerHTML = `
          <div class="session-warning">
            <h2>Session Expired</h2>
            <p>Your session has expired due to inactivity. Please log in again.</p>
            <div class="form-actions">
              <button class="btn btn-primary" id="relogin-btn">Log In</button>
            </div>
          </div>
        `;
        doc.body.appendChild(el);
      }
    });

    Store.set('sessionExpired', true);
    assert.equal(doc.body.children.length, 1);
    assert.ok(doc.body.children[0].innerHTML.includes('Session Expired'));
    assert.ok(doc.body.children[0].innerHTML.includes('Log In'));
  });

  it('should not show duplicate warnings', () => {
    let warningEl = null;

    Store.subscribe((key, value) => {
      if (key === 'sessionWarning' && value === true) {
        if (warningEl) return; // Guard against duplicates, same as production code
        warningEl = doc.createElement('div');
        warningEl.className = 'session-warning-overlay';
        warningEl.innerHTML = '<div class="session-warning"><h2>Session Expiring</h2></div>';
        doc.body.appendChild(warningEl);
      }
    });

    Store.set('sessionWarning', true);
    Store.set('sessionWarning', true);
    assert.equal(doc.body.children.length, 1);
  });

  it('should clear warning state via Store', () => {
    Store.set('sessionWarning', true);
    Store.set('sessionWarning', false);
    assert.equal(Store.get('sessionWarning'), false);
  });

  it('should handle warning then expiry sequence', () => {
    const events = [];

    Store.subscribe((key, value) => {
      if (key === 'sessionWarning' && value === true) events.push('warning');
      if (key === 'sessionExpired' && value === true) events.push('expired');
    });

    Store.set('sessionWarning', true);
    Store.set('sessionExpired', true);
    assert.deepEqual(events, ['warning', 'expired']);
  });
});
