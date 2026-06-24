import { openViewer } from './viewer.js';
import { displayMediaUrl, getMediaDisplayUrls } from './urls.js';
import { createVoiceMessagePlayer } from '../voice-message-ui.js';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function pickVideoPosterTime(duration) {
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    if (duration <= 0.2) return 0;
    return Math.min(Math.max(duration * 0.1, 0.25), 2);
}

function buildThumb(kind, src) {
    const resolved = displayMediaUrl(src) || src;

    if (kind === 'video') {
        const video = document.createElement('video');
        video.className = 'media-thumb media-thumb--video';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.setAttribute('aria-hidden', 'true');
        if (resolved) {
            video.src = resolved;
            let posterSeekDone = false;
            const seekToPoster = () => {
                if (posterSeekDone) return;
                posterSeekDone = true;
                const seekTo = pickVideoPosterTime(video.duration);
                const onSeeked = () => {
                    video.pause();
                    video.removeEventListener('seeked', onSeeked);
                };
                video.addEventListener('seeked', onSeeked);
                try {
                    video.currentTime = seekTo;
                } catch {
                    video.pause();
                }
            };
            video.addEventListener('loadeddata', seekToPoster, { once: true });
        }
        return video;
    }

    const img = el('img', 'media-thumb');
    img.alt = '';
    img.loading = 'eager';
    img.decoding = 'async';
    img.src = resolved;
    return img;
}

function markThumbLoadError(card, thumb, resolved, mediaR2Key = null) {
    if (card.classList.contains('media-card--error')) return;

    const retry = Number(card.dataset.mediaRetry || 0);
    const host = card.closest('.message-media');
    const r2Key = mediaR2Key || host?.dataset.mediaR2Key || null;
    const source = host?.dataset.mediaSrc || resolved;
    const candidates = getMediaDisplayUrls(source, r2Key);
    const next = retry + 1;

    if (thumb?.tagName === 'IMG' && next < candidates.length) {
        card.dataset.mediaRetry = String(next);
        thumb.src = candidates[next];
        return;
    }

    thumb?.remove();
    card.classList.add('media-card--error');
    if (!card.querySelector('.media-card-label')) {
        card.appendChild(el('span', 'media-card-label', 'Yüklenemedi'));
    }
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

export function renderMediaBlock(host, { kind, src, state = 'ready', mediaR2Key = null }) {
    host.replaceChildren();
    host.dataset.mediaKind = kind;
    host.dataset.mediaState = state;
    if (src) host.dataset.mediaSrc = src;
    if (mediaR2Key) host.dataset.mediaR2Key = mediaR2Key;
    else delete host.dataset.mediaR2Key;

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
    const resolved = displayMediaUrl(src) || src;

    if (thumb.tagName === 'IMG') {
        thumb.addEventListener('error', () => {
            markThumbLoadError(card, thumb, resolved, mediaR2Key);
        });
    }

    card.appendChild(thumb);

    if (kind === 'video') {
        card.classList.add('media-card--video');
        thumb.addEventListener('error', () => {
            markThumbLoadError(card, thumb, resolved, mediaR2Key);
        });
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
    renderMediaBlock(host, {
        kind,
        src: options.src,
        state: options.state,
        mediaR2Key: options.mediaR2Key || host.dataset.mediaR2Key || null
    });

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

export function createMediaHost({ kind, src, state, clientId, isOutgoing, mediaR2Key = null }) {
    const host = el('div', 'message-media');
    if (clientId) host.dataset.clientId = clientId;
    renderMediaBlock(host, { kind, src, state, mediaR2Key });

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
