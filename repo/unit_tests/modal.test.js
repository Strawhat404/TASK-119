import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, teardownDOM } from './dom-mock.js';
import { escapeHTML, showModal, closeModal } from '../frontend/js/components/modal.js';

describe('escapeHTML', () => {
  it('should escape ampersands', () => {
    assert.equal(escapeHTML('a&b'), 'a&amp;b');
  });

  it('should escape angle brackets', () => {
    assert.equal(escapeHTML('<div>'), '&lt;div&gt;');
  });

  it('should escape double quotes', () => {
    assert.equal(escapeHTML('"hello"'), '&quot;hello&quot;');
  });

  it('should escape single quotes', () => {
    assert.equal(escapeHTML("it's"), "it&#39;s");
  });

  it('should handle null input', () => {
    assert.equal(escapeHTML(null), '');
  });

  it('should handle undefined input', () => {
    assert.equal(escapeHTML(undefined), '');
  });

  it('should handle empty string', () => {
    assert.equal(escapeHTML(''), '');
  });

  it('should convert numbers to string', () => {
    assert.equal(escapeHTML(42), '42');
  });

  it('should escape multiple special characters', () => {
    assert.equal(escapeHTML('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('showModal / closeModal', () => {
  let doc;

  beforeEach(() => {
    doc = setupDOM();
    // Reset module state by closing any open modal
    closeModal();
  });

  afterEach(() => {
    closeModal();
    teardownDOM();
  });

  it('should append a modal overlay to body', () => {
    showModal('Test Title', '<p>body</p>');
    assert.equal(doc.body.children.length, 1);
    assert.equal(doc.body.children[0].className, 'modal-overlay');
  });

  it('should include the escaped title in the modal', () => {
    showModal('Hello <World>', '<p>content</p>');
    const overlay = doc.body.children[0];
    assert.ok(overlay.innerHTML.includes('Hello &lt;World&gt;'));
  });

  it('should include the body HTML', () => {
    showModal('Title', '<p>Custom Body</p>');
    const overlay = doc.body.children[0];
    assert.ok(overlay.innerHTML.includes('<p>Custom Body</p>'));
  });

  it('should have a close button with aria-label', () => {
    showModal('Title', 'Body');
    const overlay = doc.body.children[0];
    assert.ok(overlay.innerHTML.includes('aria-label="Close"'));
  });

  it('should remove modal on closeModal', () => {
    showModal('Title', 'Body');
    assert.equal(doc.body.children.length, 1);
    closeModal();
    assert.equal(doc.body.children.length, 0);
  });

  it('should handle closeModal when no modal is open', () => {
    // Should not throw
    closeModal();
    assert.equal(doc.body.children.length, 0);
  });

  it('should replace existing modal when showModal is called twice', () => {
    showModal('First', 'Body1');
    showModal('Second', 'Body2');
    assert.equal(doc.body.children.length, 1);
    assert.ok(doc.body.children[0].innerHTML.includes('Second'));
  });
});
