/**
 * Lightweight client-side state store with subscription support.
 * Coordinates views, modals, drawers, table pagination/sorting.
 */
const Store = {
  _state: {},
  _listeners: [],

  get(key) {
    return this._state[key];
  },

  set(key, value) {
    this._state[key] = value;
    this._notify(key, value);
  },

  getAll() {
    return { ...this._state };
  },

  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  },

  _notify(key, value) {
    for (const listener of this._listeners) {
      listener(key, value);
    }
  },

  reset() {
    this._state = {};
    this._listeners = [];
  },

  // Table pagination/sorting helpers
  initTable(tableId, data, opts = {}) {
    const config = {
      page: 1,
      pageSize: opts.pageSize || 10,
      sortKey: opts.sortKey || null,
      sortDir: opts.sortDir || 'asc',
      data: data,
      filtered: data
    };
    this.set(`table_${tableId}`, config);
    return config;
  },

  getTablePage(tableId) {
    const config = this.get(`table_${tableId}`);
    if (!config) return { rows: [], page: 1, totalPages: 1 };

    let sorted = [...config.filtered];
    if (config.sortKey) {
      sorted.sort((a, b) => {
        const av = a[config.sortKey] ?? '';
        const bv = b[config.sortKey] ?? '';
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return config.sortDir === 'asc' ? cmp : -cmp;
      });
    }

    const totalPages = Math.max(1, Math.ceil(sorted.length / config.pageSize));
    const page = Math.min(config.page, totalPages);
    const start = (page - 1) * config.pageSize;
    const rows = sorted.slice(start, start + config.pageSize);

    return { rows, page, totalPages, total: sorted.length };
  },

  setTablePage(tableId, page) {
    const config = this.get(`table_${tableId}`);
    if (config) {
      config.page = page;
      this.set(`table_${tableId}`, config);
    }
  },

  setTableSort(tableId, key) {
    const config = this.get(`table_${tableId}`);
    if (config) {
      if (config.sortKey === key) {
        config.sortDir = config.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        config.sortKey = key;
        config.sortDir = 'asc';
      }
      config.page = 1;
      this.set(`table_${tableId}`, config);
    }
  },

  setTableFilter(tableId, filterFn) {
    const config = this.get(`table_${tableId}`);
    if (config) {
      config.filtered = filterFn ? config.data.filter(filterFn) : config.data;
      config.page = 1;
      this.set(`table_${tableId}`, config);
    }
  }
};

export default Store;
