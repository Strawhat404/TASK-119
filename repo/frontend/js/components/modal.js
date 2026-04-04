let modalEl = null;

export function showModal(title, bodyHTML) {
  closeModal();

  modalEl = document.createElement('div');
  modalEl.className = 'modal-overlay';
  modalEl.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
    </div>
  `;

  document.body.appendChild(modalEl);

  modalEl.querySelector('.modal-close').addEventListener('click', closeModal);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });
}

export function closeModal() {
  if (modalEl) {
    modalEl.remove();
    modalEl = null;
  }
}
