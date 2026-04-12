import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, teardownDOM } from './dom-mock.js';
import { showDrawer, closeDrawer } from '../frontend/js/components/drawer.js';

describe('Drawer', () => {
  let doc;

  beforeEach(() => {
    doc = setupDOM();
    closeDrawer();
  });

  afterEach(() => {
    closeDrawer();
    teardownDOM();
  });

  it('should append a drawer overlay to body', () => {
    showDrawer('Drawer Title', '<p>content</p>');
    assert.equal(doc.body.children.length, 1);
    assert.equal(doc.body.children[0].className, 'drawer-overlay');
  });

  it('should include the escaped title', () => {
    showDrawer('<script>alert(1)</script>', 'body');
    const overlay = doc.body.children[0];
    assert.ok(overlay.innerHTML.includes('&lt;script&gt;'));
    assert.ok(!overlay.innerHTML.includes('<script>'));
  });

  it('should include the body HTML', () => {
    showDrawer('Title', '<div class="custom">Hello</div>');
    const overlay = doc.body.children[0];
    assert.ok(overlay.innerHTML.includes('<div class="custom">Hello</div>'));
  });

  it('should have a close button', () => {
    showDrawer('Title', 'Body');
    const overlay = doc.body.children[0];
    assert.ok(overlay.innerHTML.includes('drawer-close'));
    assert.ok(overlay.innerHTML.includes('aria-label="Close"'));
  });

  it('should remove drawer on closeDrawer', () => {
    showDrawer('Title', 'Body');
    assert.equal(doc.body.children.length, 1);
    closeDrawer();
    assert.equal(doc.body.children.length, 0);
  });

  it('should handle closeDrawer when no drawer is open', () => {
    closeDrawer();
    assert.equal(doc.body.children.length, 0);
  });

  it('should replace existing drawer when showDrawer is called twice', () => {
    showDrawer('First', 'Body1');
    showDrawer('Second', 'Body2');
    assert.equal(doc.body.children.length, 1);
    assert.ok(doc.body.children[0].innerHTML.includes('Second'));
  });

  it('should trigger requestAnimationFrame for open animation', () => {
    let rafCalled = false;
    globalThis.requestAnimationFrame = (cb) => { rafCalled = true; cb(); };
    showDrawer('Title', 'Body');
    assert.ok(rafCalled);
  });
});
