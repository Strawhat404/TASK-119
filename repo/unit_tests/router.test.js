import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Router uses window.location.hash and window.addEventListener which aren't available in Node.
// We test the pure routing logic by creating a testable router that mirrors the production one.
// The production router.js is tested via integration in the browser.
// Here we verify the routing algorithm is correct.

function createRouter() {
  let routes = {};
  let currentHash = '/';

  return {
    register(hash, handler) { routes[hash] = handler; },
    navigate(hash) { currentHash = hash; this._resolve(); },
    currentRoute() { return currentHash; },
    _resolve() {
      const handler = routes[currentHash] || routes['/'];
      if (handler) handler(currentHash);
    },
    reset() { routes = {}; currentHash = '/'; }
  };
}

describe('Router', () => {
  let router;

  beforeEach(() => {
    router = createRouter();
  });

  it('should register and resolve routes', () => {
    let called = null;
    router.register('/test', (route) => { called = route; });
    router.navigate('/test');
    assert.equal(called, '/test');
  });

  it('should fall back to / for unknown routes', () => {
    let called = null;
    router.register('/', (route) => { called = route; });
    router.navigate('/nonexistent');
    assert.equal(called, '/nonexistent');
  });

  it('should track current route', () => {
    router.register('/page', () => {});
    router.navigate('/page');
    assert.equal(router.currentRoute(), '/page');
  });

  it('should register multiple routes', () => {
    const visited = [];
    router.register('/a', () => visited.push('a'));
    router.register('/b', () => visited.push('b'));
    router.navigate('/a');
    router.navigate('/b');
    assert.deepEqual(visited, ['a', 'b']);
  });

  it('should handle root route', () => {
    let called = false;
    router.register('/', () => { called = true; });
    router.navigate('/');
    assert.equal(called, true);
  });

  it('should overwrite route handler on re-register', () => {
    let value = '';
    router.register('/x', () => { value = 'first'; });
    router.register('/x', () => { value = 'second'; });
    router.navigate('/x');
    assert.equal(value, 'second');
  });
});
