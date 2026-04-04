import Store from '../store.js';

export function renderTable(container, columns, data) {
  if (!data.length) {
    container.innerHTML = '<p class="empty-state">No records found.</p>';
    return;
  }

  const html = `
    <table class="data-table">
      <thead>
        <tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr>
      </thead>
      <tbody>
        ${data.map(row => `
          <tr>
            ${columns.map(c => `<td>${c.render ? c.render(row[c.key], row) : (row[c.key] ?? '')}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

export function renderPaginatedTable(container, tableId, columns, onRender) {
  const { rows, page, totalPages, total } = Store.getTablePage(tableId);

  if (total === 0) {
    container.innerHTML = '<p class="empty-state">No records found.</p>';
    return;
  }

  const headerCells = columns.map(c => {
    if (c.sortable) {
      const config = Store.get(`table_${tableId}`);
      const arrow = config?.sortKey === c.key ? (config.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="sortable" data-sort-key="${c.key}">${c.label}${arrow}</th>`;
    }
    return `<th>${c.label}</th>`;
  }).join('');

  const bodyRows = rows.map(row => `
    <tr>
      ${columns.map(c => `<td>${c.render ? c.render(row[c.key], row) : (row[c.key] ?? '')}</td>`).join('')}
    </tr>
  `).join('');

  const pagination = totalPages > 1 ? `
    <div class="pagination">
      <button class="btn btn-sm" data-page="prev" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      <span class="page-info">Page ${page} of ${totalPages} (${total} records)</span>
      <button class="btn btn-sm" data-page="next" ${page >= totalPages ? 'disabled' : ''}>Next</button>
    </div>
  ` : `<div class="pagination"><span class="page-info">${total} record(s)</span></div>`;

  container.innerHTML = `
    <table class="data-table">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${pagination}
  `;

  // Sort handlers
  container.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      Store.setTableSort(tableId, th.dataset.sortKey);
      renderPaginatedTable(container, tableId, columns, onRender);
    });
  });

  // Pagination handlers
  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.page === 'prev') Store.setTablePage(tableId, page - 1);
      else Store.setTablePage(tableId, page + 1);
      renderPaginatedTable(container, tableId, columns, onRender);
    });
  });

  if (onRender) onRender();
}
