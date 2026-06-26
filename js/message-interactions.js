import { formatQuotePreview, formatQuoteAuthorLabel, appendTextWithLinks } from './utils.js';
import { displayMediaUrl } from './media/urls.js';
import { showToast } from './notify-modal.js';
import { resizeMessageInput } from './media/composer.js';

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

let pendingQuote = null;
let pendingEdit = null;
let activeContextMenu = null;
let contextMenuTarget = null;
let suppressNativeContextMenu = false;
let contextMenuDismissUntil = 0;
let contextMenuIsOpen = false;
let onToggleReaction = null;
let onDeleteMessages = null;
let onForwardMessage = null;
let onShowNotify = null;
let getAuthContext = null;
let getViewerContext = () => ({ userId: null, username: null });
let selectionMode = false;
let selectedMessageKeys = new Set();
let onSelectionChange = null;
let boundMessageContainer = null;

export function isSelectionMode() {
    return selectionMode;
}

export function getSelectedMessageKeys() {
    return new Set(selectedMessageKeys);
}

function messageSelectionKey(messageEl) {
    return messageEl.dataset.messageId || messageEl.dataset.clientId || null;
}

function updateMessageCheckbox(messageEl) {
    const key = messageSelectionKey(messageEl);
    if (!key) return;

    let checkbox = messageEl.querySelector('.message-select-checkbox');
    if (!selectionMode) {
        checkbox?.remove();
        messageEl.classList.remove('is-selected');
        return;
    }

    if (!checkbox) {
        checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'message-select-checkbox';
        checkbox.addEventListener('click', (event) => event.stopPropagation());
        checkbox.addEventListener('change', (event) => {
            event.stopPropagation();
            toggleMessageSelection(messageEl, checkbox.checked);
        });
        messageEl.prepend(checkbox);
    }

    const isSelected = selectedMessageKeys.has(key);
    checkbox.checked = isSelected;
    messageEl.classList.toggle('is-selected', isSelected);
}

export function refreshSelectionUi(messageContainer) {
    if (!messageContainer) return;
    messageContainer.classList.toggle('selection-mode', selectionMode);
    messageContainer.querySelectorAll('.message').forEach(updateMessageCheckbox);
}

export function enterSelectionMode({ messageContainer, initialMessageEl = null } = {}) {
    const ctx = getAuthContext?.();
    if (!ctx?.isLoggedIn?.()) {
        ctx?.promptLogin?.();
        return;
    }

    closeActiveActions();
    selectionMode = true;
    selectedMessageKeys.clear();

    if (initialMessageEl) {
        const key = messageSelectionKey(initialMessageEl);
        if (key) selectedMessageKeys.add(key);
    }

    refreshSelectionUi(messageContainer);
    onSelectionChange?.(selectedMessageKeys.size);
}

export function exitSelectionMode(messageContainer) {
    selectionMode = false;
    selectedMessageKeys.clear();
    refreshSelectionUi(messageContainer);
    onSelectionChange?.(0);
}

function toggleMessageSelection(messageEl, selected) {
    const key = messageSelectionKey(messageEl);
    if (!key) return;

    if (selected) selectedMessageKeys.add(key);
    else selectedMessageKeys.delete(key);

    messageEl.classList.toggle('is-selected', selected);
    onSelectionChange?.(selectedMessageKeys.size);
}

export function removeMessagesFromDom({ messageIds = [], clientIds = [] } = {}) {
    const idSet = new Set((messageIds || []).filter(Boolean));
    const clientSet = new Set((clientIds || []).filter(Boolean));

    document.querySelectorAll('.message').forEach((el) => {
        const messageId = el.dataset.messageId;
        const clientId = el.dataset.clientId;
        if ((messageId && idSet.has(messageId)) || (clientId && clientSet.has(clientId))) {
            if (messageId) selectedMessageKeys.delete(messageId);
            if (clientId) selectedMessageKeys.delete(clientId);
            el.remove();
        }
    });

    const container = document.getElementById('messageContainer');
    if (container && !container.querySelector('.message')) {
        const placeholder = document.createElement('div');
        placeholder.dataset.emptyChat = 'true';
        placeholder.style.cssText = 'text-align:center; color:var(--text-muted); margin-top:50px; font-size:0.9rem;';
        placeholder.textContent = 'Henüz mesaj yok. İlk mesajı sen gönder!';
        container.appendChild(placeholder);
    }
}

