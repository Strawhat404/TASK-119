import { escapeHTML } from './modal.js';

let drawerEl = null;

export function showDrawer(title, bodyHTML) {
  closeDrawer();

  drawerEl = document.createElement('div');
  drawerEl.className = 'drawer-overlay';
  drawerEl.innerHTML = `
    <div class="drawer">
      <div class="drawer-header">
        <h2>${escapeHTML(title)}</h2>
        <button class="drawer-close" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-body">${bodyHTML}</div>
    </div>
  `;

  document.body.appendChild(drawerEl);

  drawerEl.querySelector('.drawer-close').addEventListener('click', closeDrawer);
  drawerEl.addEventListener('click', (e) => {
    if (e.target === drawerEl) closeDrawer();
  });

  // Animate in
  requestAnimationFrame(() => {
    drawerEl.querySelector('.drawer').classList.add('drawer-open');
  });
}

export function closeDrawer() {
  if (drawerEl) {
    drawerEl.remove();
    drawerEl = null;
  }
}
