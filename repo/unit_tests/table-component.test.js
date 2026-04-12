import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDOM, teardownDOM } from './dom-mock.js';
import Store from '../frontend/js/store.js';
import { renderTable, renderPaginatedTable } from '../frontend/js/components/table.js';

describe('renderTable', () => {
  let doc;
  let container;

  beforeEach(() => {
    doc = setupDOM();
    container = doc.createElement('div');
  });

  afterEach(() => {
    teardownDOM();
  });

  it('should show empty state when data is empty', () => {
    renderTable(container, [], []);
    assert.ok(container.innerHTML.includes('No records found'));
    assert.ok(container.innerHTML.includes('empty-state'));
  });

  it('should render a table with headers', () => {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' }
    ];
    const data = [{ name: 'Alice', email: 'alice@test.com' }];
    renderTable(container, columns, data);

    assert.ok(container.innerHTML.includes('data-table'));
    assert.ok(container.innerHTML.includes('<th>Name</th>'));
    assert.ok(container.innerHTML.includes('<th>Email</th>'));
  });

  it('should render data rows', () => {
    const columns = [{ key: 'name', label: 'Name' }];
    const data = [{ name: 'Alice' }, { name: 'Bob' }];
    renderTable(container, columns, data);

    assert.ok(container.innerHTML.includes('Alice'));
    assert.ok(container.innerHTML.includes('Bob'));
  });

  it('should escape cell values by default', () => {
    const columns = [{ key: 'name', label: 'Name' }];
    const data = [{ name: '<script>alert(1)</script>' }];
    renderTable(container, columns, data);

    assert.ok(container.innerHTML.includes('&lt;script&gt;'));
    assert.ok(!container.innerHTML.includes('<script>alert'));
  });

  it('should use custom render function when provided', () => {
    const columns = [{
      key: 'status',
      label: 'Status',
      render: (val) => `<span class="badge">${val}</span>`
    }];
    const data = [{ status: 'active' }];
    renderTable(container, columns, data);

    assert.ok(container.innerHTML.includes('<span class="badge">active</span>'));
  });

  it('should handle null/undefined cell values', () => {
    const columns = [{ key: 'name', label: 'Name' }];
    const data = [{ name: null }, { name: undefined }];
    renderTable(container, columns, data);

    // Should not throw and should render empty cells
    assert.ok(container.innerHTML.includes('<td>'));
  });

  it('should render multiple columns per row', () => {
    const columns = [
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' }
    ];
    const data = [{ id: 1, name: 'Alice', role: 'admin' }];
    renderTable(container, columns, data);

    assert.ok(container.innerHTML.includes('1'));
    assert.ok(container.innerHTML.includes('Alice'));
    assert.ok(container.innerHTML.includes('admin'));
  });
});

describe('renderPaginatedTable', () => {
  let doc;
  let container;

  beforeEach(() => {
    doc = setupDOM();
    container = doc.createElement('div');
    Store.reset();
  });

  afterEach(() => {
    Store.reset();
    teardownDOM();
  });

  it('should show empty state when no data', () => {
    Store.initTable('test', [], { pageSize: 5 });
    const columns = [{ key: 'name', label: 'Name' }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('No records found'));
  });

  it('should render table with data', () => {
    const data = [{ name: 'Alice' }, { name: 'Bob' }];
    Store.initTable('test', data, { pageSize: 10 });
    const columns = [{ key: 'name', label: 'Name' }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('Alice'));
    assert.ok(container.innerHTML.includes('Bob'));
  });

  it('should show record count for single page', () => {
    const data = [{ name: 'Alice' }];
    Store.initTable('test', data, { pageSize: 10 });
    const columns = [{ key: 'name', label: 'Name' }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('1 record(s)'));
  });

  it('should show pagination for multiple pages', () => {
    const data = Array.from({ length: 15 }, (_, i) => ({ name: `User ${i}` }));
    Store.initTable('test', data, { pageSize: 5 });
    const columns = [{ key: 'name', label: 'Name' }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('Page 1 of 3'));
    assert.ok(container.innerHTML.includes('15 records'));
    assert.ok(container.innerHTML.includes('Prev'));
    assert.ok(container.innerHTML.includes('Next'));
  });

  it('should render sortable column headers', () => {
    const data = [{ name: 'Alice' }];
    Store.initTable('test', data, { pageSize: 10 });
    const columns = [{ key: 'name', label: 'Name', sortable: true }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('sortable'));
    assert.ok(container.innerHTML.includes('data-sort-key="name"'));
  });

  it('should show sort arrow for active sort column', () => {
    const data = [{ name: 'C' }, { name: 'A' }, { name: 'B' }];
    Store.initTable('test', data, { pageSize: 10 });
    Store.setTableSort('test', 'name');
    const columns = [{ key: 'name', label: 'Name', sortable: true }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('▲'));
  });

  it('should escape cell content', () => {
    const data = [{ name: '<img src=x onerror=alert(1)>' }];
    Store.initTable('test', data, { pageSize: 10 });
    const columns = [{ key: 'name', label: 'Name' }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('&lt;img'));
    assert.ok(!container.innerHTML.includes('<img src=x'));
  });

  it('should call onRender callback', () => {
    const data = [{ name: 'Alice' }];
    Store.initTable('test', data, { pageSize: 10 });
    const columns = [{ key: 'name', label: 'Name' }];
    let rendered = false;
    renderPaginatedTable(container, 'test', columns, () => { rendered = true; });

    assert.ok(rendered);
  });

  it('should use custom render function for cells', () => {
    const data = [{ active: true }];
    Store.initTable('test', data, { pageSize: 10 });
    const columns = [{
      key: 'active',
      label: 'Active',
      render: (val) => val ? '<span class="yes">Yes</span>' : 'No'
    }];
    renderPaginatedTable(container, 'test', columns);

    assert.ok(container.innerHTML.includes('<span class="yes">Yes</span>'));
  });
});
