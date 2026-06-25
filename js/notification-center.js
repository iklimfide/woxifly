import { closeTopbarMenus } from './topbar.js';

const STORAGE_KEY = 'woxifly_notifications';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

const items = [];
let onNavigate = null;
let storageKey = STORAGE_KEY;

function routeFromChatId(chatId) {
    if (chatId?.startsWith('User-')) {
        return { chatId, userId: chatId.replace('User-', '') };
    }
    return { chatId };
}

function notificationMergeKey({ chatId, senderId }) {
    if (senderId) return `sender:${senderId}`;
    if (chatId?.startsWith('User-')) return chatId;
    if (chatId) return chatId;
    return null;
}

function formatNotificationSubtitle({ count = 1 }) {
    return count > 1 ? `${count} yeni mesaj` : 'Yeni mesaj';
}

function applyNotificationSubtitle(item) {
    item.subtitle = formatNotificationSubtitle({ count: item.count });
}

function consolidateItemsByMergeKey() {
    const before = items.length;
    const merged = new Map();

    for (const item of items) {
        const mergeKey = item.mergeKey || notificationMergeKey({
            chatId: item.chatId,
            senderId: item.senderId
        });
        if (!mergeKey) continue;

        const existing = merged.get(mergeKey);
        if (!existing) {
            merged.set(mergeKey, {
                ...item,
                mergeKey,
                count: item.count || 1
            });
            continue;
        }

        existing.count = (existing.count || 1) + (item.count || 1);
        existing.read = existing.read && item.read;

        const existingTime = new Date(existing.createdAt).getTime();
        const itemTime = new Date(item.createdAt).getTime();
        if (itemTime >= existingTime) {
            existing.createdAt = item.createdAt;
            existing.chatId = item.chatId;
            existing.title = item.title || existing.title;
            existing.senderId = item.senderId || existing.senderId;
            existing.route = item.route || routeFromChatId(item.chatId);
            existing.lastMessageId = item.lastMessageId || existing.lastMessageId;
            existing.lastClientId = item.lastClientId || existing.lastClientId;
        }
        applyNotificationSubtitle(existing);
    }

    items.length = 0;
    items.push(
        ...Array.from(merged.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
    );

    if (items.length !== before) {
        persistItems();
    }
}

function formatTimeLabel(createdAt) {
    const date = new Date(createdAt);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();

    if (sameDay) {
        return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }

    return date.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function persistItems() {
    try {
        localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
        // Depolama doluysa sessizce geç
    }
}

function loadItems() {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        items.length = 0;
        parsed.forEach((item) => {
            if (!item?.id || !item?.chatId) return;
            const senderId = item.senderId || null;
            items.push({
                id: item.id,
                chatId: item.chatId,
                mergeKey: item.mergeKey || notificationMergeKey({ chatId: item.chatId, senderId }),
                senderId,
                title: item.title || 'Sohbet',
                count: item.count || 1,
                subtitle: item.subtitle || 'Yeni bildirim',
                createdAt: item.createdAt || new Date().toISOString(),
                readAt: item.readAt || null,
                read: !!item.read,
                lastMessageId: item.lastMessageId || null,
                lastClientId: item.lastClientId || null,
                route: item.route || routeFromChatId(item.chatId)
            });
        });
        items.forEach((item) => applyNotificationSubtitle(item));
    } catch {
        items.length = 0;
    }
}

function purgeExpiredItems() {
    const cutoff = Date.now() - RETENTION_MS;
    let changed = false;

    for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        const createdAt = new Date(item.createdAt).getTime();
        if (!Number.isFinite(createdAt) || createdAt < cutoff) {
            items.splice(i, 1);
            changed = true;
        }
    }

    if (changed) {
        persistItems();
    }
}

function removeMatchingNotifications({ messageIds = [], clientIds = [] } = {}) {
    const idSet = new Set((messageIds || []).filter(Boolean));
    const clientSet = new Set((clientIds || []).filter(Boolean));
    if (!idSet.size && !clientSet.size) return false;

    let changed = false;
    for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        const matchesMessage = item.lastMessageId && idSet.has(item.lastMessageId);
        const matchesClient = item.lastClientId && clientSet.has(item.lastClientId);
        if (matchesMessage || matchesClient) {
            items.splice(i, 1);
            changed = true;
        }
    }

    return changed;
}

function unreadCount() {
    return items
        .filter((item) => !item.read)
        .reduce((sum, item) => sum + (item.count || 1), 0);
}

function updateBadge() {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;

    const count = unreadCount();
    if (count < 1) {
        badge.hidden = true;
        badge.textContent = '';
        return;
    }

    badge.hidden = false;
    badge.textContent = count > 99 ? '99+' : String(count);
}

function hasUnreadItems() {
    return items.some((item) => !item.read);
}

function renderMenu() {
    const menu = document.getElementById('notificationDropdown');
    if (!menu) return;

    menu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'notification-dropdown-header';

    const title = document.createElement('span');
    title.className = 'notification-dropdown-title';
    title.textContent = 'Bildirimler';
    header.appendChild(title);

    const markAllBtn = document.createElement('button');
    markAllBtn.type = 'button';
    markAllBtn.className = 'notification-mark-all-btn';
    markAllBtn.textContent = 'Tümünü okundu yap';
    markAllBtn.disabled = !hasUnreadItems();
    markAllBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        markAllRead();
    });
    header.appendChild(markAllBtn);

    menu.appendChild(header);

    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.textContent = 'Henüz bildirim yok.';
        menu.appendChild(empty);
        return;
    }

    const list = document.createElement('div');
    list.className = 'notification-list';

    items.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `notification-item${item.read ? ' notification-item--read' : ' notification-item--unread'}`;
        row.dataset.id = item.id;

        const title = document.createElement('div');
        title.className = 'notification-item-title';
        title.textContent = item.title;

        const subtitle = document.createElement('div');
        subtitle.className = 'notification-item-subtitle';
        subtitle.textContent = item.subtitle;

        const time = document.createElement('div');
        time.className = 'notification-item-time';
        time.textContent = formatTimeLabel(item.createdAt);

        row.append(title, subtitle, time);
        row.addEventListener('click', (event) => {
            event.stopPropagation();
            handleItemClick(item);
        });
        list.appendChild(row);
    });

    menu.appendChild(list);
}