export function getPendingQuote() {
    return pendingQuote;
}

export function setPendingQuote(quote) {
    pendingQuote = quote;
    pendingEdit = null;
    renderEditComposerBar();
    syncComposerActionButton();
    renderQuoteComposerBar();
}

export function clearPendingQuote() {
    pendingQuote = null;
    renderQuoteComposerBar();
}

export function getPendingEdit() {
    return pendingEdit;
}

export function clearPendingEdit() {
    pendingEdit = null;
    renderEditComposerBar();
    syncComposerActionButton();
}

export function setPendingEdit(edit) {
    pendingEdit = edit;
    pendingQuote = null;
    renderQuoteComposerBar();
    renderEditComposerBar();
    syncComposerActionButton();
}

function syncComposerActionButton() {
    const btn = document.querySelector('#messageInputArea .send-btn');
    if (!btn) return;
    btn.textContent = pendingEdit ? 'Kaydet' : 'Gönder';
}

export function applyMessageEditInDom({ messageId, clientId, body, editedAt }) {
    const messageEl = findMessageElement({ messageId, clientId });
    if (!messageEl) return;

    const bodyEl = messageEl.querySelector('.message-body');
    if (bodyEl) {
        bodyEl.replaceChildren();
        appendTextWithLinks(bodyEl, body || '');
    }

    const metaEl = messageEl.querySelector('.message-meta');
    if (metaEl) {
        const baseTime = (metaEl.textContent || '').split(' · ')[0].trim();
        metaEl.textContent = editedAt ? `${baseTime} · düzenlendi` : baseTime;
    }

    if (editedAt) messageEl.dataset.editedAt = editedAt;
}

export function serializeQuote(quote) {
    if (!quote) return null;
    return {
        message_id: quote.messageId || quote.message_id || null,
        client_id: quote.clientId || quote.client_id || null,
        sender_id: quote.senderId || quote.sender_id || null,
        sender_name: quote.sender || quote.sender_name || 'Kullanıcı',
        body: quote.body || '',
        content_type: quote.contentType || quote.content_type || 'text',
        media_url: quote.mediaUrl || quote.media_url || null
    };
}

export function aggregateReactions(rows, currentUserId) {
    const byMessage = new Map();

    for (const row of rows || []) {
        if (!byMessage.has(row.message_id)) {
            byMessage.set(row.message_id, new Map());
        }
        const emojiMap = byMessage.get(row.message_id);
        if (!emojiMap.has(row.emoji)) {
            emojiMap.set(row.emoji, { emoji: row.emoji, count: 0, mine: false });
        }
        const entry = emojiMap.get(row.emoji);
        entry.count += 1;
        if (row.user_id === currentUserId) entry.mine = true;
    }

    return byMessage;
}

