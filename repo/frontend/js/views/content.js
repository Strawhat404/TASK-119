import DB from '../database.js';
import { requireRole, getCurrentUser, hasRole } from '../services/auth-service.js';
import {
  createContent, updateContent, transitionWorkflow, reviewContent,
  rollbackContent, generateDiff, getContentInReview, getAllContent, getWorkflowStates
} from '../services/cms.js';
import { addAuditLog } from '../services/audit.js';
import { createNotification } from '../services/notifications.js';
import { checkRateLimit } from '../services/rate-limits.js';
import Store from '../store.js';
import { showModal, closeModal, escapeHTML } from '../components/modal.js';
import { renderPaginatedTable } from '../components/table.js';
import { showNotification } from '../components/notifications.js';

const COMPLIANCE_RULES = [
  { id: 'pii', label: 'PII Detection', pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b/g, description: 'SSN or credit card numbers' },
  { id: 'profanity', label: 'Profanity Filter', pattern: /\b(banned|blocked|restricted)\b/gi, description: 'Restricted words' },
  { id: 'url', label: 'External URL', pattern: /https?:\/\/[^\s]+/g, description: 'External URLs' }
];

function scanContent(text) {
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

export async function renderContent(container) {
  if (!await requireRole(['admin', 'reviewer'])) return;
  const user = getCurrentUser();
  const isReviewer = hasRole(['admin', 'reviewer']);

  const items = await getAllContent();

  container.innerHTML = `
    <div class="view-header">
      <h1>Content Management</h1>
      <button class="btn btn-primary" id="create-content-btn">+ Create Content</button>
    </div>
    <div class="filters">
      <input type="text" id="content-search" placeholder="Search content..." class="input" />
      <select id="content-workflow-filter" class="input">
        <option value="">All States</option>
        ${getWorkflowStates().map(s => `<option value="${s}">${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
      </select>
      <select id="content-flag-filter" class="input">
        <option value="">All</option>
        <option value="flagged">Flagged</option>
        <option value="clean">Clean</option>
      </select>
    </div>
    <div id="content-table"></div>
  `;

  const columns = [
    { key: 'title', label: 'Title', sortable: true },
    { key: 'workflowState', label: 'Workflow', sortable: true, render: (val) => {
      const colors = { draft: 'pending', review: 'warning', published: 'approved', archived: 'denied' };
      return `<span class="badge badge-${colors[val] || 'pending'}">${val}</span>`;
    }},
    { key: 'flagged', label: 'Compliance', render: (val) => val
      ? '<span class="badge badge-denied">Flagged</span>'
      : '<span class="badge badge-approved">Clean</span>' },
    { key: 'version', label: 'Ver', sortable: true },
    { key: 'locale', label: 'Locale' },
    { key: 'author', label: 'Author', sortable: true },
    { key: 'updatedAt', label: 'Updated', sortable: true, render: (val) => new Date(val).toLocaleString() },
    { key: 'actions', label: 'Actions', render: (_, row) => {
      let btns = `<button class="btn btn-sm" data-action="view" data-id="${row.id}">View</button>`;
      btns += ` <button class="btn btn-sm" data-action="history" data-id="${row.id}">History</button>`;

      if (row.workflowState === 'draft') {
        btns += ` <button class="btn btn-sm" data-action="edit" data-id="${row.id}">Edit</button>`;
        btns += ` <button class="btn btn-sm btn-primary" data-action="submit-review" data-id="${row.id}">Submit for Review</button>`;
      }
      if (row.workflowState === 'review' && isReviewer) {
        btns += ` <button class="btn btn-sm btn-primary" data-action="approve" data-id="${row.id}">Approve</button>`;
        btns += ` <button class="btn btn-sm btn-danger" data-action="reject" data-id="${row.id}">Reject</button>`;
      }
      if (row.workflowState === 'published') {
        btns += ` <button class="btn btn-sm" data-action="archive" data-id="${row.id}">Archive</button>`;
      }
      btns += ` <button class="btn btn-sm btn-danger" data-action="delete" data-id="${row.id}">Delete</button>`;
      return btns;
    }}
  ];

  const tableId = 'content';
  Store.initTable(tableId, items, { pageSize: 10, sortKey: 'updatedAt', sortDir: 'desc' });

  function refresh() {
    renderPaginatedTable(document.getElementById('content-table'), tableId, columns, bindActions);
  }
  refresh();

  document.getElementById('content-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    Store.setTableFilter(tableId, q ? (i => i.title.toLowerCase().includes(q)) : null);
    refresh();
  });

  document.getElementById('content-workflow-filter').addEventListener('change', (e) => {
    const s = e.target.value;
    Store.setTableFilter(tableId, s ? (i => i.workflowState === s) : null);
    refresh();
  });

  document.getElementById('content-flag-filter').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'flagged') Store.setTableFilter(tableId, i => i.flagged);
    else if (v === 'clean') Store.setTableFilter(tableId, i => !i.flagged);
    else Store.setTableFilter(tableId, null);
    refresh();
  });

  document.getElementById('create-content-btn').addEventListener('click', () => {
    if (!hasRole(['admin', 'reviewer'])) return showNotification('Insufficient permissions', 'error');
    openContentForm();
  });

  function bindActions() {
    document.querySelectorAll('[data-action="view"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = await DB.get('content', Number(btn.dataset.id));
        if (!item) return;
        showModal('Content Details', `
          <h3>${escapeHTML(item.title)}</h3>
          <p><strong>State:</strong> ${escapeHTML(item.workflowState)} | <strong>Version:</strong> ${escapeHTML(item.version)} | <strong>Locale:</strong> ${escapeHTML(item.locale)}</p>
          <div class="content-body">${escapeHTML(item.body)}</div>
          ${item.violations?.length ? `<h4>Violations</h4><ul>${item.violations.map(v => `<li>${escapeHTML(v.label)}: ${escapeHTML(v.matches)} match(es)</li>`).join('')}</ul>` : ''}
          ${Object.keys(item.variants || {}).length ? `<h4>Variants</h4><ul>${Object.entries(item.variants).map(([loc, v]) => `<li><strong>${escapeHTML(loc)}:</strong> ${escapeHTML(v.title)}</li>`).join('')}</ul>` : ''}
          <div class="form-actions"><button class="btn btn-secondary" id="close-content-modal">Close</button></div>
        `);
        document.getElementById('close-content-modal').addEventListener('click', closeModal);
      });
    });

    document.querySelectorAll('[data-action="history"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const item = await DB.get('content', Number(btn.dataset.id));
        if (!item) return;
        showModal('Version History: ' + escapeHTML(item.title), `
          <table class="data-table">
            <thead><tr><th>Ver</th><th>State</th><th>Changed By</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>${item.history.map(h => `<tr>
              <td>${escapeHTML(h.version)}</td>
              <td>${escapeHTML(h.state)}</td>
              <td>${escapeHTML(h.changedBy)}</td>
              <td>${new Date(h.changedAt).toLocaleString()}</td>
              <td>
                <button class="btn btn-sm" data-action="diff" data-content-id="${item.id}" data-version="${h.version}">Diff</button>
                ${h.version < item.version ? `<button class="btn btn-sm btn-secondary" data-action="rollback" data-content-id="${item.id}" data-version="${h.version}">Rollback</button>` : ''}
              </td>
            </tr>`).join('')}</tbody>
          </table>
          <div class="form-actions"><button class="btn btn-secondary" id="close-history-modal">Close</button></div>
        `);
        document.getElementById('close-history-modal').addEventListener('click', closeModal);

        document.querySelectorAll('[data-action="diff"]').forEach(dbtn => {
          dbtn.addEventListener('click', () => {
            const ver = parseInt(dbtn.dataset.version);
            const entry = item.history.find(h => h.version === ver);
            const prev = item.history.find(h => h.version === ver - 1);
            if (entry && prev) {
              const diff = generateDiff(prev.body, entry.body);
              showModal(`Diff v${ver - 1} → v${ver}`, `
                <div class="diff-view">${diff.map(d => `<div class="diff-${d.type}">${d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '} ${escapeHTML(d.content)}</div>`).join('')}</div>
                <div class="form-actions"><button class="btn btn-secondary" id="close-diff">Close</button></div>
              `);
              document.getElementById('close-diff').addEventListener('click', closeModal);
            }
          });
        });

        document.querySelectorAll('[data-action="rollback"]').forEach(rbtn => {
          rbtn.addEventListener('click', async () => {
            if (!hasRole(['admin', 'reviewer'])) return showNotification('Insufficient permissions', 'error');
            await rollbackContent(Number(rbtn.dataset.contentId), parseInt(rbtn.dataset.version), user.username);
            showNotification('Rolled back to v' + rbtn.dataset.version, 'success');
            closeModal();
            renderContent(container);
          });
        });
      });
    });

    document.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!hasRole(['admin', 'reviewer'])) return showNotification('Insufficient permissions', 'error');
        const item = await DB.get('content', Number(btn.dataset.id));
        if (!item) return;
        openContentForm(item);
      });
    });

    document.querySelectorAll('[data-action="submit-review"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!hasRole(['admin', 'reviewer'])) return showNotification('Insufficient permissions', 'error');
        await transitionWorkflow(Number(btn.dataset.id), 'review', user.username);
        showNotification('Submitted for review', 'success');
        renderContent(container);
      });
    });

    document.querySelectorAll('[data-action="approve"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        // Rate-limit: user-scoped and global content publish rules
        const [userRl, globalRl] = await Promise.all([
          checkRateLimit('user', user.username, 'content_publish'),
          checkRateLimit('global', '', 'content_publish')
        ]);
        if (!userRl.allowed || !globalRl.allowed) {
          showNotification('Content publish rate limit reached. Try again later.', 'error');
          return;
        }
        const item = await reviewContent(Number(btn.dataset.id), 'approve', user.username);
        await createNotification({ userId: item.authorId, templateId: 'content_published', variables: { contentTitle: item.title }, type: 'success' });
        showNotification('Content published', 'success');
        renderContent(container);
      });
    });

    document.querySelectorAll('[data-action="reject"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await reviewContent(Number(btn.dataset.id), 'reject', user.username);
        showNotification('Content rejected', 'warning');
        renderContent(container);
      });
    });

    document.querySelectorAll('[data-action="archive"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!hasRole(['admin', 'reviewer'])) return showNotification('Insufficient permissions', 'error');
        await transitionWorkflow(Number(btn.dataset.id), 'archived', user.username);
        showNotification('Content archived', 'success');
        renderContent(container);
      });
    });

    document.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!hasRole(['admin', 'reviewer'])) return showNotification('Insufficient permissions', 'error');
        await DB.remove('content', Number(btn.dataset.id));
        showNotification('Content deleted', 'success');
        renderContent(container);
      });
    });
  }

  function openContentForm(existing = null) {
    const title = existing ? 'Edit Content' : 'Create Content';
    showModal(title, `
      <form id="content-form">
        <label class="form-label">Title
          <input type="text" name="title" class="input" value="${escapeHTML(existing?.title || '')}" required />
        </label>
        <label class="form-label">Body
          <textarea name="body" class="input" rows="6" required>${escapeHTML(existing?.body || '')}</textarea>
        </label>
        <label class="form-label">Locale
          <select name="locale" class="input">
            <option value="en" ${(!existing || existing.locale === 'en') ? 'selected' : ''}>English</option>
            <option value="es" ${existing?.locale === 'es' ? 'selected' : ''}>Spanish</option>
            <option value="fr" ${existing?.locale === 'fr' ? 'selected' : ''}>French</option>
            <option value="de" ${existing?.locale === 'de' ? 'selected' : ''}>German</option>
            <option value="zh" ${existing?.locale === 'zh' ? 'selected' : ''}>Chinese</option>
          </select>
        </label>
        <label class="form-label">Source
          <input type="text" name="source" class="input" value="${escapeHTML(existing?.source || '')}" placeholder="e.g., manual, import" />
        </label>
        <fieldset class="variant-fieldset">
          <legend>Multilingual Variant (optional)</legend>
          <label class="form-label">Variant Locale
            <select name="variantLocale" class="input">
              <option value="">None</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="zh">Chinese</option>
            </select>
          </label>
          <label class="form-label">Variant Title
            <input type="text" name="variantTitle" class="input" />
          </label>
          <label class="form-label">Variant Body
            <textarea name="variantBody" class="input" rows="3"></textarea>
          </label>
        </fieldset>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${existing ? 'Update' : 'Create'}</button>
          <button type="button" class="btn btn-secondary" id="cancel-content">Cancel</button>
        </div>
      </form>
    `);

    document.getElementById('cancel-content').addEventListener('click', closeModal);
    document.getElementById('content-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);

      // Build variants
      const variants = existing?.variants || {};
      if (data.variantLocale && data.variantTitle) {
        variants[data.variantLocale] = { title: data.variantTitle, body: data.variantBody || '' };
      }

      // Scan for compliance
      const violations = scanContent(data.body);

      if (existing) {
        await updateContent(existing.id, {
          title: data.title,
          body: data.body,
          locale: data.locale,
          variants
        }, user.username);
        // Update compliance
        existing.violations = violations;
        existing.violationCount = violations.length;
        existing.flagged = violations.length > 0;
        existing.scannedAt = Date.now();
        await DB.put('content', existing);
      } else {
        const record = await createContent({
          title: data.title,
          body: data.body,
          source: data.source,
          locale: data.locale,
          variants,
          author: user.username,
          authorId: user.id
        });
        record.violations = violations;
        record.violationCount = violations.length;
        record.flagged = violations.length > 0;
        record.scannedAt = Date.now();
        await DB.put('content', record);

        if (record.flagged) {
          await createNotification({
            userId: user.id,
            templateId: 'content_flagged',
            variables: { contentTitle: data.title },
            type: 'warning'
          });
        }
      }

      showNotification(violations.length > 0 ? 'Content saved (flagged!)' : 'Content saved', violations.length > 0 ? 'warning' : 'success');
      closeModal();
      renderContent(container);
    });
  }
}