function closeNotificationMenu() {
    document.getElementById('notificationDropdown')?.classList.remove('show');
}

function markAllRead() {
    let changed = false;
    const now = new Date().toISOString();
    items.forEach((item) => {
        if (!item.read) {
            item.read = true;
            item.readAt = now;
            changed = true;
        }
    });

    if (!changed) return;

    persistItems();
    updateBadge();
    renderMenu();
}

function handleItemClick(item) {
    if (!item.read) {
        item.read = true;
        item.readAt = new Date().toISOString();
        persistItems();
        updateBadge();
    }

    closeNotificationMenu();
    closeTopbarMenus();
    onNavigate?.(item.route);
    renderMenu();
}

export function initNotificationCenter({ onNavigate: navigate, userId = null }) {
    onNavigate = navigate;
    storageKey = userId ? `${STORAGE_KEY}_${userId}` : `${STORAGE_KEY}_guest`;

    loadItems();
    consolidateItemsByMergeKey();
    purgeExpiredItems();

    const bellBtn = document.getElementById('notificationBellBtn');
    bellBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = document.getElementById('notificationDropdown');
        closeTopbarMenus();

        purgeExpiredItems();
        menu?.classList.toggle('show');
        if (menu?.classList.contains('show')) {
            renderMenu();
        }
    });

    renderMenu();
    updateBadge();

    window.setInterval(purgeExpiredItems, 60 * 60 * 1000);
}

export function setNotificationUser(userId) {
    const nextKey = userId ? `${STORAGE_KEY}_${userId}` : `${STORAGE_KEY}_guest`;
    if (nextKey === storageKey) {
        purgeExpiredItems();
        updateBadge();
        renderMenu();
        return;
    }

    storageKey = nextKey;
    items.length = 0;
    loadItems();
    consolidateItemsByMergeKey();
    purgeExpiredItems();
    updateBadge();
    renderMenu();
}

export function markAllNotificationsRead() {
    markAllRead();
}

export function closeNotificationDropdown() {
    closeNotificationMenu();
}

function isChatPanelActive() {
    return document.getElementById('chat-panel')?.classList.contains('active') === true;
}

export function shouldCaptureInAppNotification({
    viewingConversationId = null,
    messageConversationId = null
} = {}) {
    const viewingSameChat = isChatPanelActive()
        && viewingConversationId
        && messageConversationId
        && viewingConversationId === messageConversationId;
    if (!viewingSameChat) return true;
    if (document.hidden || !document.hasFocus()) return true;
    return false;
}

export function markNotificationsReadForChat(chatId, senderId = null) {
    if (!chatId && !senderId) return;

    let changed = false;
    const now = new Date().toISOString();
    items.forEach((item) => {
        if (item.read) return;
        const matchesChat = chatId && item.chatId === chatId;
        const matchesSender = senderId && item.senderId === senderId;
        if (matchesChat || matchesSender) {
            item.read = true;
            item.readAt = now;
            changed = true;
        }
    });

    if (!changed) return;

    persistItems();
    updateBadge();
    renderMenu();
}

export function removeNotificationsForDeletedMessages({ messageIds = [], clientIds = [] } = {}) {
    if (!removeMatchingNotifications({ messageIds, clientIds })) return;

    persistItems();
    updateBadge();
    renderMenu();
}

export function addInAppNotification({
    chatId,
    title,
    senderId = null,
    senderName = null,
    messageId = null,
    clientId = null
}) {
    if (!chatId) return;

    const mergeKey = notificationMergeKey({ chatId, senderId });
    if (!mergeKey) return;

    const displayTitle = senderName || title || 'Kullanıcı';
    const now = new Date().toISOString();

    const existingIndex = items.findIndex((item) => item.mergeKey === mergeKey);

    if (existingIndex !== -1) {
        const item = items[existingIndex];
        item.count = (item.count || 1) + 1;
        item.createdAt = now;
        item.read = false;
        item.readAt = null;
        item.chatId = chatId;
        item.title = displayTitle;
        item.senderId = senderId || item.senderId;
        item.lastMessageId = messageId || item.lastMessageId;
        item.lastClientId = clientId || item.lastClientId;
        applyNotificationSubtitle(item);
        item.route = routeFromChatId(chatId);
        items.splice(existingIndex, 1);
        items.unshift(item);
    } else {
        const item = {
            id: crypto.randomUUID(),
            chatId,
            mergeKey,
            senderId,
            title: displayTitle,
            count: 1,
            createdAt: now,
            read: false,
            readAt: null,
            lastMessageId: messageId || null,
            lastClientId: clientId || null,
            route: routeFromChatId(chatId)
        };
        applyNotificationSubtitle(item);
        items.unshift(item);
    }

    if (items.length > MAX_ITEMS) {
        items.length = MAX_ITEMS;
    }

    persistItems();
    updateBadge();
    renderMenu();
}