export function reactionsMapToList(emojiMap) {
    if (!emojiMap) return [];
    return [...emojiMap.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}

export function setMessageDbIdByClientId(clientId, messageId) {
    if (!clientId || !messageId) return;
    const el = document.querySelector(`.message[data-client-id="${CSS.escape(clientId)}"]`);
    if (el) el.dataset.messageId = messageId;
}

export function findMessageElement({ messageId, clientId }) {
    if (messageId) {
        const byId = document.querySelector(`.message[data-message-id="${CSS.escape(messageId)}"]`);
        if (byId) return byId;
    }
    if (clientId) {
        return document.querySelector(`.message[data-client-id="${CSS.escape(clientId)}"]`);
    }
    return null;
}

function highlightQuotedMessage(messageEl) {
    messageEl.classList.remove('message--quote-highlight');
    void messageEl.offsetWidth;
    messageEl.classList.add('message--quote-highlight');
    window.setTimeout(() => {
        messageEl.classList.remove('message--quote-highlight');
    }, 1200);
}

export function scrollToQuotedMessage({ messageId, clientId } = {}) {
    const target = findMessageElement({ messageId, clientId });
    if (!target) {
        onShowNotify?.('Alıntılanan mesaj bu sohbette görünmüyor.', {
            title: 'Alıntı',
            type: 'warning'
        });
        return false;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightQuotedMessage(target);
    return true;
}

export function updateMessageReactions(messageEl, reactionList) {
    if (!messageEl) return;

    let bar = messageEl.querySelector('.message-reactions');
    if (!reactionList?.length) {
        bar?.remove();
        return;
    }

    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'message-reactions';
        messageEl.appendChild(bar);
    }

    bar.replaceChildren();
    for (const item of reactionList) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `message-reaction-pill${item.mine ? ' mine' : ''}`;
        pill.dataset.emoji = item.emoji;
        pill.title = `${item.count} tepki`;
        fillReactionPill(pill, item.emoji, item.count);
        pill.addEventListener('click', (event) => {
            event.stopPropagation();
            handleReactionPick(messageEl, item.emoji);
        });
        bar.appendChild(pill);
    }
}

function getMessageReactionState(messageEl) {
    const state = new Map();
    messageEl.querySelectorAll('.message-reaction-pill').forEach((pill) => {
        const emoji = pill.dataset.emoji;
        const count = Number.parseInt(pill.querySelector('.message-reaction-count')?.textContent || '0', 10);
        state.set(emoji, {
            emoji,
            count,
            mine: pill.classList.contains('mine')
        });
    });
    return state;
}

function applyLocalReaction(messageEl, { emoji, userId, action, currentUserId }) {
    const state = getMessageReactionState(messageEl);
    const isMe = userId === currentUserId;

    if (action === 'remove') {
        if (!state.has(emoji)) return;
        const entry = { ...state.get(emoji) };
        entry.count = Math.max(0, entry.count - 1);
        if (isMe) entry.mine = false;
        if (entry.count <= 0) state.delete(emoji);
        else state.set(emoji, entry);
    } else {
        for (const [key, entry] of [...state.entries()]) {
            if (entry.mine && isMe && key !== emoji) {
                const next = { ...entry, count: entry.count - 1, mine: false };
                if (next.count <= 0) state.delete(key);
                else state.set(key, next);
            }
        }
        const existing = state.get(emoji) || { emoji, count: 0, mine: false };
        existing.count += 1;
        if (isMe) existing.mine = true;
        state.set(emoji, existing);
    }

    updateMessageReactions(messageEl, reactionsMapToList(state));
}

export function handleIncomingReaction(payload, currentUserId) {
    const messageEl = findMessageElement({
        messageId: payload.message_id,
        clientId: payload.client_id
    });
    if (!messageEl) return;

    applyLocalReaction(messageEl, {
        emoji: payload.emoji,
        userId: payload.user_id,
        action: payload.action,
        currentUserId
    });
}

function handleReactionPick(messageEl, emoji) {
    const ctx = getAuthContext?.();
    if (!ctx?.isLoggedIn?.()) {
        ctx?.promptLogin?.();
        return;
    }

    onToggleReaction?.({
        messageId: messageEl.dataset.messageId || null,
        clientId: messageEl.dataset.clientId || null,
        emoji
    });
}

function closeContextMenu() {
    if (!activeContextMenu) return;
    activeContextMenu.hidden = true;
    activeContextMenu.replaceChildren();
    contextMenuTarget = null;
    contextMenuIsOpen = false;
}

function ensureContextMenu() {
    if (activeContextMenu) return activeContextMenu;

    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    activeContextMenu = menu;
    return menu;
}

function isContextMenuTargetIgnored(target) {
    return !!target?.closest?.('.message-context-menu');
}

