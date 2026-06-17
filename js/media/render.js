import { openViewer } from './viewer.js';
import { displayMediaUrl } from './urls.js';
import { createVoiceMessagePlayer } from '../voice-message-ui.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function buildThumb(kind, src) {
    const resolved = displayMediaUrl(src) || src;

    if (kind === 'video') {
        const video = el('video', 'media-thumb');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'metadata';
        video.src = resolved;
        return video;
    }

    const img = el('img', 'media-thumb');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = resolved;
    return img;
}

function makeMediaCard() {
    const card = el('div', 'media-card');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    return card;
}

function bindCardActivation(card, onActivate) {
    card.addEventListener('click', (event) => {
        event.stopPropagation();
        onActivate();
    });
    card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate();
        }
    });
}

export function renderMediaBlock(host, { kind, src, state = 'ready' }) {
    host.replaceChildren();
    host.dataset.mediaKind = kind;
    host.dataset.mediaState = state;
    if (src) host.dataset.mediaSrc = src;

    if (kind === 'audio') {
        const previousSrc = host.dataset.mediaSrc;
        if (previousSrc?.startsWith('blob:') && previousSrc !== src) {
            URL.revokeObjectURL(previousSrc);
        }

        const resolved = displayMediaUrl(src) || src;
        const canPreview = state === 'ready' || (state === 'pending' && resolved?.startsWith('blob:'));
        const player = createVoiceMessagePlayer({
            src: canPreview ? resolved : null,
            state,
            seed: resolved || host.dataset.clientId || 'voice'
        });
        host.appendChild(player);
        return;
    }

    if (kind !== 'image' && kind !== 'video') return;

    const card = makeMediaCard();

    if (state === 'pending') {
        card.classList.add('media-card--pending');
        card.setAttribute('aria-disabled', 'true');
        card.tabIndex = -1;
        if (src) {
            const thumb = buildThumb(kind, src);
            card.appendChild(thumb);
        }
        card.appendChild(el('span', 'media-card-label', 'Yükleniyor...'));
        host.appendChild(card);
        return;
    }

    if (state === 'failed') {
        card.classList.add('media-card--error');
        card.setAttribute('aria-disabled', 'true');
        card.tabIndex = -1;
        card.appendChild(el('span', 'media-card-label', 'Gönderilemedi'));
        host.appendChild(card);
        return;
    }

    const thumb = buildThumb(kind, src);

    thumb.addEventListener('error', () => {
        card.classList.add('media-card--error');
        card.appendChild(el('span', 'media-card-label', 'Yüklenemedi'));
    });

    card.appendChild(thumb);

    if (kind === 'video') {
        card.classList.add('media-card--video');
    }

    bindCardActivation(card, () => {
        if (!src || card.classList.contains('media-card--error')) return;
        openViewer(src, kind);
    });

    host.appendChild(card);
}

export function updateMediaBlock(clientId, options) {
    const message = document.querySelector(`.message[data-client-id="${clientId}"]`);
    if (!message) return;

    const host = message.querySelector('.message-media');
    if (!host) return;

    const kind = options.kind || host.dataset.mediaKind || 'image';
    renderMediaBlock(host, options);

    const status = message.querySelector('.message-status');
    if (!status) return;

    if (options.state === 'pending') {
        status.textContent = 'Gönderiliyor...';
        status.hidden = false;
    } else if (options.state === 'ready') {
        status.textContent = '';
        status.hidden = true;
    } else if (options.state === 'failed') {
        status.textContent = 'Gönderilemedi';
        status.hidden = false;
    } else {
        status.textContent = '';
        status.hidden = true;
    }
}

export function createMediaHost({ kind, src, state, clientId, isOutgoing }) {
    const host = el('div', 'message-media');
    if (clientId) host.dataset.clientId = clientId;
    renderMediaBlock(host, { kind, src, state });

    if (isOutgoing && clientId) {
        const status = el('span', 'message-status');
        if (state === 'pending') {
            status.textContent = 'Gönderiliyor...';
            status.hidden = false;
        }
        return { host, status };
    }

    return { host, status: null };
}
