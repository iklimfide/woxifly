import { formatTime, appendTextWithLinks } from './utils.js';
import { resolveMessageMediaUrl } from './media/urls.js';
import { openViewer } from './media/viewer.js';

const CLOUD_PAGE_SIZE = 50;
const CLOUD_MEMBERS_PAGE_SIZE = 50;

let deps = null;
let isCloudAdmin = false;
let lastAdminError = null;
let activeCloudTab = 'chats';
let activeConversationId = null;
let messagesBefore = null;
let messagesHasMore = false;
let conversations = [];
let members = [];
let membersOffset = 0;
let membersHasMore = false;
let membersTotal = null;
let searchTimer = null;
let membersSearchTimer = null;

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
    const url = `/api/cloud?${query.toString()}`;
    const authHeader = { Authorization: `Bearer ${session.access_token}` };

    let res = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
            ...authHeader,
            'Content-Type': 'application/json'
        },
        body: '{}'
    });

    // Eski yerel sunucu / önbellekli dağıtımda POST reddedilirse erişim kontrolünü GET ile dene.
    if (res.status === 405 && action === 'access') {
        const probe = await res.clone().json().catch(() => ({}));
        const hint = String(probe.error || '').toLowerCase();
        if (hint.includes('get')) {
            res = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                headers: authHeader
            });
        }
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error('Bulut API yanıtı geçersiz. Yerelde npm run local kullanın; npm run static API çalıştırmaz.');
    }

    const data = await res.json().catch(() => {
        throw new Error('Bulut API yanıtı okunamadı.');
    });

    if (!res.ok) {
        const message = [data.error, data.hint].filter(Boolean).join(' ');
        throw new Error(message || 'Bulut isteği başarısız.');
    }

    if (action === 'access') {
        if (data.allowed !== true) {
            throw new Error('Bulut YP erişimi yok.');
        }
        if (data.userId !== session.user?.id) {
            throw new Error('Bulut YP erişimi doğrulanamadı.');
        }
    }

    return data;
}

export function isCloudAdminUser() {
    return isCloudAdmin;
}