function resolveMessageElForContextMenu(event) {
    if (!boundMessageContainer || boundMessageContainer.hidden) return null;

    const ignored = isContextMenuTargetIgnored(event.target);
    if (ignored) return null;

    const direct = event.target?.closest?.('.message');
    if (direct && boundMessageContainer.contains(direct)) return direct;

    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;

    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (const el of stack) {
        if (!boundMessageContainer.contains(el)) continue;
        const messageEl = el.closest?.('.message');
        if (messageEl && boundMessageContainer.contains(messageEl)) return messageEl;
    }

    return null;
}

function canDismissContextMenu() {
    return contextMenuIsOpen && Date.now() >= contextMenuDismissUntil;
}

function handleMessageContextMenu(event) {
    const messageEl = resolveMessageElForContextMenu(event);
    if (!messageEl) return;

    event.preventDefault();
    event.stopPropagation();

    if (suppressNativeContextMenu) {
        suppressNativeContextMenu = false;
        if (!contextMenuIsOpen) {
            showContextMenuForMessage(messageEl, event.clientX, event.clientY);
        }
        return;
    }

    showContextMenuForMessage(messageEl, event.clientX, event.clientY);
}

export function extractMessagePayload(messageEl) {
    if (!messageEl) return null;

    const bodyEl = messageEl.querySelector('.message-body');
    const isOutgoing = messageEl.classList.contains('outgoing');
    const senderEl = messageEl.querySelector('.message-sender');
    const contentType = messageEl.dataset.contentType || 'text';
    const mediaHost = messageEl.querySelector('.message-media');

    return {
        body: bodyEl?.textContent?.trim() || '',
        contentType,
        mediaUrl: messageEl.dataset.mediaUrl || mediaHost?.dataset.mediaSrc || null,
        mediaR2Key: messageEl.dataset.mediaR2Key || mediaHost?.dataset.mediaR2Key || null,
        sender: isOutgoing ? 'Ben' : (senderEl?.textContent?.replace(/^@/, '') || 'Kullanıcı')
    };
}

async function copyMessageText(messageEl) {
    const text = getMessageCopyText(messageEl);
    if (!text) {
        showToast('Kopyalanacak metin bulunamadı.', { type: 'warning' });
        return;
    }

    try {
        await navigator.clipboard.writeText(text);
        showToast('Panoya kopyalandı.', { type: 'success' });
    } catch {
        showToast('Kopyalama başarısız oldu.', { type: 'error' });
    }
}

function getMessageCopyText(messageEl) {
    const body = messageEl.querySelector('.message-body')?.textContent?.trim();
    if (body) return body;

    const contentType = messageEl.dataset.contentType;
    if (contentType === 'audio') return '🎤 Ses kaydı';
    if (contentType === 'image') return '📷 Görsel';
    if (contentType === 'video') return '🎬 Video';

    const quoteBody = messageEl.querySelector('.message-quote-body')?.textContent?.trim();
    if (quoteBody) return quoteBody;

    return '';
}

function extensionForDownload(contentType, mimeType = '') {
    const mime = (mimeType || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('quicktime')) return 'mov';
    if (mime.includes('mpeg')) return 'mp3';
    if (mime.includes('m4a') || mime.includes('mp4')) return 'm4a';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('wav')) return 'wav';

    const map = { image: 'jpg', video: 'mp4', audio: 'webm' };
    return map[contentType] || 'bin';
}

function getMessageMediaSrc(messageEl) {
    const contentType = messageEl.dataset.contentType;
    if (!contentType || contentType === 'text') return null;

    const fromDataset = messageEl.dataset.mediaUrl;
    if (fromDataset) return displayMediaUrl(fromDataset) || fromDataset;

    const audioEl = messageEl.querySelector('.voice-message audio');
    if (audioEl?.src) return audioEl.src;

    const imgEl = messageEl.querySelector('.media-thumb, .message-media img');
    if (imgEl?.src) return imgEl.src;

    const videoEl = messageEl.querySelector('.media-thumb video, .message-media video');
    if (videoEl?.src) return videoEl.src;

    return null;
}

