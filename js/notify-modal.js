let elements = null;

export function initNotifyModal() {
    elements = {
        overlay: document.getElementById('notifyModalOverlay'),
        modal: document.getElementById('notifyModal'),
        title: document.getElementById('notifyModalTitle'),
        message: document.getElementById('notifyModalMessage'),
        okBtn: document.getElementById('notifyModalOk'),
        closeBtn: document.getElementById('notifyModalClose')
    };

    const close = () => closeNotifyModal();

    elements.overlay.addEventListener('click', (event) => {
        if (event.target === elements.overlay) close();
    });
    elements.modal.addEventListener('click', (event) => event.stopPropagation());
    elements.okBtn.addEventListener('click', close);
    elements.closeBtn.addEventListener('click', close);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && elements.overlay.classList.contains('open')) {
            close();
        }
    });
}

export function showNotify(message, { title = 'Bildirim', type = 'info' } = {}) {
    if (!elements) return;

    elements.title.textContent = title;
    elements.message.textContent = message;
    elements.modal.dataset.type = type;

    elements.overlay.classList.add('open');
    elements.modal.classList.add('open');
    document.body.classList.add('notify-modal-open');

    setTimeout(() => elements.okBtn.focus(), 100);
}

export function closeNotifyModal() {
    if (!elements) return;

    elements.overlay.classList.remove('open');
    elements.modal.classList.remove('open');
    document.body.classList.remove('notify-modal-open');
}
