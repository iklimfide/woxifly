import { supabase } from './supabase-client.js';
import { resolveAvatarMediaUrl, displayMediaUrl } from './media/urls.js';
import { closeTopbarMenus } from './topbar.js';

let deps = null;
let debounceTimer = null;
let activeQuery = '';

function el(id) {
    return document.getElementById(id);
}

function escapeIlike(value) {
    return String(value || '').replace(/[%_\\]/g, '\\$&');
}

function isInDmChat() {
    return deps?.getActiveChat?.()?.startsWith('User-') && !!deps?.getConversationId?.();
}

export function openSearchPanel() {
    if (!deps?.isLoggedIn?.()) {
        deps?.promptLogin?.();
        return;
    }

    const overlay = el('searchOverlay');
    const input = el('searchInput');
    if (!overlay || !input) return;

    closeTopbarMenus();
    overlay.hidden = false;
    document.body.classList.add('search-open');
    input.value = '';
    activeQuery = '';
    renderSearchHint();
    window.setTimeout(() => {
        input.focus();
        input.select();
    }, 50);
}

export function closeSearchPanel() {
    const overlay = el('searchOverlay');
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove('search-open');
    clearTimeout(debounceTimer);
}

function renderSearchHint() {
    const results = el('searchResults');
    if (!results) return;

    const inChat = isInDmChat();
    results.innerHTML = `
        <p class="search-hint">En az 2 karakter yazın.</p>
        <p class="search-hint search-hint--sub">Rumuz ile kişi arayabilirsiniz.${inChat ? ' Açık sohbette mesaj metni de aranır.' : ''}</p>
    `;
}

function renderSearchLoading() {
    const results = el('searchResults');
    if (!results) return;
    results.innerHTML = '<p class="search-hint">Aranıyor…</p>';
}

function renderSearchEmpty() {
    const results = el('searchResults');
    if (!results) return;
    results.innerHTML = '<p class="search-hint">Sonuç bulunamadı.</p>';
}

function createSection(title) {
    const section = document.createElement('section');
    section.className = 'search-section';

    const heading = document.createElement('h3');
    heading.className = 'search-section__title';
    heading.textContent = title;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'search-section__list';
    section.appendChild(list);
    return { section, list };
}

function createUserRow(profile) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result-item search-result-item--user';

    const avatar = document.createElement('div');
    avatar.className = 'search-result-item__avatar';
    const src = displayMediaUrl(resolveAvatarMediaUrl(profile.avatar_url, profile.avatar_r2_key));
    if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        avatar.appendChild(img);
    } else {
        avatar.textContent = (profile.username || '?').charAt(0).toUpperCase();
    }

    const body = document.createElement('div');
    body.className = 'search-result-item__body';
    const name = document.createElement('span');
    name.className = 'search-result-item__title';
    name.textContent = profile.username || 'Kullanıcı';
    const meta = document.createElement('span');
    meta.className = 'search-result-item__meta';
    meta.textContent = 'Kişi';
    body.append(name, meta);

    btn.append(avatar, body);
    btn.addEventListener('click', () => {
        closeSearchPanel();
        deps?.onOpenUser?.(profile.id, profile.username);
    });
    return btn;
}

function previewMessageBody(body, query) {
    const text = String(body || '').trim();
    if (!text) return 'Medya mesajı';
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const index = lower.indexOf(q);
    if (index === -1) {
        return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    }
    const start = Math.max(0, index - 24);
    const end = Math.min(text.length, index + q.length + 36);
    const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
    return snippet;
}

function createMessageRow(message, query) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result-item search-result-item--message';

    const icon = document.createElement('div');
    icon.className = 'search-result-item__avatar search-result-item__avatar--message';
    icon.textContent = '💬';

    const body = document.createElement('div');
    body.className = 'search-result-item__body';
    const title = document.createElement('span');
    title.className = 'search-result-item__title';
    title.textContent = previewMessageBody(message.body, query);
    const meta = document.createElement('span');
    meta.className = 'search-result-item__meta';
    const sender = message.sender_username || 'Kullanıcı';
    const time = message.created_at
        ? new Date(message.created_at).toLocaleString('tr-TR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        })
        : '';
    meta.textContent = `${sender}${time ? ` · ${time}` : ''}`;
    body.append(title, meta);

    btn.append(icon, body);
    btn.addEventListener('click', () => {
        void deps?.onJumpToMessage?.(message.id, message.created_at);
    });
    return btn;
}

async function searchUsers(query) {
    const currentUserId = deps?.getCurrentUserId?.();
    const term = escapeIlike(query);
    let profileQuery = supabase
        .from('profiles')
        .select('id, username, avatar_url, avatar_r2_key')
        .ilike('username', `%${term}%`)
        .order('username', { ascending: true })
        .limit(20);

    if (currentUserId) {
        profileQuery = profileQuery.neq('id', currentUserId);
    }

    const { data, error } = await profileQuery;
    if (error) throw error;

    return (data || []).filter((profile) => !deps?.isUserBlocked?.(profile.id));
}

async function searchMessagesInChat(query, conversationId) {
    const term = escapeIlike(query);
    const { data, error } = await supabase
        .from('messages')
        .select('id, body, created_at, sender_id, sender_username, content_type, deleted_at')
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .ilike('body', `%${term}%`)
        .order('created_at', { ascending: false })
        .limit(40);

    if (error) throw error;
    return data || [];
}

async function runSearch(query) {
    const results = el('searchResults');
    if (!results) return;

    if (query.length < 2) {
        renderSearchHint();
        return;
    }

    renderSearchLoading();

    try {
        const conversationId = isInDmChat() ? deps.getConversationId() : null;
        const [users, messages] = await Promise.all([
            searchUsers(query),
            conversationId ? searchMessagesInChat(query, conversationId) : Promise.resolve([])
        ]);

        if (query !== activeQuery) return;

        if (!users.length && !messages.length) {
            renderSearchEmpty();
            return;
        }

        const fragment = document.createDocumentFragment();

        if (users.length) {
            const { section, list } = createSection('Kişiler');
            for (const profile of users) {
                list.appendChild(createUserRow(profile));
            }
            fragment.appendChild(section);
        }

        if (messages.length) {
            const { section, list } = createSection('Bu sohbette');
            for (const message of messages) {
                list.appendChild(createMessageRow(message, query));
            }
            fragment.appendChild(section);
        }

        results.innerHTML = '';
        results.appendChild(fragment);
    } catch (err) {
        if (query !== activeQuery) return;
        results.innerHTML = `<p class="search-hint search-hint--error">${err.message || 'Arama başarısız.'}</p>`;
    }
}

function handleSearchInput() {
    const input = el('searchInput');
    if (!input) return;

    const query = input.value.trim();
    activeQuery = query;
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
        void runSearch(query);
    }, 280);
}

export function initSearchPanel(options) {
    deps = options;

    const overlay = el('searchOverlay');
    const input = el('searchInput');
    const closeBtn = el('searchCloseBtn');

    closeBtn?.addEventListener('click', closeSearchPanel);

    overlay?.addEventListener('click', (event) => {
        if (event.target === overlay) closeSearchPanel();
    });

    input?.addEventListener('input', handleSearchInput);
    input?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearchPanel();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !overlay?.hidden) {
            closeSearchPanel();
        }
    });
}