function triggerFileDownload(url, filename) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

async function downloadMessage(messageEl) {
    const contentType = messageEl.dataset.contentType || 'text';
    const mediaSrc = getMessageMediaSrc(messageEl);

    if (!mediaSrc) return;

    try {
        const response = await fetch(mediaSrc);
        if (!response.ok) throw new Error('fetch failed');
        const blob = await response.blob();
        const ext = extensionForDownload(contentType, blob.type);
        const objectUrl = URL.createObjectURL(blob);
        triggerFileDownload(objectUrl, `woxifly-${contentType}-${Date.now()}.${ext}`);
        URL.revokeObjectURL(objectUrl);
        onShowNotify?.('Dosya indirildi.', { title: 'İndir', type: 'success' });
    } catch {
        triggerFileDownload(mediaSrc, `woxifly-${contentType}-${Date.now()}.${extensionForDownload(contentType)}`);
        onShowNotify?.('İndirme başlatıldı.', { title: 'İndir', type: 'info' });
    }
}

function positionContextMenu(menu, messageEl, clientX, clientY) {
    menu.hidden = false;
    menu.removeAttribute('hidden');
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    menu.style.left = '0';
    menu.style.top = '0';

    const menuRect = menu.getBoundingClientRect();
    const msgRect = messageEl.getBoundingClientRect();
    const padding = 10;

    let left = Number.isFinite(clientX) ? clientX : msgRect.left + msgRect.width / 2 - menuRect.width / 2;
    let top = Number.isFinite(clientY) ? clientY : msgRect.top - menuRect.height - padding;

    if (top < padding) {
        top = msgRect.bottom + padding;
    }

    left = Math.max(padding, Math.min(left, window.innerWidth - menuRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - menuRect.height - padding));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = 'visible';
}

function createContextMenuItem({ icon, label, danger = false, onClick }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `message-context-item${danger ? ' message-context-item--danger' : ''}`;
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = `<span class="message-context-icon" aria-hidden="true">${icon}</span><span class="message-context-label">${label}</span>`;
    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
        closeActiveActions();
    });
    return btn;
}

function appendContextDivider(menu) {
    menu.appendChild(document.createElement('div')).className = 'message-context-divider';
}

function canEditMessage(messageEl) {
    if (!messageEl?.classList.contains('outgoing')) return false;
    const contentType = messageEl.dataset.contentType || 'text';
    if (contentType !== 'text') return false;
    return !!messageEl.querySelector('.message-body');
}

