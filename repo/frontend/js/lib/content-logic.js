/**
 * Pure content/compliance logic — no browser/DB dependencies.
 */

export const COMPLIANCE_RULES = [
  { id: 'pii', label: 'PII Detection', pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b/g, description: 'SSN or credit card numbers' },
  { id: 'profanity', label: 'Profanity Filter', pattern: /\b(banned|blocked|restricted)\b/gi, description: 'Restricted words' },
  { id: 'url', label: 'External URL', pattern: /https?:\/\/[^\s]+/g, description: 'External URLs' }
];

export function scanContent(text) {
  const violations = [];
  for (const rule of COMPLIANCE_RULES) {
    rule.pattern.lastIndex = 0;
    const matches = text.match(rule.pattern);
    if (matches) {
      violations.push({ ruleId: rule.id, label: rule.label, matches: matches.length, description: rule.description });
    }
  }
  return violations;
}

export const WORKFLOW_STATES = ['draft', 'review', 'published', 'archived'];

export const VALID_TRANSITIONS = {
  draft: ['review'],
  review: ['published', 'draft'],
  published: ['archived', 'draft'],
  archived: ['draft']
};

export function canTransition(fromState, toState) {
  const allowed = VALID_TRANSITIONS[fromState];
  return allowed && allowed.includes(toState);
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