export async function refreshCloudAdminStatus() {
    if (!deps) {
        return isCloudAdmin;
    }

    if (!deps.isLoggedIn()) {
        isCloudAdmin = false;
        deps.onAdminStatusChange?.(isCloudAdmin);
        return false;
    }

    try {
        await cloudFetch('access');
        isCloudAdmin = true;
        lastAdminError = null;
    } catch (err) {
        isCloudAdmin = false;
        lastAdminError = err.message || 'Bulut YP erişimi doğrulanamadı.';
        console.warn('[bulut] erişim reddedildi:', lastAdminError);
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

function setMembersStatus(text, isError = false) {
    const status = el('cloudMembersStatus');
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('cloud-status--error', isError);
}

function formatMemberDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('tr-TR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function memberInitial(username) {
    const value = String(username || '?').trim();
    return value ? value.charAt(0).toUpperCase() : '?';
}

function renderMembersList({ append = false } = {}) {
    const list = el('cloudMembersList');
    if (!list) return;

    if (!append) list.innerHTML = '';

    if (!members.length && !append) {
        const empty = document.createElement('p');
        empty.className = 'cloud-empty';
        empty.textContent = 'Üye bulunamadı.';
        list.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    const startIndex = append ? list.querySelectorAll('.cloud-member-item').length : 0;

    for (let i = startIndex; i < members.length; i++) {
        const member = members[i];
        const row = document.createElement('div');
        row.className = 'cloud-member-item';

        const avatar = member.avatarUrl
            ? `<img class="cloud-member-item__avatar" src="${escapeHtml(member.avatarUrl)}" alt="" loading="lazy">`
            : `<div class="cloud-member-item__avatar cloud-member-item__avatar--placeholder" aria-hidden="true">${escapeHtml(memberInitial(member.username))}</div>`;

        const visibilityBadge = member.isVisible
            ? ''
            : '<span class="cloud-member-item__badge cloud-member-item__badge--hidden">Gizli</span>';

        row.innerHTML = `
            ${avatar}
            <div class="cloud-member-item__body">
                <div class="cloud-member-item__title">
                    <span>${escapeHtml(member.username)}</span>
                    ${visibilityBadge}
                </div>
                <span class="cloud-member-item__meta">${escapeHtml(member.location)} · ${escapeHtml(formatMemberDate(member.createdAt))}</span>
                ${member.email ? `<span class="cloud-member-item__email">${escapeHtml(member.email)}</span>` : ''}
            </div>
        `;
        fragment.appendChild(row);
    }

    list.appendChild(fragment);

    const loadMoreBtn = el('cloudLoadMoreMembersBtn');
    if (loadMoreBtn) loadMoreBtn.hidden = !membersHasMore;
}

async function loadMembers({ append = false } = {}) {
    const q = el('cloudMembersSearchInput')?.value?.trim() || '';
    const offset = append ? membersOffset : 0;

    setMembersStatus(append ? 'Daha fazla üye yükleniyor…' : 'Üyeler yükleniyor…');

    try {
        const data = await cloudFetch('members', {
            q,
            limit: String(CLOUD_MEMBERS_PAGE_SIZE),
            offset: String(offset)
        });

        const batch = data.members || [];
        members = append ? members.concat(batch) : batch;
        membersOffset = members.length;
        membersHasMore = !!data.hasMore;
        membersTotal = typeof data.total === 'number' ? data.total : null;

        renderMembersList({ append });

        const totalLabel = membersTotal != null ? `${members.length} / ${membersTotal} üye` : `${members.length} üye`;
        setMembersStatus(members.length ? totalLabel : 'Üye yok');
    } catch (err) {
        if (!append) {
            members = [];
            renderMembersList();
        }
        setMembersStatus(err.message, true);
    }
}

function switchCloudTab(tab) {
    activeCloudTab = tab === 'members' ? 'members' : 'chats';

    const chatsView = el('cloudChatsView');
    const membersView = el('cloudMembersView');
    const tabChats = el('cloudTabChats');
    const tabMembers = el('cloudTabMembers');
    const panel = el('bulut-panel');

    const isMembers = activeCloudTab === 'members';

    chatsView?.toggleAttribute('hidden', isMembers);
    membersView?.toggleAttribute('hidden', !isMembers);

    tabChats?.classList.toggle('is-active', !isMembers);
    tabMembers?.classList.toggle('is-active', isMembers);
    tabChats?.setAttribute('aria-selected', String(!isMembers));
    tabMembers?.setAttribute('aria-selected', String(isMembers));

    if (isMembers) {
        panel?.classList.remove('cloud-detail-open');
        if (!members.length) {
            void loadMembers();
        }
    }
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
            <span class="cloud-conv-item__meta">${escapeHtml(formatDateLabel(item.lastAt))}</span>
            <span class="cloud-conv-item__preview${item.previewDeleted ? ' cloud-conv-item__preview--deleted' : ''}">${escapeHtml(item.preview || '—')}</span>
        `;
        btn.addEventListener('click', () => {
            openConversation(item.id);
        });
        list.appendChild(btn);
    }
}

function createCloudMessageRow(message) {
    const isDeleted = !!message.deletedAt;
    const row = document.createElement('div');
    row.className = 'cloud-msg' + (isDeleted ? ' cloud-msg--deleted' : '');

    const head = document.createElement('div');
    head.className = 'cloud-msg__head';

    const sender = document.createElement('strong');
    sender.textContent = message.senderName || 'Kullanıcı';
    if (message.receiverName) {
        sender.textContent += ` → ${message.receiverName}`;
    }

    const time = document.createElement('span');
    time.textContent = formatDateLabel(message.createdAt);

    head.append(sender, time);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'cloud-msg__body';

    if (isDeleted) {
        appendCloudMessageText(bodyWrap, message);
        row.append(head, bodyWrap);
        return row;
    }

    const contentType = message.contentType || 'text';
    const mediaSrc = resolveMessageMediaUrl(message.mediaUrl, message.r2Key);
    const caption = (message.body || '').trim();

    if (contentType === 'image' && mediaSrc) {
        bodyWrap.appendChild(createCloudMediaThumb(mediaSrc, 'image'));
        if (caption) bodyWrap.appendChild(createCloudCaption(caption));
    } else if (contentType === 'video' && mediaSrc) {
        bodyWrap.appendChild(createCloudMediaThumb(mediaSrc, 'video'));
        if (caption) bodyWrap.appendChild(createCloudCaption(caption));
    } else if (contentType === 'audio' && mediaSrc) {
        const audio = document.createElement('audio');
        audio.className = 'cloud-msg__audio';
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = mediaSrc;
        bodyWrap.appendChild(audio);
        if (caption) bodyWrap.appendChild(createCloudCaption(caption));
    } else {
        appendCloudMessageText(bodyWrap, message);
    }

    row.append(head, bodyWrap);
    return row;
}

function appendCloudMessageText(parent, message) {
    const text = (message.body || '').trim();
    if (text) {
        appendTextWithLinks(parent, text);
        return;
    }
    parent.textContent = formatMessageBody(message);
}

function createCloudCaption(text) {
    const cap = document.createElement('p');
    cap.className = 'cloud-msg__caption';
    appendTextWithLinks(cap, text);
    return cap;
}

function createCloudMediaThumb(src, kind) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cloud-msg__media-thumb${kind === 'video' ? ' cloud-msg__media-thumb--video' : ''}`;
    btn.title = kind === 'video' ? 'Videoyu aç' : 'Görseli aç';

    if (kind === 'video') {
        const video = document.createElement('video');
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.setAttribute('aria-hidden', 'true');
        btn.appendChild(video);

        const playIcon = document.createElement('span');
        playIcon.className = 'cloud-msg__play-icon';
        playIcon.setAttribute('aria-hidden', 'true');
        playIcon.textContent = '▶';
        btn.appendChild(playIcon);
    } else {
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Görsel';
        img.loading = 'lazy';
        btn.appendChild(img);
    }

    btn.addEventListener('click', () => openViewer(src, kind));
    return btn;
}

function renderMessages({ conversation, messages, prepend = false }) {
    const title = el('cloudThreadTitle');
    const meta = el('cloudThreadMeta');
    const thread = el('cloudMessageThread');
    const backBtn = el('cloudThreadBack');
    if (!title || !meta || !thread) return;

    title.textContent = conversation?.title || 'Sohbet';
    meta.textContent = (conversation?.memberUsernames || []).join(' ↔ ') || 'Özel sohbet';

    if (!prepend) thread.innerHTML = '';

    if (!messages.length && !prepend) {
        const empty = document.createElement('p');
        empty.className = 'cloud-empty';
        empty.textContent = 'Bu sohbette mesaj yok.';
        thread.appendChild(empty);
    } else {
        const fragment = document.createDocumentFragment();
        for (const message of messages) {
            fragment.appendChild(createCloudMessageRow(message));
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
    const q = el('cloudSearchInput')?.value?.trim() || '';
    setStatus('Sohbetler yükleniyor…');

    try {
        const data = await cloudFetch('conversations', { q, limit: '120' });
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
                lastAdminError || 'Bulut YP erişimi doğrulanamadı.',
                { title: 'Erişim reddedildi', type: 'warning' }
            );
            return;
        }
    }

    deps.switchView('bulut-panel');
    activeCloudTab = 'chats';
    switchCloudTab('chats');
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

    document.querySelectorAll('[data-cloud-tab]').forEach((button) => {
        button.addEventListener('click', () => {
            switchCloudTab(button.dataset.cloudTab);
        });
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

    el('cloudMembersSearchInput')?.addEventListener('input', () => {
        clearTimeout(membersSearchTimer);
        membersSearchTimer = setTimeout(() => loadMembers(), 250);
    });

    el('cloudMembersRefreshBtn')?.addEventListener('click', () => {
        loadMembers();
    });

    el('cloudLoadMoreMembersBtn')?.addEventListener('click', () => {
        if (!membersHasMore) return;
        loadMembers({ append: true });
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
    activeCloudTab = 'chats';
    conversations = [];
    members = [];
    membersOffset = 0;
    membersHasMore = false;
    membersTotal = null;
    isCloudAdmin = false;
}