function startEditMessage(messageEl) {
    const ctx = getAuthContext?.();
    if (!ctx?.isLoggedIn?.()) {
        ctx?.promptLogin?.();
        return;
    }

    const body = messageEl.querySelector('.message-body')?.textContent || '';
    setPendingEdit({
        messageId: messageEl.dataset.messageId || null,
        clientId: messageEl.dataset.clientId || null,
        originalBody: body
    });

    const input = document.getElementById('messageInput');
    if (input) {
        input.value = body;
        resizeMessageInput(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

function renderEditComposerBar() {
    const slot = document.getElementById('editComposerSlot');
    if (!slot) return;

    slot.replaceChildren();
    if (!pendingEdit) return;

    const bar = document.createElement('div');
    bar.id = 'editComposerBar';
    bar.className = 'quote-composer-bar edit-composer-bar';

    const accent = document.createElement('div');
    accent.className = 'quote-composer-accent';

    const content = document.createElement('div');
    content.className = 'quote-composer-content';

    const author = document.createElement('div');
    author.className = 'quote-composer-author';
    author.textContent = 'Mesajı düzenle';

    const preview = document.createElement('div');
    preview.className = 'quote-composer-preview';
    preview.textContent = 'Değişiklikleri kaydetmek için Kaydet\'e basın.';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'quote-composer-close';
    closeBtn.setAttribute('aria-label', 'Düzenlemeyi iptal et');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
        clearPendingEdit();
        const input = document.getElementById('messageInput');
        if (input) {
            input.value = '';
            resizeMessageInput(input);
        }
    });

    content.append(author, preview);
    bar.append(accent, content, closeBtn);
    slot.appendChild(bar);
}

function showContextMenuForMessage(messageEl, clientX, clientY) {
    contextMenuDismissUntil = Date.now() + 500;

    const ctx = getAuthContext?.();
    const menu = ensureContextMenu();
    contextMenuTarget = messageEl;
    menu.replaceChildren();

    const reactions = document.createElement('div');
    reactions.className = 'message-context-reactions';
    reactions.setAttribute('role', 'group');
    reactions.setAttribute('aria-label', 'Hızlı tepkiler');

    for (const emoji of QUICK_EMOJIS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'message-context-emoji';
        btn.textContent = emoji;
        btn.title = `${emoji} ile tepki ver`;
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            handleReactionPick(messageEl, emoji);
            closeActiveActions();
        });
        reactions.appendChild(btn);
    }
    menu.appendChild(reactions);
    appendContextDivider(menu);

    menu.appendChild(createContextMenuItem({
        icon: '↩',
        label: 'Yanıtla',
        onClick: () => {
            if (!ctx?.isLoggedIn?.()) {
                ctx?.promptLogin?.();
                return;
            }
            startReplyToMessage(messageEl);
        }
    }));

    menu.appendChild(createContextMenuItem({
        icon: '↪',
        label: 'İlet',
        onClick: () => {
            if (!ctx?.isLoggedIn?.()) {
                ctx?.promptLogin?.();
                return;
            }
            onForwardMessage?.(extractMessagePayload(messageEl));
        }
    }));

    if (canEditMessage(messageEl)) {
        menu.appendChild(createContextMenuItem({
            icon: '✎',
            label: 'Düzenle',
            onClick: () => {
                if (!ctx?.isLoggedIn?.()) {
                    ctx?.promptLogin?.();
                    return;
                }
                startEditMessage(messageEl);
            }
        }));
    }

    appendContextDivider(menu);

    menu.appendChild(createContextMenuItem({
        icon: '🗑',
        label: 'Benden sil',
        danger: true,
        onClick: () => {
            if (!ctx?.isLoggedIn?.()) {
                ctx?.promptLogin?.();
                return;
            }
            onDeleteMessages?.([{
                messageId: messageEl.dataset.messageId || null,
                clientId: messageEl.dataset.clientId || null
            }], 'me');
        }
    }));

    if (messageEl.classList.contains('outgoing')) {
        menu.appendChild(createContextMenuItem({
            icon: '🗑',
            label: 'Herkesten sil',
            danger: true,
            onClick: () => {
                if (!ctx?.isLoggedIn?.()) {
                    ctx?.promptLogin?.();
                    return;
                }
                onDeleteMessages?.([{
                    messageId: messageEl.dataset.messageId || null,
                    clientId: messageEl.dataset.clientId || null
                }], 'everyone');
            }
        }));
    }

    appendContextDivider(menu);

    menu.appendChild(createContextMenuItem({
        icon: '☑',
        label: 'Seç',
        onClick: () => {
            if (!ctx?.isLoggedIn?.()) {
                ctx?.promptLogin?.();
                return;
            }
            enterSelectionMode({
                messageContainer: messageEl.closest('#messageContainer'),
                initialMessageEl: messageEl
            });
        }
    }));

    if (getMessageMediaSrc(messageEl)) {
        menu.appendChild(createContextMenuItem({
            icon: '⬇',
            label: 'İndir',
            onClick: () => {
                downloadMessage(messageEl);
            }
        }));
    }

    menu.appendChild(createContextMenuItem({
        icon: '📋',
        label: 'Kopyala',
        onClick: () => {
            copyMessageText(messageEl);
        }
    }));

    positionContextMenu(menu, messageEl, clientX, clientY);
    contextMenuIsOpen = true;
    contextMenuDismissUntil = Date.now() + 500;

    if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch { /* ignore */ }
    }
}

