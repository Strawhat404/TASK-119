/**
 * Hash-based router.
 */
const Router = {
  _routes: {},
  _currentView: null,

  register(hash, handler) {
    this._routes[hash] = handler;
  },

  start() {
    window.addEventListener('hashchange', () => this._resolve());
    this._resolve();
  },

  navigate(hash) {
    window.location.hash = hash;
  },

  currentRoute() {
    return window.location.hash.slice(1) || '/';
  },

  _resolve() {
    const path = this.currentRoute();
    const handler = this._routes[path] || this._routes['/'];
    if (handler) {
      this._currentView = path;
      handler(path);
    }
  }
};

export default Router;
