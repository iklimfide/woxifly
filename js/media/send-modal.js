import { createVoiceMessagePlayer } from '../voice-message-ui.js';

let onSendHandler = null;
let onCancelHandler = null;
let previewCleanup = null;
let isOpen = false;

function els() {
    return {
        root: document.getElementById('mediaSendModal'),
        preview: document.getElementById('mediaSendModalPreview'),
        caption: document.getElementById('mediaSendModalCaption'),
        sendBtn: document.getElementById('mediaSendModalSend'),
        status: document.getElementById('mediaSendModalStatus'),
        closeBtn: document.getElementById('mediaSendModalClose')
    };
}

function clearPreview() {
    if (previewCleanup) {
        previewCleanup();
        previewCleanup = null;
    }
    els().preview?.replaceChildren();
}

function renderPreview(kind, previewUrl) {
    const { preview } = els();
    if (!preview || !previewUrl) return;

    clearPreview();
    preview.replaceChildren();

    if (kind === 'video') {
        const video = document.createElement('video');
        video.className = 'media-send-modal-video';
        video.src = previewUrl;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        preview.appendChild(video);
        previewCleanup = () => {
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
        return;
    }

    if (kind === 'audio') {
        const wrap = document.createElement('div');
        wrap.className = 'media-send-modal-audio';
        const player = createVoiceMessagePlayer({ src: previewUrl, state: 'ready', seed: previewUrl });
        wrap.appendChild(player);
        preview.appendChild(wrap);
        previewCleanup = () => {
            player.querySelector('audio')?.pause();
        };
    }
}

export function isMediaSendModalOpen() {
    return isOpen;
}

export function setMediaSendUploadState(uploadState, { sending = false } = {}) {
    const { sendBtn, status } = els();
    if (!sendBtn) return;

    const uploading = uploadState === 'uploading' || uploadState === 'idle';
    const failed = uploadState === 'failed';

    sendBtn.disabled = sending || uploading || failed;
    sendBtn.classList.toggle('is-loading', uploading && !sending);
    sendBtn.textContent = sending ? 'Gönderiliyor…' : 'Gönder';

    if (!status) return;
    if (uploading) {
        status.hidden = false;
        status.textContent = 'Yükleniyor…';
    } else if (failed) {
        status.hidden = false;
        status.textContent = 'Yükleme başarısız. Kapatıp tekrar deneyin.';
    } else {
        status.hidden = true;
        status.textContent = '';
    }
}

export function openMediaSendModal({ kind, previewUrl, caption = '' }) {
    const { root, caption: captionInput, sendBtn } = els();
    if (!root) return;

    isOpen = true;
    root.hidden = false;
    root.classList.add('open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('media-send-modal-open');

    if (captionInput) captionInput.value = caption;
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Gönder';
    }

    setMediaSendUploadState('idle');
    renderPreview(kind, previewUrl);

    requestAnimationFrame(() => captionInput?.focus());
}

export function closeMediaSendModal() {
    const { root, caption, status } = els();
    if (!root) return;

    isOpen = false;
    root.classList.remove('open');
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('media-send-modal-open');

    clearPreview();
    if (caption) caption.value = '';
    if (status) {
        status.hidden = true;
        status.textContent = '';
    }
}

async function handleSend() {
    const { caption, sendBtn } = els();
    if (!onSendHandler || sendBtn?.disabled) return;

    const text = (caption?.value || '').trim();
    setMediaSendUploadState('ready', { sending: true });
    if (sendBtn) sendBtn.disabled = true;

    try {
        await onSendHandler(text);
    } finally {
        if (isOpen) {
            setMediaSendUploadState('ready', { sending: false });
        }
    }
}

function handleCancel() {
    if (onCancelHandler) {
        onCancelHandler();
        return;
    }
    closeMediaSendModal();
}

export function initMediaSendModal({ onSend, onCancel }) {
    onSendHandler = onSend;
    onCancelHandler = onCancel;

    const { root, closeBtn, sendBtn, caption } = els();
    if (!root) return;

    closeBtn?.addEventListener('click', handleCancel);

    sendBtn?.addEventListener('click', () => {
        handleSend();
    });

    caption?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleSend();
        }
    });

    root.addEventListener('click', (event) => {
        if (event.target === root) handleCancel();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen) handleCancel();
    });
}