function closeActiveActions() {
    closeContextMenu();
}

function startReplyToMessage(messageEl) {
    const ctx = getAuthContext?.();
    if (!ctx?.isLoggedIn?.()) {
        ctx?.promptLogin?.();
        return;
    }

    const senderEl = messageEl.querySelector('.message-sender');
    const bodyEl = messageEl.querySelector('.message-body');
    const isOutgoing = messageEl.classList.contains('outgoing');
    const viewer = getViewerContext?.() || {};

    setPendingQuote({
        messageId: messageEl.dataset.messageId || null,
        clientId: messageEl.dataset.clientId || null,
        senderId: isOutgoing ? viewer.userId : (messageEl.dataset.senderId || null),
        sender: isOutgoing ? 'Ben' : (senderEl?.textContent?.replace(/^@/, '') || 'Kullanıcı'),
        body: bodyEl?.textContent || '',
        contentType: messageEl.dataset.contentType || 'text',
        mediaUrl: messageEl.dataset.mediaUrl || null
    });

    document.getElementById('messageInput')?.focus();
}

function renderQuoteComposerBar() {
    const slot = document.getElementById('quoteComposerSlot');
    if (!slot) return;

    slot.replaceChildren();
    if (!pendingQuote) return;

    const bar = document.createElement('div');
    bar.id = 'quoteComposerBar';
    bar.className = 'quote-composer-bar';

    const accent = document.createElement('div');
    accent.className = 'quote-composer-accent';

    const content = document.createElement('div');
    content.className = 'quote-composer-content';

    const author = document.createElement('div');
    author.className = 'quote-composer-author';

    const preview = document.createElement('div');
    preview.className = 'quote-composer-preview';
    preview.textContent = formatQuotePreview(pendingQuote);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'quote-composer-close';
    closeBtn.setAttribute('aria-label', 'Alıntıyı kaldır');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => clearPendingQuote());

    const viewer = getViewerContext?.() || {};
    if (viewer.showQuoteAuthor !== false) {
        author.textContent = formatQuoteAuthorLabel(pendingQuote, viewer);
        content.append(author, preview);
    } else {
        content.append(preview);
    }
    bar.append(accent, content, closeBtn);

    const quoteMessageId = pendingQuote.messageId || pendingQuote.message_id || null;
    const quoteClientId = pendingQuote.clientId || pendingQuote.client_id || null;
    if (quoteMessageId || quoteClientId) {
        bar.classList.add('quote-composer-bar--navigable');
        bar.title = 'Alıntılanan mesaja git';
        if (quoteMessageId) bar.dataset.quoteMessageId = quoteMessageId;
        if (quoteClientId) bar.dataset.quoteClientId = quoteClientId;
    }

    slot.appendChild(bar);
}

