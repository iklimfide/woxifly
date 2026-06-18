import { uploadFile } from './upload.js';
import { kindFromFile } from './urls.js';
import { updateMediaBlock } from './render.js';

function setUploadBar(active) {
    const area = document.getElementById('messageInputArea');
    const bar = document.getElementById('uploadStatus');
    const attachBtn = document.getElementById('attachBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const sendBtn = area?.querySelector('.send-btn');

    area?.classList.toggle('uploading', active);
    if (attachBtn) attachBtn.disabled = active;
    if (voiceBtn) voiceBtn.disabled = active;

    if (bar) {
        bar.hidden = !active;
        bar.classList.toggle('is-active', active);
        bar.textContent = active ? 'Medya yükleniyor...' : '';
    }
}

function normalizePastedFile(file) {
    if (!file) return null;

    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('quicktime', 'mov');
    const needsName = !file.name || file.name === 'image.png' || file.name === 'blob';
    if (!needsName) return file;

    const prefix = file.type.startsWith('video/') ? 'video' : 'image';
    return new File([file], `${prefix}-paste-${Date.now()}.${ext}`, { type: file.type });
}

function extractMediaFromClipboard(event) {
    const clipboard = event.clipboardData;
    if (!clipboard) return null;

    for (const item of clipboard.items || []) {
        if (item.kind !== 'file') continue;
        const itemType = (item.type || '').toLowerCase();
        if (!itemType.startsWith('image/') && !itemType.startsWith('video/')) continue;

        const file = item.getAsFile();
        if (!file?.size) continue;

        const typed = file.type
            ? file
            : new File([file], file.name || `paste.${itemType.split('/')[1] || 'png'}`, { type: itemType });
        return normalizePastedFile(typed);
    }

    for (const file of clipboard.files || []) {
        if (!file?.size) continue;
        const type = (file.type || '').toLowerCase();
        if (type.startsWith('image/') || type.startsWith('video/')) {
            return normalizePastedFile(file);
        }
    }

    return null;
}

async function deliverPickedMedia(file, { showNotify, onMediaMessage }) {
    const kind = kindFromFile(file);
    if (!kind) {
        showNotify('Yalnızca görsel, video veya ses yüklenebilir.', {
            title: 'Desteklenmeyen dosya',
            type: 'warning'
        });
        return;
    }

    await onMediaMessage(file, kind);
}

export async function uploadMediaFile(file, kind) {
    const result = await uploadFile(file, kind);
    return {
        url: result.url,
        r2Key: result.r2Key,
        kind: result.kind || kind
    };
}

export async function sendMediaFile(file, {
    kind,
    caption,
    clientId,
    onDeliver
}) {
    setUploadBar(true);

    try {
        const result = await uploadMediaFile(file, kind);

        updateMediaBlock(clientId, {
            kind,
            src: result.url,
            state: 'ready'
        });

        setUploadBar(false);

        if (onDeliver) {
            await onDeliver({
                clientId,
                kind: result.kind,
                url: result.url,
                r2Key: result.r2Key,
                caption
            });
        }

        return result;
    } catch (err) {
        setUploadBar(false);
        updateMediaBlock(clientId, { kind, src: null, state: 'failed' });
        throw err;
    }
}

export function initComposer({
    isLoggedIn,
    promptLogin,
    showNotify,
    onMediaMessage
}) {
    const fileInput = document.getElementById('fileInput');
    const attachBtn = document.getElementById('attachBtn');
    const voiceBtn = document.getElementById('voiceBtn');
    const messageInput = document.getElementById('messageInput');

    const mediaContext = { showNotify, onMediaMessage };

    attachBtn?.addEventListener('click', () => {
        if (!isLoggedIn()) {
            promptLogin();
            return;
        }
        fileInput?.click();
    });

    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (!file) return;

        try {
            await deliverPickedMedia(file, mediaContext);
        } catch (err) {
            showNotify(err.message || 'Medya gönderilemedi.', {
                title: 'Yükleme hatası',
                type: 'error'
            });
        }
    });

    const handlePaste = async (event) => {
        const file = extractMediaFromClipboard(event);
        if (!file) return;

        event.preventDefault();

        if (!isLoggedIn()) {
            promptLogin();
            return;
        }

        try {
            await deliverPickedMedia(file, mediaContext);
        } catch (err) {
            showNotify(err.message || 'Yapıştırılan medya gönderilemedi.', {
                title: 'Yükleme hatası',
                type: 'error'
            });
        }
    };

    messageInput?.addEventListener('paste', handlePaste);

    if (!voiceBtn) return;
}

export { kindFromFile };
