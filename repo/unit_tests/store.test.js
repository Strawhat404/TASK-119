import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Import actual production store module
// store.js uses no browser APIs besides being an ES module
import Store from '../frontend/js/store.js';

describe('Store', () => {
  beforeEach(() => {
    Store.reset();
  });

  it('should set and get values', () => {
    Store.set('name', 'HarborGate');
    assert.equal(Store.get('name'), 'HarborGate');
  });

  it('should return undefined for unset keys', () => {
    assert.equal(Store.get('missing'), undefined);
  });

  it('should return all state', () => {
    Store.set('a', 1);
    Store.set('b', 2);
    assert.deepEqual(Store.getAll(), { a: 1, b: 2 });
  });

  it('should notify subscribers on set', () => {
    const events = [];
    Store.subscribe((key, value) => events.push({ key, value }));
    Store.set('x', 42);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], { key: 'x', value: 42 });
  });

  it('should allow unsubscribing', () => {
    const events = [];
    const unsub = Store.subscribe((key, value) => events.push({ key, value }));
    Store.set('a', 1);
    unsub();
    Store.set('b', 2);
    assert.equal(events.length, 1);
  });

  it('should reset state and listeners', () => {
    Store.set('key', 'val');
    const events = [];
    Store.subscribe((k, v) => events.push(v));
    Store.reset();
    assert.equal(Store.get('key'), undefined);
    Store.set('key2', 'val2');
    assert.equal(events.length, 0);
  });

  it('should overwrite existing values', () => {
    Store.set('name', 'old');
    Store.set('name', 'new');
    assert.equal(Store.get('name'), 'new');
  });

  it('should support multiple subscribers', () => {
    let count1 = 0, count2 = 0;
    Store.subscribe(() => count1++);
    Store.subscribe(() => count2++);
    Store.set('x', 1);
    assert.equal(count1, 1);
    assert.equal(count2, 1);
  });
});

describe('Store — Table Pagination/Sorting', () => {
  beforeEach(() => {
    Store.reset();
  });

  it('should initialize table with data', () => {
    const data = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    Store.initTable('test', data, { pageSize: 2 });
    const { rows, page, totalPages, total } = Store.getTablePage('test');
    assert.equal(total, 3);
    assert.equal(totalPages, 2);
    assert.equal(page, 1);
    assert.equal(rows.length, 2);
  });

  it('should paginate', () => {
    const data = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    Store.initTable('pag', data, { pageSize: 10 });

    assert.equal(Store.getTablePage('pag').totalPages, 3);

    Store.setTablePage('pag', 2);
    assert.equal(Store.getTablePage('pag').page, 2);
    assert.equal(Store.getTablePage('pag').rows.length, 10);

    Store.setTablePage('pag', 3);
    assert.equal(Store.getTablePage('pag').rows.length, 5);
  });

  it('should sort ascending and descending', () => {
    const data = [{ name: 'C' }, { name: 'A' }, { name: 'B' }];
    Store.initTable('sort', data, { pageSize: 10 });

    Store.setTableSort('sort', 'name');
    const asc = Store.getTablePage('sort').rows;
    assert.equal(asc[0].name, 'A');
    assert.equal(asc[2].name, 'C');

    Store.setTableSort('sort', 'name');
    const desc = Store.getTablePage('sort').rows;
    assert.equal(desc[0].name, 'C');
    assert.equal(desc[2].name, 'A');
  });

  it('should filter data', () => {
    const data = [{ name: 'Alice', status: 'active' }, { name: 'Bob', status: 'inactive' }, { name: 'Carol', status: 'active' }];
    Store.initTable('filt', data, { pageSize: 10 });

    Store.setTableFilter('filt', r => r.status === 'active');
    assert.equal(Store.getTablePage('filt').total, 2);

    Store.setTableFilter('filt', null);
    assert.equal(Store.getTablePage('filt').total, 3);
  });
});
