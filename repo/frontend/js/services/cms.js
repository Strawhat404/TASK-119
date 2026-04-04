/**
 * CMS (Content Management) service.
 * - Create → Review → Publish workflow
 * - Optional multilingual variants
 * - Change diff and rollback support
 */
import DB from '../database.js';
import { addAuditLog } from './audit.js';

const WORKFLOW_STATES = ['draft', 'review', 'published', 'archived'];

export function getWorkflowStates() {
  return [...WORKFLOW_STATES];
}

export async function createContent(data) {
  const record = {
    title: data.title,
    body: data.body,
    source: data.source || '',
    workflowState: 'draft',
    locale: data.locale || 'en',
    variants: data.variants || {},  // { locale: { title, body } }
    version: 1,
    history: [{
      version: 1,
      title: data.title,
      body: data.body,
      state: 'draft',
      changedBy: data.author || 'system',
      changedAt: Date.now()
    }],
    flagged: false,
    violations: [],
    violationCount: 0,
    scannedAt: null,
    author: data.author || 'system',
    reviewedBy: null,
    publishedBy: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const id = await DB.add('content', record);
  await addAuditLog('content_created', data.author, { contentId: id, title: data.title });
  return { ...record, id };
}

export async function updateContent(id, updates, actor) {
  const existing = await DB.get('content', id);
  if (!existing) throw new Error('Content not found');

  const before = { title: existing.title, body: existing.body, workflowState: existing.workflowState };

  if (updates.title !== undefined) existing.title = updates.title;
  if (updates.body !== undefined) existing.body = updates.body;
  if (updates.locale !== undefined) existing.locale = updates.locale;
  if (updates.variants !== undefined) existing.variants = updates.variants;

  existing.version += 1;
  existing.updatedAt = Date.now();

  existing.history.push({
    version: existing.version,
    title: existing.title,
    body: existing.body,
    state: existing.workflowState,
    changedBy: actor || 'system',
    changedAt: Date.now()
  });

  await DB.put('content', existing);

  const after = { title: existing.title, body: existing.body, workflowState: existing.workflowState };
  await addAuditLog('content_updated', actor, { contentId: id }, before, after);

  return existing;
}

export async function transitionWorkflow(id, newState, actor) {
  const existing = await DB.get('content', id);
  if (!existing) throw new Error('Content not found');

  const validTransitions = {
    draft: ['review'],
    review: ['published', 'draft'],
    published: ['archived', 'draft'],
    archived: ['draft']
  };

  const allowed = validTransitions[existing.workflowState];
  if (!allowed || !allowed.includes(newState)) {
    throw new Error(`Cannot transition from ${existing.workflowState} to ${newState}`);
  }

  const before = { workflowState: existing.workflowState };
  existing.workflowState = newState;
  existing.updatedAt = Date.now();

  if (newState === 'review') existing.reviewedBy = null;
  if (newState === 'published') existing.publishedBy = actor;

  existing.history.push({
    version: existing.version,
    title: existing.title,
    body: existing.body,
    state: newState,
    changedBy: actor || 'system',
    changedAt: Date.now()
  });

  await DB.put('content', existing);
  await addAuditLog('content_workflow', actor, { contentId: id, newState }, before, { workflowState: newState });

  return existing;
}

export async function reviewContent(id, decision, actor, notes = '') {
  const existing = await DB.get('content', id);
  if (!existing) throw new Error('Content not found');

  existing.reviewedBy = actor;
  existing.reviewNotes = notes;
  existing.updatedAt = Date.now();

  if (decision === 'approve') {
    return transitionWorkflow(id, 'published', actor);
  } else {
    return transitionWorkflow(id, 'draft', actor);
  }
}

export async function rollbackContent(id, targetVersion, actor) {
  const existing = await DB.get('content', id);
  if (!existing) throw new Error('Content not found');

  const target = existing.history.find(h => h.version === targetVersion);
  if (!target) throw new Error(`Version ${targetVersion} not found`);

  const before = { title: existing.title, body: existing.body, version: existing.version };

  existing.title = target.title;
  existing.body = target.body;
  existing.version += 1;
  existing.updatedAt = Date.now();

  existing.history.push({
    version: existing.version,
    title: existing.title,
    body: existing.body,
    state: existing.workflowState,
    changedBy: actor || 'system',
    changedAt: Date.now(),
    rollbackFrom: existing.version - 1,
    rollbackTo: targetVersion
  });

  await DB.put('content', existing);
  await addAuditLog('content_rollback', actor, {
    contentId: id,
    fromVersion: before.version,
    toVersion: targetVersion
  }, before, { title: existing.title, body: existing.body, version: existing.version });

  return existing;
}

export function generateDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const diff = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= oldLines.length) {
      diff.push({ type: 'added', line: i + 1, content: newLines[i] });
    } else if (i >= newLines.length) {
      diff.push({ type: 'removed', line: i + 1, content: oldLines[i] });
    } else if (oldLines[i] !== newLines[i]) {
      diff.push({ type: 'removed', line: i + 1, content: oldLines[i] });
      diff.push({ type: 'added', line: i + 1, content: newLines[i] });
    } else {
      diff.push({ type: 'unchanged', line: i + 1, content: oldLines[i] });
    }
  }

  return diff;
}

export async function getContentInReview() {
  return DB.getByIndex('content', 'workflowState', 'review');
}

export async function getAllContent() {
  return DB.getAll('content');
}