export function initMessageInteractions({
    messageContainer,
    isLoggedIn,
    promptLogin,
    getViewerContext: getViewerContextHandler,
    onReactionToggle,
    onDeleteMessages: onDeleteMessagesHandler,
    onSelectionChange: onSelectionChangeHandler,
    onForwardMessage: onForwardMessageHandler,
    showNotify
}) {
    if (!messageContainer) return;

    getAuthContext = () => ({ isLoggedIn, promptLogin });
    if (getViewerContextHandler) getViewerContext = getViewerContextHandler;
    onToggleReaction = onReactionToggle;
    onDeleteMessages = onDeleteMessagesHandler;
    onSelectionChange = onSelectionChangeHandler;
    onForwardMessage = onForwardMessageHandler;
    onShowNotify = showNotify;
    boundMessageContainer = messageContainer;

    let longPressTimer = null;
    let longPressX = 0;
    let longPressY = 0;

    document.addEventListener('contextmenu', handleMessageContextMenu, true);

    messageContainer.addEventListener('scroll', () => {
        if (contextMenuIsOpen) closeActiveActions();
    }, { passive: true });

    const quoteComposerSlot = document.getElementById('quoteComposerSlot');
    quoteComposerSlot?.addEventListener('click', (event) => {
        if (event.target.closest('.quote-composer-close')) return;
        const bar = event.target.closest('.quote-composer-bar--navigable');
        if (!bar) return;
        event.preventDefault();
        scrollToQuotedMessage({
            messageId: bar.dataset.quoteMessageId || null,
            clientId: bar.dataset.quoteClientId || null
        });
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !pendingEdit) return;
        const input = document.getElementById('messageInput');
        if (document.activeElement !== input) return;
        event.preventDefault();
        clearPendingEdit();
        if (input) {
            input.value = '';
            resizeMessageInput(input);
        }
    });

    messageContainer.addEventListener('click', (event) => {
        if (event.target.closest('.message-context-menu')) return;

        if (selectionMode) {
            const messageEl = event.target.closest('.message');
            if (messageEl && !event.target.closest('.message-select-checkbox')) {
                event.stopPropagation();
                const checkbox = messageEl.querySelector('.message-select-checkbox');
                const next = !messageEl.classList.contains('is-selected');
                if (checkbox) checkbox.checked = next;
                toggleMessageSelection(messageEl, next);
            }
            return;
        }

        const toggleBtn = event.target.closest('.message-side-toggle');
        if (toggleBtn) {
            event.preventDefault();
            event.stopPropagation();
            const messageEl = toggleBtn.closest('.message');
            if (messageEl) {
                const rect = toggleBtn.getBoundingClientRect();
                showContextMenuForMessage(messageEl, rect.left, rect.bottom + 6);
            }
            return;
        }

        const quoteNav = event.target.closest('.message-quote--navigable');
        if (quoteNav) {
            event.preventDefault();
            event.stopPropagation();
            scrollToQuotedMessage({
                messageId: quoteNav.dataset.quoteMessageId || null,
                clientId: quoteNav.dataset.quoteClientId || null
            });
            return;
        }

        if (!event.target.closest('.message')) {
            closeActiveActions();
        }
    });

    document.addEventListener('pointerdown', (event) => {
        if (!canDismissContextMenu()) return;
        if (event.button !== 0) return;
        if (event.target.closest('.message-context-menu')) return;
        if (event.target.closest('.message-side-toggle')) return;
        closeActiveActions();
    }, true);

    document.addEventListener('scroll', (event) => {
        if (!contextMenuIsOpen) return;
        if (event.target === messageContainer || messageContainer.contains(event.target)) return;
        closeActiveActions();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeActiveActions();
    });

    messageContainer.addEventListener('touchstart', (event) => {
        const messageEl = resolveMessageElForContextMenu({
            target: event.target,
            clientX: event.touches?.[0]?.clientX ?? event.changedTouches?.[0]?.clientX,
            clientY: event.touches?.[0]?.clientY ?? event.changedTouches?.[0]?.clientY
        });
        if (!messageEl) return;

        const touch = event.changedTouches?.[0] || event.touches?.[0];
        longPressX = touch?.clientX ?? 0;
        longPressY = touch?.clientY ?? 0;

        longPressTimer = window.setTimeout(() => {
            suppressNativeContextMenu = true;
            showContextMenuForMessage(messageEl, longPressX, longPressY);
            longPressTimer = null;
        }, 380);
    }, { passive: true });

    const cancelLongPress = () => {
        if (longPressTimer) {
            window.clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    messageContainer.addEventListener('touchend', cancelLongPress);
    messageContainer.addEventListener('touchmove', cancelLongPress);
    messageContainer.addEventListener('touchcancel', cancelLongPress);
}

export function buildQuoteFromMessageData({
    sender,
    senderId,
    body,
    contentType,
    mediaUrl,
    messageId,
    clientId
}) {
    return {
        messageId: messageId || null,
        clientId: clientId || null,
        senderId: senderId || null,
        sender: sender || 'Kullanıcı',
        body: body || '',
        contentType: contentType || 'text',
        mediaUrl: mediaUrl || null
    };
}
