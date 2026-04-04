import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production logic from lib
import {
  scanContent,
  COMPLIANCE_RULES,
  WORKFLOW_STATES,
  VALID_TRANSITIONS,
  canTransition,
  generateDiff
} from '../frontend/js/lib/content-logic.js';

describe('Content Compliance Scanner', () => {
  it('should detect SSN patterns', () => {
    const violations = scanContent('My SSN is 123-45-6789');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleId, 'pii');
  });

  it('should detect restricted words', () => {
    const violations = scanContent('This content is banned and blocked');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleId, 'profanity');
    assert.equal(violations[0].matches, 2);
  });

  it('should detect external URLs', () => {
    const violations = scanContent('Visit https://example.com for info');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].ruleId, 'url');
  });

  it('should return empty for clean content', () => {
    const violations = scanContent('This is perfectly fine content.');
    assert.equal(violations.length, 0);
  });

  it('should detect multiple violation types', () => {
    const violations = scanContent('SSN: 123-45-6789, also banned word, see https://evil.com');
    assert.equal(violations.length, 3);
  });

  it('should be case insensitive for restricted words', () => {
    const violations = scanContent('BANNED and Blocked and RESTRICTED');
    assert.equal(violations.length, 1);
    assert.equal(violations[0].matches, 3);
  });

  it('should handle empty input', () => {
    const violations = scanContent('');
    assert.equal(violations.length, 0);
  });

  it('should detect multiple SSNs', () => {
    const violations = scanContent('SSN1: 111-22-3333, SSN2: 444-55-6666');
    const pii = violations.find(v => v.ruleId === 'pii');
    assert.equal(pii.matches, 2);
  });
});

describe('CMS Workflow', () => {
  it('should define four workflow states', () => {
    assert.deepEqual(WORKFLOW_STATES, ['draft', 'review', 'published', 'archived']);
  });

  it('should allow draft → review', () => {
    assert.equal(canTransition('draft', 'review'), true);
  });

  it('should allow review → published', () => {
    assert.equal(canTransition('review', 'published'), true);
  });

  it('should allow review → draft (rejection)', () => {
    assert.equal(canTransition('review', 'draft'), true);
  });

  it('should not allow draft → published directly', () => {
    assert.equal(canTransition('draft', 'published'), false);
  });

  it('should allow published → archived', () => {
    assert.equal(canTransition('published', 'archived'), true);
  });

  it('should allow archived → draft', () => {
    assert.equal(canTransition('archived', 'draft'), true);
  });
});

describe('Content Diff Generation', () => {
  it('should detect added lines', () => {
    const diff = generateDiff('line1', 'line1\nline2');
    assert.ok(diff.some(d => d.type === 'added' && d.content === 'line2'));
  });

  it('should detect removed lines', () => {
    const diff = generateDiff('line1\nline2', 'line1');
    assert.ok(diff.some(d => d.type === 'removed' && d.content === 'line2'));
  });

  it('should detect unchanged lines', () => {
    const diff = generateDiff('same', 'same');
    assert.ok(diff.some(d => d.type === 'unchanged' && d.content === 'same'));
  });

  it('should detect changed lines', () => {
    const diff = generateDiff('old', 'new');
    assert.ok(diff.some(d => d.type === 'removed' && d.content === 'old'));
    assert.ok(diff.some(d => d.type === 'added' && d.content === 'new'));
  });
});
