import { formatTime } from './utils.js';

const CLOUD_PAGE_SIZE = 50;

let deps = null;
let isCloudAdmin = false;
let activeConversationId = null;
let messagesBefore = null;
let messagesHasMore = false;
let conversations = [];
let searchTimer = null;

function el(id) {
    return document.getElementById(id);
}

function setStatus(text, isError = false) {
    const status = el('cloudStatus');
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('cloud-status--error', isError);
}

async function cloudFetch(action, params = {}) {
    const session = await deps.getSession();
    if (!session?.access_token) {
        throw new Error('Oturum gerekli.');
    }

    const query = new URLSearchParams({ action, ...params });
    const res = await fetch(`/api/cloud?${query.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error('Bulut API yanıtı geçersiz.');
    }

    const data = await res.json().catch(() => {
        throw new Error('Bulut API yanıtı okunamadı.');
    });

    if (!res.ok) {
        throw new Error(data.error || 'Bulut isteği başarısız.');
    }

    if (action === 'access' && data.allowed !== true) {
        throw new Error('Bulut YP erişimi yok.');
    }

    return data;
}

export function isCloudAdminUser() {
    return isCloudAdmin;
}

export async function refreshCloudAdminStatus() {
    if (!deps?.isLoggedIn()) {
        isCloudAdmin = false;
        deps?.onAdminStatusChange?.(false);
        return false;
    }

    try {
        await cloudFetch('access');
        isCloudAdmin = true;
    } catch (err) {
        isCloudAdmin = false;
        console.warn('[bulut] erişim reddedildi:', err.message);
    }

    deps?.onAdminStatusChange?.(isCloudAdmin);
    return isCloudAdmin;
}

function formatMessageBody(message) {
    const type = message.contentType || 'text';
    if (type === 'image') return '📷 Görsel';
    if (type === 'video') return '🎬 Video';
    if (type === 'audio') return '🎙️ Ses';
    return message.body || '';
}

function formatDateLabel(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay) return formatTime(iso);
    return date.toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderConversationList() {
    const list = el('cloudConversationList');
    if (!list) return;

    list.innerHTML = '';

    if (!conversations.length) {
        const empty = document.createElement('p');
        empty.className = 'cloud-empty';
        empty.textContent = 'Sohbet bulunamadı.';
        list.appendChild(empty);
        return;
    }

    for (const item of conversations) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cloud-conv-item' + (item.id === activeConversationId ? ' is-active' : '');
        btn.innerHTML = `
            <span class="cloud-conv-item__title">${escapeHtml(item.title)}</span>
            <span class="cloud-conv-item__meta">${escapeHtml(item.type === 'group' ? 'Grup' : 'Özel')} · ${escapeHtml(formatDateLabel(item.lastAt))}</span>
            <span class="cloud-conv-item__preview${item.previewDeleted ? ' cloud-conv-item__preview--deleted' : ''}">${escapeHtml(item.preview || '—')}</span>
        `;
        btn.addEventListener('click', () => {
            openConversation(item.id);
        });
        list.appendChild(btn);
    }
}

function renderMessages({ conversation, messages, prepend = false }) {
    const title = el('cloudThreadTitle');
    const meta = el('cloudThreadMeta');
    const thread = el('cloudMessageThread');
    const backBtn = el('cloudThreadBack');
    if (!title || !meta || !thread) return;

    title.textContent = conversation?.title || 'Sohbet';
    meta.textContent = conversation?.type === 'group'
        ? `${conversation.district || 'Grup'} · grup odası`
        : (conversation?.memberUsernames || []).join(' ↔ ') || 'Özel sohbet';

    if (!prepend) thread.innerHTML = '';

    if (!messages.length && !prepend) {
        const empty = document.createElement('p');
        empty.className = 'cloud-empty';
        empty.textContent = 'Bu sohbette mesaj yok.';
        thread.appendChild(empty);
    } else {
        const fragment = document.createDocumentFragment();
        for (const message of messages) {
            const isDeleted = !!message.deletedAt;
            const row = document.createElement('div');
            row.className = 'cloud-msg' + (isDeleted ? ' cloud-msg--deleted' : '');
            row.innerHTML = `
                <div class="cloud-msg__head">
                    <strong>${escapeHtml(message.senderName)}${message.receiverName ? ` → ${escapeHtml(message.receiverName)}` : ''}</strong>
                    <span>${escapeHtml(formatDateLabel(message.createdAt))}</span>
                </div>
                <div class="cloud-msg__body">${escapeHtml(formatMessageBody(message))}</div>
            `;
            fragment.appendChild(row);
        }

        if (prepend && thread.firstChild) {
            thread.insertBefore(fragment, thread.firstChild);
        } else {
            thread.appendChild(fragment);
        }
    }

    const panel = el('bulut-panel');
    panel?.classList.add('cloud-detail-open');
    backBtn?.removeAttribute('hidden');

    const loadOlderBtn = el('cloudLoadOlderBtn');
    if (loadOlderBtn) loadOlderBtn.hidden = !messagesHasMore;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function loadConversations() {
    const type = el('cloudTypeFilter')?.value || 'all';
    const q = el('cloudSearchInput')?.value?.trim() || '';
    setStatus('Sohbetler yükleniyor…');

    try {
        const data = await cloudFetch('conversations', { type, q, limit: '120' });
        conversations = data.conversations || [];
        renderConversationList();
        setStatus(conversations.length ? `${conversations.length} sohbet` : 'Sohbet yok');
    } catch (err) {
        conversations = [];
        renderConversationList();
        setStatus(err.message, true);
    }
}

async function loadMessages({ conversationId, before = null, prepend = false } = {}) {
    const params = {
        conversationId,
        limit: String(CLOUD_PAGE_SIZE)
    };
    if (before) params.before = before;

    setStatus(prepend ? 'Eski mesajlar yükleniyor…' : 'Mesajlar yükleniyor…');

    try {
        const data = await cloudFetch('messages', params);
        messagesHasMore = !!data.hasMore;
        if ((data.messages || []).length) {
            messagesBefore = data.messages[0].createdAt;
        }

        renderMessages({
            conversation: data.conversation,
            messages: data.messages || [],
            prepend
        });

        const count = el('cloudMessageThread')?.querySelectorAll('.cloud-msg').length || 0;
        setStatus(count ? `${count} mesaj gösteriliyor` : 'Mesaj yok');
    } catch (err) {
        if (!prepend) {
            const thread = el('cloudMessageThread');
            if (thread) thread.innerHTML = '';
        }
        setStatus(err.message, true);
    }
}

async function openConversation(conversationId) {
    activeConversationId = conversationId;
    messagesBefore = null;
    messagesHasMore = false;
    renderConversationList();

    const panel = el('bulut-panel');
    panel?.classList.add('cloud-detail-open');
    el('cloudThreadBack')?.removeAttribute('hidden');
    el('cloudThreadTitle').textContent = 'Yükleniyor…';
    el('cloudThreadMeta').textContent = '';
    el('cloudMessageThread').innerHTML = '';

    await loadMessages({ conversationId });
}

export async function openCloudPanel() {
    if (!deps?.isLoggedIn()) {
        deps?.promptLogin?.();
        return;
    }

    if (!isCloudAdmin) {
        const allowed = await refreshCloudAdminStatus();
        if (!allowed) {
            deps?.showNotify?.(
                'Bulut YP için yetkiniz yok. Vercel’de ADMIN_EMAILS veya MASTER_USER (giriş e-postanız) tanımlı olmalı; değişiklikten sonra yeniden deploy edin.',
                { title: 'Erişim reddedildi', type: 'warning' }
            );
            return;
        }
    }

    deps.switchView('bulut-panel');
    activeConversationId = null;
    messagesBefore = null;
    el('bulut-panel')?.classList.remove('cloud-detail-open');
    el('cloudMessageThread') && (el('cloudMessageThread').innerHTML = '');
    el('cloudThreadTitle') && (el('cloudThreadTitle').textContent = 'Sohbet seçin');
    el('cloudThreadMeta') && (el('cloudThreadMeta').textContent = 'Soldan bir yazışma seçerek içeriği görüntüleyin.');
    await loadConversations();
}

export function initCloudPanel(options) {
    deps = options;

    el('cloudTypeFilter')?.addEventListener('change', () => {
        loadConversations();
    });

    el('cloudSearchInput')?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadConversations(), 250);
    });

    el('cloudRefreshBtn')?.addEventListener('click', () => {
        if (activeConversationId) {
            loadMessages({ conversationId: activeConversationId });
        } else {
            loadConversations();
        }
    });

    el('cloudLoadOlderBtn')?.addEventListener('click', () => {
        if (!activeConversationId || !messagesHasMore || !messagesBefore) return;
        loadMessages({
            conversationId: activeConversationId,
            before: messagesBefore,
            prepend: true
        });
    });

    el('cloudThreadBack')?.addEventListener('click', () => {
        el('bulut-panel')?.classList.remove('cloud-detail-open');
    });
}

export function resetCloudPanel() {
    activeConversationId = null;
    conversations = [];
    isCloudAdmin = false;
}
