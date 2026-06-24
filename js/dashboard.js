import { supabase, getSession } from './supabase-client.js';
import { initAuthModal, openAuthModal } from './auth-modal.js';
import { initWelcomeModal, maybeShowWelcomeModal, closeWelcomeModal } from './welcome-modal.js';
import { initNotifyModal, showNotify, closeNotifyModal } from './notify-modal.js';
import { initLinkViewer } from './link-viewer.js';
import {
    initViewer,
    initComposer,
    uploadMediaFile,
    isValidMediaUrl,
    toMediaUrl,
    toPersistMediaUrl,
    toBroadcastMediaUrl,
    displayMediaUrl,
    resolveMessageMediaUrl,
    resolveAvatarMediaUrl,
    initMediaSendModal,
    openMediaSendModal,
    closeMediaSendModal,
    isMediaSendModalOpen,
    setMediaSendUploadState
} from './media/index.js';
import { compressImageForAvatar, compressImageForChat } from './media/compress-image.js';
import {
    DEFAULT_LOCATION,
    MESSAGE_HISTORY_LIMIT
} from './config.js';
import {
    joinDmRoom,
    leaveRealtimeRoom,
    leaveDmNotificationRooms,
    syncDmNotificationRooms,
    broadcastShout,
    broadcastReaction,
    broadcastMessageDelete
} from './realtime-chat.js';
import { sanitizeText, isValidUsername, createMessageElement, formatTime, formatQuotePreview, initPasswordVisibilityToggles, appendMessageToContainer, createMessageDateSeparator, getCalendarDayKey } from './utils.js';
import {
    startVoiceRecording,
    stopVoiceRecording,
    cancelVoiceRecording,
    isVoiceRecordingSupported,
    isRecording,
    getRecordingElapsedMs,
    normalizeAudioMimeType,
    audioExtensionForMime
} from './voice-recorder.js';
import {
    showVoiceRecordingPanel,
    hideVoiceRecordingPanel,
    startRecordingUi,
    stopRecordingUi
} from './voice-message-ui.js';
import {
    initNotificationCenter,
    addInAppNotification,
    markNotificationsReadForChat,
    removeNotificationsForDeletedMessages,
    shouldCaptureInAppNotification,
    closeNotificationDropdown,
    setNotificationUser
} from './notification-center.js';
import {
    initPushNotifications,
    getPushSubscriptionState,
    togglePushNotifications,
    notifyPushRecipients,
    syncPushEnabledFromProfile,
    finalizePushInit,
    parseNotificationRoute,
    parseNotifyQueryParam,
    clearNotifyQueryParam,
    maybeShowForegroundNotification,
    describePushStatus
} from './push-notifications.js';
import {
    configureTopbar,
    refreshTopbarMenu,
    closeTopbarMenus,
    syncTopbarMenuIcon,
    setTopbarTitleMode,
    setTopbarProfileAvatar
} from './topbar.js';
import {
    initMessageInteractions,
    getPendingQuote,
    clearPendingQuote,
    serializeQuote,
    aggregateReactions,
    reactionsMapToList,
    handleIncomingReaction,
    setMessageDbIdByClientId,
    findMessageElement,
    enterSelectionMode,
    exitSelectionMode,
    getSelectedMessageKeys,
    isSelectionMode,
    refreshSelectionUi,
    removeMessagesFromDom
} from './message-interactions.js';
import {
    getCachedMessageHistory,
    setCachedMessageHistory,
    clearCachedMessageHistory
} from './message-cache.js';
import {
    buildAppPath,
    parseAppRoute,
    usernameToSlug,
    replaceAppPath
} from './app-routes.js';
import {
    initHmCamouflage,
    syncHmProfileUi,
    ensureHmProfileControls,
    readHmSettingsFromProfile
} from './hm-camouflage.js';
import { initSeo } from './seo.js';
import {
    initCloudPanel,
    openCloudPanel,
    refreshCloudAdminStatus,
    isCloudAdminUser,
    resetCloudPanel
} from './cloud-panel.js';

let currentUserId = null;
let pendingForward = null;
let pendingForwardSourceChat = null;
let pendingComposerMedia = null;
let currentMyUsername = 'Misafir';
let currentMyAvatarUrl = null;
let currentMyAvatarR2Key = null;
let currentActiveChat = null;
let currentConversationId = null;
let profileReadyPromise = Promise.resolve();
let messageHistoryLoadId = 0;
const dmConversations = new Map();
const dmTitles = new Map();
let mostRecentDmChat = null;

function saveAppRoute() {
    let activePanel = document.querySelector('.view-panel.active')?.id;
    if (activePanel === 'bulut-panel' && !isCloudAdminUser()) {
        activePanel = 'chat-panel';
    }
    const username = currentActiveChat?.startsWith('User-')
        ? dmTitles.get(currentActiveChat.replace('User-', ''))
        : null;

    replaceAppPath(buildAppPath({ activePanel, currentActiveChat, username }));
}

async function resolveUserBySlug(slug) {
    if (!slug || !isLoggedIn()) return null;

    const target = slug.toLowerCase();

    const { data: exact } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .eq('username', slug)
        .maybeSingle();

    if (exact && usernameToSlug(exact.username) === target) return exact;

    const { data: rows } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .ilike('username', slug);

    if (!rows?.length) return null;

    return rows.find((profile) => usernameToSlug(profile.username) === target) || null;
}

async function openDmByUserId(userId, usernameHint = null, avatarUrl = null) {
    if (!isLoggedIn()) {
        await showChatListHome();
        promptLogin();
        return;
    }

    let username = usernameHint || dmTitles.get(userId);

    if (!username) {
        const sidebarItem = document.getElementById(`user-${userId}`);
        username = sidebarItem?.querySelector('.chat-name')?.textContent;
    }

    if (!username) {
        const { data } = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', userId)
            .maybeSingle();
        username = data?.username;
        if (!avatarUrl) avatarUrl = data?.avatar_url || null;
    }

    if (!username) {
        await showChatListHome();
        return;
    }

    dmTitles.set(userId, username);

    if (!dmConversations.has(userId)) {
        const { data: convId, error } = await supabase.rpc('get_or_create_dm', { p_other: userId });
        if (error || !convId) {
            await showChatListHome();
            return;
        }
        dmConversations.set(userId, convId);
        if (!document.getElementById(`user-${userId}`)) {
            addDmToSidebar(userId, username, '');
        }
    }

    await openChat(`User-${userId}`, username, { avatarUrl });
}

async function openDmByUsernameSlug(usernameSlug) {
    if (!isLoggedIn()) {
        await showChatListHome();
        promptLogin();
        return;
    }

    const profile = await resolveUserBySlug(usernameSlug);
    if (!profile) {
        await showChatListHome();
        return;
    }

    await openDmByUserId(profile.id, profile.username, profile.avatar_url || null);
}

async function restoreAppRoute(route) {
    if (route.view === 'chats-home') {
        await showChatListHome();
        return;
    }

    if (route.view === 'profile-panel') {
        if (!isLoggedIn()) {
            await showChatListHome();
            return;
        }
        switchView('profile-panel');
        saveAppRoute();
        return;
    }

    if (route.view === 'bulut-panel') {
        if (!isLoggedIn()) {
            await showChatListHome();
            return;
        }
        await openCloudPanel();
        if (!isCloudAdminUser()) {
            await showChatListHome();
            replaceAppPath('/');
        }
        return;
    }

    if (route.chatId?.startsWith('User-')) {
        await openDmByUserId(route.chatId.replace('User-', ''));
        return;
    }

    if (route.userId) {
        await openDmByUserId(route.userId);
        return;
    }

    if (route.usernameSlug) {
        await openDmByUsernameSlug(route.usernameSlug);
    }
}

function isLoggedIn() {
    return !!currentUserId;
}

function syncAuthGateUi() {
    document.body.classList.toggle('user-authenticated', isLoggedIn());
}

function promptLogin() {
    closeTopbarMenus();
    openAuthModal('login');
}

function promptRegister() {
    closeTopbarMenus();
    openAuthModal('register');
}

function applyAvatarDisplay(element, url, fallbackLetter, r2Key = null) {
    if (!element) return;
    element.innerHTML = '';
    const src = displayMediaUrl(resolveAvatarMediaUrl(url, r2Key));
    if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.draggable = false;
        img.loading = 'eager';
        img.addEventListener('error', () => {
            element.innerHTML = '';
            element.textContent = (fallbackLetter || '?').charAt(0).toUpperCase();
        }, { once: true });
        element.appendChild(img);
    } else {
        element.textContent = (fallbackLetter || '?').charAt(0).toUpperCase();
    }
}

async function resolveDmPartnerAvatar(userId, avatarUrl = null) {
    if (avatarUrl) return avatarUrl;

    const sidebarImg = document.getElementById(`user-${userId}`)?.querySelector('.avatar img');
    if (sidebarImg?.src) return sidebarImg.src;

    const { data } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('id', userId)
        .maybeSingle();

    return data?.avatar_url || null;
}

function refreshAvatarDisplays() {
    const letter = currentMyUsername?.charAt(0) || 'K';
    const avatarSrc = displayMediaUrl(resolveAvatarMediaUrl(currentMyAvatarUrl, currentMyAvatarR2Key));
    setTopbarProfileAvatar({
        imageUrl: avatarSrc,
        letter,
        guest: !isLoggedIn()
    });
    applyAvatarDisplay(
        document.getElementById('profileAvatarPreview'),
        currentMyAvatarUrl,
        isLoggedIn() ? letter : '?',
        currentMyAvatarR2Key
    );

    const removeBtn = document.getElementById('profileAvatarRemoveBtn');
    if (removeBtn) removeBtn.hidden = !currentMyAvatarUrl;
}

function openProfileSettings() {
    switchView('profile-panel');
}

function openCloudAdminPanel() {
    openCloudPanel();
}

function initProfileAvatar() {
    const input = document.getElementById('profileAvatarInput');
    const btn = document.getElementById('profileAvatarBtn');
    const removeBtn = document.getElementById('profileAvatarRemoveBtn');

    btn?.addEventListener('click', () => {
        if (!isLoggedIn()) {
            promptLogin();
            return;
        }
        input?.click();
    });

    removeBtn?.addEventListener('click', async () => {
        if (!currentMyAvatarUrl) return;

        try {
            await removeProfileAvatar();
            showNotify('Profil fotoğrafı kaldırıldı.', { title: 'Profil', type: 'info' });
        } catch (err) {
            showNotify(err.message || 'Fotoğraf kaldırılamadı.', { title: 'Profil', type: 'error' });
        }
    });

    input?.addEventListener('change', async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;

        if (file.size > AVATAR_MAX_BYTES) {
            showNotify('Dosya 5 MB sınırını aşıyor.', { title: 'Profil', type: 'warning' });
            return;
        }

        try {
            await uploadProfileAvatar(file);
            showNotify('Profil fotoğrafı güncellendi.', { title: 'Profil', type: 'info' });
        } catch (err) {
            showNotify(err.message || 'Fotoğraf yüklenemedi.', { title: 'Profil', type: 'error' });
        }
    });
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

async function uploadProfileAvatar(file) {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    if (file.size > AVATAR_MAX_BYTES) {
        throw new Error('Dosya 5 MB sınırını aşıyor.');
    }

    const compressed = await compressImageForAvatar(file);

    const session = await getSession();
    if (!session?.access_token) throw new Error('Oturum bulunamadı.');

    const form = new FormData();
    form.append('file', compressed, compressed.name || 'avatar.jpg');
    form.append('kind', 'avatar');

    const res = await fetch('/api/upload?kind=avatar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Yükleme başarısız.');

    const avatarUrl = toPersistMediaUrl(data.url, data.r2Key) || data.url;

    const { error } = await supabase.from('profiles').update({
        avatar_url: avatarUrl,
        avatar_r2_key: data.r2Key,
        updated_at: new Date().toISOString()
    }).eq('id', currentUserId);

    if (error) throw new Error(error.message);

    currentMyAvatarUrl = avatarUrl;
    currentMyAvatarR2Key = data.r2Key;
    refreshAvatarDisplays();
}

async function removeProfileAvatar() {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    if (!currentMyAvatarUrl) return;

    const session = await getSession();
    if (!session?.access_token) throw new Error('Oturum bulunamadı.');

    const res = await fetch('/api/avatar-remove', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fotoğraf kaldırılamadı.');

    currentMyAvatarUrl = null;
    currentMyAvatarR2Key = null;
    refreshAvatarDisplays();
}

function updateMessageInputState() {
    const input = document.getElementById('messageInput');
    if (!input) return;
    input.placeholder = isLoggedIn()
        ? 'Mesajınızı yazın veya görsel yapıştırın...'
        : 'Mesaj yazmak için giriş yapın...';

    input.onfocus = isLoggedIn() ? null : () => {
        input.blur();
        promptLogin();
    };
}

function isMobileLayout() {
    return true;
}

window.toggleSidebar = function () {
    if (document.body.classList.contains('chats-home-view')) {
        return;
    }

    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isOpen = sidebar.classList.contains('open');

    if (isOpen) {
        closeSidebar();
        return;
    }

    sidebar.classList.add('open');
    overlay.classList.add('show');
    syncTopbarMenuIcon();
};

window.closeSidebar = function () {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('show');
    syncTopbarMenuIcon();
};

function showMainContentView() {
    document.body.classList.remove('chats-home-view');
    document.body.classList.add('chat-open-view');
    closeSidebar();
}

window.switchView = function (panelId) {
    if ((panelId === 'profile-panel' || panelId === 'bulut-panel') && !isLoggedIn()) {
        promptLogin();
        return;
    }

    if (panelId === 'bulut-panel' && !isCloudAdminUser()) {
        void openCloudPanel();
        return;
    }

    if (panelId === 'profile-panel' || panelId === 'bulut-panel') {
        showMainContentView();
    }

    document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(panelId).classList.add('active');

    if (panelId === 'profile-panel') {
        setTopbarTitleMode('profile');
    } else if (panelId === 'bulut-panel') {
        setTopbarTitleMode('bulut');
    } else {
        setTopbarTitleMode('chat');
    }

    if (panelId === 'profile-panel') {
        updatePushStatusUI();
        ensureHmProfileControls();
        initPasswordVisibilityToggles(document.getElementById('hmPinGroup'));
    }
    closeTopbarMenus();
    closeNotificationDropdown();
    if (panelId !== 'chat-panel') {
        exitSelectionMode(document.getElementById('messageContainer'));
        updateSelectionBarUi(0);
    }
    saveAppRoute();
};

window.checkEnter = function (event) {
    if (event.key === 'Enter') sendMessage();
};

window.saveProfile = saveProfile;
window.openChat = openChat;
window.sendMessage = sendMessage;

function hasDmChatItems() {
    const list = document.getElementById('myActiveChatsList');
    if (!list) return false;
    return !!list.querySelector('.chat-item');
}

function updateHeaderForChatHome() {
    const statusEl = document.getElementById('activeChatStatus');
    const hasDms = hasDmChatItems();

    if (hasDms) {
        document.getElementById('activeChatName').textContent = 'Sohbetler';
    } else {
        document.getElementById('activeChatName').textContent = 'Woxifly';
    }

    if (statusEl) {
        statusEl.textContent = '';
        statusEl.hidden = true;
    }

    document.getElementById('activeChatAvatar').textContent = hasDms ? 'S' : 'W';
}

function showChatConversationUi() {
    showMainContentView();

    const container = document.getElementById('messageContainer');
    const input = document.getElementById('messageInputArea');
    if (container) container.hidden = false;
    if (input) input.hidden = false;
}

async function showChatListHome() {
    currentActiveChat = null;
    currentConversationId = null;
    leaveRealtimeRoom();
    refreshDmNotificationListeners();
    clearPendingQuote();
    clearPendingComposerMedia();
    clearPendingForward();
    exitSelectionMode(document.getElementById('messageContainer'));
    updateSelectionBarUi(0);
    clearMessageContainer();

    document.body.classList.add('chats-home-view');
    document.body.classList.remove('chat-open-view');
    document.querySelectorAll('.chat-item').forEach((item) => item.classList.remove('active'));

    updateHeaderForChatHome();

    const container = document.getElementById('messageContainer');
    const input = document.getElementById('messageInputArea');
    if (container) container.hidden = true;
    if (input) input.hidden = true;

    switchView('chat-panel');
    closeSidebar();
    syncTopbarMenuIcon();
    updateMessageInputState();
    saveAppRoute();
}

async function loadProfile() {
    const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url, avatar_r2_key')
        .eq('id', currentUserId)
        .single();

    if (error) {
        await supabase.from('profiles').upsert({
            id: currentUserId,
            username: 'Kullanıcı',
            district: DEFAULT_LOCATION,
            current_district: DEFAULT_LOCATION,
            is_visible: false
        });
        currentMyUsername = 'Kullanıcı';
        currentMyAvatarUrl = null;
        currentMyAvatarR2Key = null;
    } else {
        currentMyUsername = data.username;
        currentMyAvatarUrl = data.avatar_url || null;
        currentMyAvatarR2Key = data.avatar_r2_key || null;
    }

    document.getElementById('usernameInput').value = currentMyUsername;

    refreshAvatarDisplays();
    refreshTopbarMenu();
    updateMessageInputState();
    updatePushStatusUI();
    void syncPushEnabledFromProfile();
    await refreshCloudAdminStatus();
    refreshTopbarMenu();
}

async function saveProfile() {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    const newName = sanitizeText(document.getElementById('usernameInput').value, 24);

    if (!isValidUsername(newName)) {
        showNotify('Rumuz 2-24 karakter olmalı; harf, rakam, _ . - kullanılabilir.', {
            title: 'Geçersiz rumuz',
            type: 'warning'
        });
        return;
    }

    const hmEnabled = document.getElementById('hmPerdeInput')?.checked === true;
    const hmPinInput = document.getElementById('hmPinInput');
    const hmPin = hmPinInput?.value?.trim();
    if (hmEnabled && hmPin && !/^\d{4,8}$/.test(hmPin)) {
        showNotify('Kilit PIN 4-8 haneli rakam olmalıdır.', { title: 'Geçersiz PIN', type: 'warning' });
        return;
    }

    const { error } = await supabase.from('profiles').update({
        username: newName,
        is_visible: false,
        updated_at: new Date().toISOString()
    }).eq('id', currentUserId);

    if (error) {
        showNotify('Profil kaydedilemedi: ' + error.message, { title: 'Hata', type: 'error' });
        return;
    }

    const hmResult = readHmSettingsFromProfile();
    if (hmResult?.error) {
        showNotify(hmResult.error, { title: 'Geçersiz PIN', type: 'warning' });
    }

    currentMyUsername = newName;
    refreshTopbarMenu();

    await showChatListHome();
    showNotify('Profil kaydedildi.', { title: 'Başarılı', type: 'success' });
}

function messageClickHandler() {
    return (senderId, username) => openChatFromSender(senderId, username);
}

function appendMessageToUI({
    sender,
    body,
    time,
    createdAt = null,
    isOutgoing,
    senderId,
    contentType,
    mediaUrl,
    mediaState = 'ready',
    clientId = null,
    messageId = null,
    quote = null,
    reactions = null
}) {
    const container = document.getElementById('messageContainer');
    clearMessagePlaceholders(container);

    const messageEl = createMessageElement({
        sender,
        body,
        time,
        isOutgoing,
        senderId,
        contentType: contentType || 'text',
        mediaUrl: mediaUrl || null,
        mediaState,
        clientId,
        messageId,
        quote,
        reactions,
        onSenderClick: isOutgoing ? null : messageClickHandler(),
        showSender: false,
        showQuoteAuthor: false,
        viewerUserId: currentUserId,
        viewerUsername: currentMyUsername
    });

    appendMessageToContainer(container, messageEl, createdAt || new Date().toISOString());
    container.scrollTop = container.scrollHeight;
    if (isSelectionMode()) {
        refreshSelectionUi(container);
    }
}

let finishVoiceRecordingToPending = async () => {};

function initMediaComposer() {
    initMediaSendModal({
        onSend: async (caption) => {
            try {
                await dispatchPendingComposerMedia(caption);
            } catch (err) {
                showNotify(err.message || 'Mesaj gönderilemedi.', {
                    title: 'Gönderim hatası',
                    type: 'error'
                });
                throw err;
            }
        },
        onCancel: () => {
            clearPendingComposerMedia();
        }
    });

    initComposer({
        isLoggedIn,
        promptLogin,
        showNotify,
        onMediaMessage: handleMediaMessage
    });

    const voiceBtn = document.getElementById('voiceBtn');
    if (!isVoiceRecordingSupported()) {
        voiceBtn?.setAttribute('disabled', 'true');
        voiceBtn?.setAttribute('title', 'Tarayıcı ses kaydını desteklemiyor');
        return;
    }

    if (!voiceBtn) return;

    let voiceRecordingFinishing = false;

    const resetRecordingUi = () => {
        voiceRecordingFinishing = false;
        stopRecordingUi();
        hideVoiceRecordingPanel();
        voiceBtn.classList.remove('recording');
    };

    const stopRecordingToPending = () => new Promise((resolve) => {
        if (voiceRecordingFinishing) {
            resolve();
            return;
        }

        if (!isRecording()) {
            resolve();
            return;
        }

        voiceRecordingFinishing = true;
        stopRecordingUi();
        hideVoiceRecordingPanel();
        voiceBtn.classList.remove('recording');

        const stopped = stopVoiceRecording(async (blob) => {
            voiceRecordingFinishing = false;

            if (!blob || blob.size < 1) {
                showNotify('Ses kaydı çok kısa.', { title: 'Ses kaydı', type: 'warning' });
                resolve();
                return;
            }

            const mimeType = normalizeAudioMimeType(blob.type);
            const ext = audioExtensionForMime(mimeType);
            const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
            await stageComposerMedia(file, 'audio');
            resolve();
        });

        if (!stopped) {
            voiceRecordingFinishing = false;
            resolve();
        }
    });

    finishVoiceRecordingToPending = stopRecordingToPending;

    const beginRecord = () => {
        if (!isLoggedIn()) {
            promptLogin();
            return;
        }
        if (isRecording() || voiceRecordingFinishing) return;

        voiceBtn.classList.add('recording');
        showVoiceRecordingPanel();

        startVoiceRecording({
            onReady: ({ analyser }) => {
                startRecordingUi({
                    getElapsedMs: getRecordingElapsedMs,
                    analyser
                });
            },
            onMaxDuration: () => {
                stopRecordingToPending();
            },
            onError: (err) => {
                resetRecordingUi();
                showNotify(
                    err?.message === 'Permission denied'
                        ? 'Mikrofon izni gerekli.'
                        : 'Ses kaydı başlatılamadı.',
                    { title: 'Ses kaydı', type: 'error' }
                );
            }
        }).catch(() => {
            resetRecordingUi();
        });
    };

    const cancelRecord = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!isRecording() && !voiceRecordingFinishing) {
            resetRecordingUi();
            return;
        }
        cancelVoiceRecording();
        resetRecordingUi();
    };

    document.getElementById('voiceRecordingCancel')?.addEventListener('click', cancelRecord);

    voiceBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        if (isRecording()) {
            await stopRecordingToPending();
        } else {
            beginRecord();
        }
    });
}

async function handleMediaMessage(file, kind) {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    await stageComposerMedia(file, kind);
}

function clearMessagePlaceholders(container = document.getElementById('messageContainer')) {
    if (!container) return;
    container.querySelector('[data-empty-chat]')?.remove();
    container.querySelector('[data-message-loading]')?.remove();
}

function clearMessageContainer(container = document.getElementById('messageContainer')) {
    if (!container) return;
    container.querySelectorAll('.message, .message-date-separator').forEach((el) => el.remove());
    clearMessagePlaceholders(container);
}

function showMessageLoading() {
    const container = document.getElementById('messageContainer');
    if (!container) return;

    clearMessagePlaceholders(container);

    const wrap = document.createElement('div');
    wrap.dataset.messageLoading = 'true';
    wrap.className = 'message-loading';
    wrap.setAttribute('aria-label', 'Mesajlar yükleniyor');
    wrap.setAttribute('role', 'status');
    wrap.innerHTML = `
        <div class="message-loading-row message-loading-row--incoming">
            <div class="message-loading-bubble">
                <div class="message-loading-line"></div>
                <div class="message-loading-line message-loading-line--short"></div>
            </div>
        </div>
        <div class="message-loading-row message-loading-row--outgoing">
            <div class="message-loading-bubble">
                <div class="message-loading-line message-loading-line--mid"></div>
            </div>
        </div>
        <div class="message-loading-row message-loading-row--incoming">
            <div class="message-loading-bubble">
                <div class="message-loading-line message-loading-line--mid"></div>
            </div>
        </div>
    `;
    container.appendChild(wrap);
}

function showEmptyChat() {
    const container = document.getElementById('messageContainer');
    clearMessagePlaceholders(container);

    const empty = document.createElement('div');
    empty.dataset.emptyChat = 'true';
    empty.style.cssText = 'text-align:center; font-size:0.8rem; color:var(--text-muted); padding:20px;';
    empty.textContent = isLoggedIn()
        ? 'Henüz mesaj yok. İlk mesajı siz yazın!'
        : 'Henüz mesaj yok. Yazmak için giriş yapın.';
    container.appendChild(empty);
}

function handleIncomingBroadcast(payload) {
    if (payload.sender_id && payload.sender_id === currentUserId) return;

    const contentType = payload.content_type || 'text';
    const mediaUrl = resolveMessageMediaUrl(payload.media_url, payload.r2_key);

    if (contentType !== 'text' && !mediaUrl) return;

    appendMessageToUI({
        sender: payload.sender_name || 'Kullanıcı',
        body: payload.body || '',
        time: formatTime(payload.created_at),
        createdAt: payload.created_at,
        isOutgoing: false,
        senderId: payload.sender_id || null,
        contentType,
        mediaUrl,
        clientId: payload.client_id || null,
        quote: payload.quote || null
    });

    notifyIncomingDmMessage(payload, currentConversationId);
}

function getUserIdForConversation(conversationId) {
    if (!conversationId) return null;
    for (const [userId, convId] of dmConversations) {
        if (convId === conversationId) return userId;
    }
    return null;
}

function refreshDmNotificationListeners() {
    if (!isLoggedIn()) {
        leaveDmNotificationRooms();
        return;
    }

    const conversationIds = [...new Set(dmConversations.values())];
    syncDmNotificationRooms(supabase, conversationIds, {
        activeConversationId: currentConversationId,
        onMessage: handleIncomingDmNotification
    });
}

function notifyIncomingDmMessage(payload, conversationId) {
    if (!payload || payload.sender_id === currentUserId) return;

    const partnerUserId = getUserIdForConversation(conversationId) || payload.sender_id;
    const chatId = partnerUserId ? `User-${partnerUserId}` : currentActiveChat;
    if (!chatId?.startsWith('User-')) return;

    const notifyOpts = {
        viewingConversationId: currentConversationId,
        messageConversationId: conversationId
    };

    maybeShowForegroundNotification(payload, notifyOpts);

    if (shouldCaptureInAppNotification(notifyOpts)) {
        addInAppNotification({
            chatId,
            title: payload.sender_name || 'Özel Sohbet',
            senderId: payload.sender_id || null,
            senderName: payload.sender_name || null,
            messageId: payload.id || payload.message_id || null,
            clientId: payload.client_id || null
        });
    }

    syncDmSidebarPreview(chatId, payload, false);
}

function handleIncomingDmNotification(payload, conversationId) {
    if (conversationId === currentConversationId) return;
    notifyIncomingDmMessage(payload, conversationId);
}

function handleIncomingReactionBroadcast(payload) {
    if (!payload?.emoji || !payload?.user_id) return;
    if (payload.user_id === currentUserId) return;
    handleIncomingReaction(payload, currentUserId);
}

function handleIncomingDeleteBroadcast(payload) {
    if (!payload) return;
    removeMessagesFromDom({
        messageIds: payload.message_ids || [],
        clientIds: payload.client_ids || []
    });
    removeNotificationsForDeletedMessages({
        messageIds: payload.message_ids || [],
        clientIds: payload.client_ids || []
    });
    updateSelectionBarUi();
}

function subscribeDmRealtime(conversationId) {
    joinDmRoom(supabase, conversationId, {
        userId: currentUserId,
        username: currentMyUsername,
        onMessage: handleIncomingBroadcast,
        onReaction: handleIncomingReactionBroadcast,
        onDelete: handleIncomingDeleteBroadcast,
        onPresence: (count) => {
            const statusEl = document.getElementById('activeChatStatus');
            if (currentActiveChat?.startsWith('User-')) {
                statusEl.style.display = 'none';
                statusEl.textContent = count > 1 ? 'Çevrimiçi' : '';
                if (count > 1) statusEl.style.display = '';
            }
        }
    });
}

function isActiveMessageHistoryLoad(loadId, conversationId) {
    return loadId === messageHistoryLoadId && conversationId === currentConversationId;
}

function renderMessageHistoryRows(container, ordered, { profileMap = {}, reactionsByMessage = new Map() } = {}) {
    clearMessagePlaceholders(container);

    if (!ordered.length) {
        showEmptyChat();
        return;
    }

    let lastDayKey = null;

    ordered.forEach((msg) => {
        const dayKey = getCalendarDayKey(msg.created_at);
        if (dayKey && dayKey !== lastDayKey) {
            container.appendChild(createMessageDateSeparator(msg.created_at));
            lastDayKey = dayKey;
        }

        const senderName = msg.sender_username || profileMap[msg.sender_id] || 'Kullanıcı';
        const isOutgoing = msg.sender_id === currentUserId;
        const messageEl = createMessageElement({
            sender: senderName,
            body: msg.body || '',
            time: formatTime(msg.created_at),
            isOutgoing,
            senderId: isOutgoing ? null : msg.sender_id,
            contentType: msg.content_type || 'text',
            mediaUrl: resolveMessageMediaUrl(msg.media_url, msg.r2_key),
            mediaR2Key: msg.r2_key,
            messageId: msg.id,
            clientId: msg.client_id || null,
            quote: msg.quote || null,
            reactions: reactionsMapToList(reactionsByMessage.get(msg.id)),
            onSenderClick: isOutgoing ? null : messageClickHandler(),
            showSender: false,
            showQuoteAuthor: false,
            viewerUserId: currentUserId,
            viewerUsername: currentMyUsername
        });
        if (dayKey) messageEl.dataset.dayKey = dayKey;
        container.appendChild(messageEl);
    });

    container.scrollTop = container.scrollHeight;
    refreshSelectionUi(container);
}

async function loadMessageHistory(conversationId) {
    const loadId = ++messageHistoryLoadId;
    const container = document.getElementById('messageContainer');
    clearMessageContainer(container);

    const cached = getCachedMessageHistory(currentUserId, conversationId);
    let showedCache = false;
    if (cached?.messages?.length) {
        showedCache = true;
        renderMessageHistoryRows(container, cached.messages, {
            reactionsByMessage: aggregateReactions(cached.reactionRows || [], currentUserId)
        });
    } else {
        showMessageLoading();
    }

    try {
        const { data: messages, error } = await supabase
            .from('messages')
            .select('id, body, created_at, sender_id, sender_username, content_type, media_url, r2_key, client_id, quote')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(MESSAGE_HISTORY_LIMIT);

        if (!isActiveMessageHistoryLoad(loadId, conversationId)) return;
        if (error) throw error;

        if (!messages || messages.length === 0) {
            clearCachedMessageHistory(currentUserId, conversationId);
            clearMessageContainer(container);
            showEmptyChat();
            return;
        }

        const ordered = [...messages].reverse();
        const senderIds = [...new Set(ordered.filter((m) => !m.sender_username).map((m) => m.sender_id))];
        const messageIds = ordered.map((m) => m.id);

        const [profilesResult, reactionsResult] = await Promise.all([
            senderIds.length
                ? supabase.from('profiles').select('id, username').in('id', senderIds)
                : Promise.resolve({ data: [], error: null }),
            messageIds.length
                ? supabase
                    .from('message_reactions')
                    .select('message_id, user_id, emoji')
                    .in('message_id', messageIds)
                : Promise.resolve({ data: [], error: null })
        ]);

        if (!isActiveMessageHistoryLoad(loadId, conversationId)) return;
        if (profilesResult.error) throw profilesResult.error;
        if (reactionsResult.error) throw reactionsResult.error;

        const profileMap = Object.fromEntries((profilesResult.data || []).map((p) => [p.id, p.username]));
        const reactionsByMessage = aggregateReactions(reactionsResult.data || [], currentUserId);
        const reactionRows = reactionsResult.data || [];

        if (!isActiveMessageHistoryLoad(loadId, conversationId)) return;

        container.querySelectorAll('.message, .message-date-separator').forEach((el) => el.remove());
        renderMessageHistoryRows(container, ordered, { profileMap, reactionsByMessage });

        setCachedMessageHistory(currentUserId, conversationId, {
            messages: ordered,
            reactionRows
        });
    } catch (err) {
        if (!isActiveMessageHistoryLoad(loadId, conversationId)) return;
        console.error('[woxifly] loadMessageHistory failed:', err);
        if (showedCache) return;
        clearMessageContainer(container);
        showEmptyChat();
    }
}

async function resolveMessageIds(targets) {
    const messageIds = [];
    const clientIds = [];

    for (const target of targets) {
        if (target.messageId) {
            messageIds.push(target.messageId);
            continue;
        }

        if (target.clientId) {
            const { data } = await supabase
                .from('messages')
                .select('id')
                .eq('client_id', target.clientId)
                .is('deleted_at', null)
                .maybeSingle();

            if (data?.id) messageIds.push(data.id);
            else clientIds.push(target.clientId);
        }
    }

    return { messageIds, clientIds };
}

async function softDeleteMessages(targets) {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    if (!targets?.length) return;

    const { messageIds, clientIds } = await resolveMessageIds(targets);

    if (messageIds.length) {
        const { data: deletedCount, error } = await supabase.rpc('soft_delete_messages', {
            p_message_ids: messageIds
        });

        if (error) {
            console.error('Mesaj silinemedi:', error.message);
            showNotify('Mesajlar silinemedi: ' + error.message, { title: 'Silme hatası', type: 'error' });
            return;
        }

        if (!deletedCount) {
            showNotify('Silinecek mesaj bulunamadı.', { title: 'Silme', type: 'warning' });
            return;
        }
    }

    removeMessagesFromDom({ messageIds, clientIds });
    removeNotificationsForDeletedMessages({ messageIds, clientIds });
    updateSelectionBarUi();

    if (isSelectionMode()) {
        exitSelectionMode(document.getElementById('messageContainer'));
    }

    broadcastMessageDelete({
        message_ids: messageIds,
        client_ids: clientIds,
        user_id: currentUserId
    }).catch((err) => console.error('Silme yayını başarısız:', err));
}

async function deleteSelectedMessages() {
    const keys = getSelectedMessageKeys();
    if (!keys.size) return;

    const targets = [];
    document.querySelectorAll('.message').forEach((el) => {
        const key = el.dataset.messageId || el.dataset.clientId;
        if (key && keys.has(key)) {
            targets.push({
                messageId: el.dataset.messageId || null,
                clientId: el.dataset.clientId || null
            });
        }
    });

    await softDeleteMessages(targets);
}

function updateSelectionBarUi(count = null) {
    const bar = document.getElementById('messageSelectionBar');
    const countEl = document.getElementById('messageSelectionCount');
    const deleteBtn = document.getElementById('messageSelectionDeleteBtn');
    const container = document.getElementById('messageContainer');

    const selectedCount = count ?? getSelectedMessageKeys().size;
    const active = isSelectionMode();

    bar?.toggleAttribute('hidden', !active);
    if (countEl) countEl.textContent = `${selectedCount} seçildi`;
    if (deleteBtn) deleteBtn.disabled = selectedCount < 1;
    container?.classList.toggle('selection-mode', active);
}

function initMessageSelectionControls() {
    const messageContainer = document.getElementById('messageContainer');
    const deleteBtn = document.getElementById('messageSelectionDeleteBtn');
    const cancelBtn = document.getElementById('messageSelectionCancelBtn');

    deleteBtn?.addEventListener('click', () => {
        deleteSelectedMessages();
    });

    cancelBtn?.addEventListener('click', () => {
        exitSelectionMode(messageContainer);
        updateSelectionBarUi();
    });
}

async function persistMessageAsync({
    body,
    contentType = 'text',
    mediaUrl = null,
    r2Key = null,
    clientId = null,
    quote = null
}) {
    try {
        const convId = currentConversationId;

        if (!convId || !currentUserId) return;

        const hasText = sanitizeText(body || '', 2000).length > 0;
        const hasMedia = contentType !== 'text' && isValidMediaUrl(mediaUrl, r2Key);
        if (!hasText && !hasMedia) return;

        const row = {
            id: crypto.randomUUID(),
            conversation_id: convId,
            sender_id: currentUserId,
            body: hasText ? sanitizeText(body, 2000) : '',
            content_type: hasMedia ? contentType : 'text',
            media_url: hasMedia ? toPersistMediaUrl(mediaUrl, r2Key) : null,
            r2_key: hasMedia ? r2Key : null,
            client_id: clientId || null,
            quote: quote ? serializeQuote(quote) : null
        };

        const { data, error } = await supabase
            .from('messages')
            .insert(row)
            .select('id')
            .single();

        if (error) {
            console.error('Mesaj kaydı başarısız:', error.message, error.details, row);
            if (hasMedia) {
                showNotify(
                    `Medya kaydedilemedi: ${error.message}`,
                    { title: 'Kayıt hatası', type: 'error' }
                );
            }
            return;
        }

        if (data?.id && clientId) {
            setMessageDbIdByClientId(clientId, data.id);
        }

        triggerPushForMessage(convId);
    } catch (err) {
        console.error('Mesaj kaydı başarısız:', err);
    }
}

async function dispatchOutgoingMessage({
    body = '',
    contentType = 'text',
    mediaUrl = null,
    r2Key = null,
    clientId = null,
    skipAppend = false,
    quote = null
}) {
    const caption = sanitizeText(body, 2000);
    const hasMedia = contentType !== 'text' && isValidMediaUrl(mediaUrl, r2Key);

    if (!caption && !hasMedia) return;

    const messageClientId = clientId || crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const serializedQuote = quote ? serializeQuote(quote) : null;
    const payload = {
        client_id: messageClientId,
        body: caption,
        content_type: hasMedia ? contentType : 'text',
        media_url: hasMedia ? toBroadcastMediaUrl(mediaUrl) : null,
        r2_key: hasMedia ? r2Key : null,
        sender_id: currentUserId,
        sender_name: currentMyUsername,
        created_at: createdAt,
        conversation_id: currentConversationId,
        quote: serializedQuote
    };

    if (!skipAppend) {
        appendMessageToUI({
            sender: currentMyUsername,
            body: caption,
            time: formatTime(createdAt),
            createdAt,
            isOutgoing: true,
            contentType: payload.content_type,
            mediaUrl: resolveMessageMediaUrl(payload.media_url, r2Key),
            mediaR2Key: r2Key,
            mediaState: hasMedia ? 'ready' : 'ready',
            clientId: messageClientId,
            quote: serializedQuote
        });
    }

    broadcastShout(payload).catch((err) => console.error('Broadcast başarısız:', err));

    syncDmSidebarPreview(currentActiveChat, payload, true);

    persistMessageAsync({
        body: caption,
        contentType: payload.content_type,
        mediaUrl,
        r2Key,
        clientId: messageClientId,
        quote
    });
}

function usesMediaSendModal(kind) {
    return kind === 'video' || kind === 'audio';
}

async function dispatchPendingComposerMedia(caption = '') {
    const ready = await ensurePendingMediaReady();
    const quote = getPendingQuote();
    clearPendingQuote();

    await dispatchOutgoingMessage({
        body: sanitizeText(caption, 2000),
        contentType: ready.kind,
        mediaUrl: ready.url,
        r2Key: ready.r2Key,
        quote
    });

    clearPendingComposerMedia();
}

function clearPendingComposerMedia() {
    closeMediaSendModal();
    if (pendingComposerMedia?.previewUrl) {
        URL.revokeObjectURL(pendingComposerMedia.previewUrl);
    }
    pendingComposerMedia = null;
    const slot = document.getElementById('mediaComposerSlot');
    if (slot) slot.replaceChildren();
    const bar = document.getElementById('uploadStatus');
    if (bar) {
        bar.hidden = true;
        bar.classList.remove('is-active');
        bar.textContent = '';
    }
}

function mediaComposerLabel(kind, uploadState) {
    const base = kind === 'image' ? '📷 Görsel'
        : kind === 'video' ? '🎬 Video'
            : '🎤 Ses kaydı';
    if (uploadState === 'uploading') return `${base} · yükleniyor…`;
    if (uploadState === 'failed') return `${base} · yükleme başarısız`;
    return base;
}

function renderMediaComposerBar() {
    const slot = document.getElementById('mediaComposerSlot');
    if (!slot) return;

    slot.replaceChildren();
    if (!pendingComposerMedia || usesMediaSendModal(pendingComposerMedia.kind)) return;

    const { kind, previewUrl, uploadState } = pendingComposerMedia;

    const bar = document.createElement('div');
    bar.className = 'quote-composer-bar';

    const accent = document.createElement('div');
    accent.className = 'quote-composer-accent';

    const content = document.createElement('div');
    content.className = 'quote-composer-content';
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.gap = '8px';

    if (kind === 'image' && previewUrl) {
        const thumb = document.createElement('img');
        thumb.className = 'media-composer-thumb';
        thumb.src = previewUrl;
        thumb.alt = '';
        content.appendChild(thumb);
    } else if (kind === 'video') {
        const thumb = document.createElement('div');
        thumb.className = 'media-composer-thumb media-composer-thumb--icon';
        thumb.textContent = '🎬';
        content.appendChild(thumb);
    } else {
        const thumb = document.createElement('div');
        thumb.className = 'media-composer-thumb media-composer-thumb--icon';
        thumb.textContent = '🎤';
        content.appendChild(thumb);
    }

    const textWrap = document.createElement('div');
    textWrap.style.minWidth = '0';

    const title = document.createElement('div');
    title.className = 'quote-composer-preview';
    title.textContent = mediaComposerLabel(kind, uploadState);

    textWrap.appendChild(title);
    content.appendChild(textWrap);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'quote-composer-close';
    closeBtn.setAttribute('aria-label', 'Medyayı kaldır');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => clearPendingComposerMedia());

    bar.append(accent, content, closeBtn);
    slot.appendChild(bar);
}

async function startPendingMediaUpload() {
    if (!pendingComposerMedia || pendingComposerMedia.uploadState === 'ready') return;
    if (pendingComposerMedia.uploadPromise) return pendingComposerMedia.uploadPromise;

    const { file, kind } = pendingComposerMedia;
    pendingComposerMedia.uploadState = 'uploading';
    renderMediaComposerBar();
    if (usesMediaSendModal(kind)) {
        setMediaSendUploadState('uploading');
    }

    const bar = document.getElementById('uploadStatus');
    if (bar) {
        bar.hidden = false;
        bar.classList.add('is-active');
        bar.textContent = 'Medya yükleniyor...';
    }

    pendingComposerMedia.uploadPromise = uploadMediaFile(file, kind)
        .then((result) => {
            if (!pendingComposerMedia) return result;
            pendingComposerMedia.url = result.url;
            pendingComposerMedia.r2Key = result.r2Key;
            pendingComposerMedia.kind = result.kind;
            pendingComposerMedia.uploadState = 'ready';
            renderMediaComposerBar();
            if (usesMediaSendModal(pendingComposerMedia.kind)) {
                setMediaSendUploadState('ready');
            }
            return result;
        })
        .catch((err) => {
            if (pendingComposerMedia) {
                pendingComposerMedia.uploadState = 'failed';
                renderMediaComposerBar();
                if (usesMediaSendModal(pendingComposerMedia.kind)) {
                    setMediaSendUploadState('failed');
                }
            }
            throw err;
        })
        .finally(() => {
            const statusBar = document.getElementById('uploadStatus');
            if (statusBar) {
                statusBar.hidden = true;
                statusBar.classList.remove('is-active');
                statusBar.textContent = '';
            }
            if (pendingComposerMedia) {
                pendingComposerMedia.uploadPromise = null;
            }
        });

    return pendingComposerMedia.uploadPromise;
}

async function ensurePendingMediaReady() {
    if (!pendingComposerMedia) return null;
    if (pendingComposerMedia.uploadState === 'ready') {
        return pendingComposerMedia;
    }
    if (pendingComposerMedia.uploadState === 'failed') {
        pendingComposerMedia.uploadState = 'idle';
        pendingComposerMedia.uploadPromise = null;
    }
    await startPendingMediaUpload();
    if (pendingComposerMedia?.uploadState !== 'ready') {
        throw new Error('Medya yüklenemedi. Tekrar deneyin.');
    }
    return pendingComposerMedia;
}

async function stageComposerMedia(file, kind) {
    let uploadFile = file;
    if (kind === 'image') {
        try {
            uploadFile = await compressImageForChat(file);
        } catch (err) {
            showNotify(err.message || 'Görsel işlenemedi.', {
                title: 'Yükleme hatası',
                type: 'error'
            });
            return;
        }
    }

    clearPendingComposerMedia();

    const previewUrl = (kind === 'image' || kind === 'video' || kind === 'audio')
        ? URL.createObjectURL(uploadFile)
        : null;

    pendingComposerMedia = {
        file: uploadFile,
        kind,
        previewUrl,
        url: null,
        r2Key: null,
        uploadState: 'idle',
        uploadPromise: null
    };

    const input = document.getElementById('messageInput');
    const draftCaption = sanitizeText(input?.value || '', 2000);

    if (usesMediaSendModal(kind)) {
        openMediaSendModal({ kind, previewUrl, caption: draftCaption });
        if (input) input.value = '';
    } else {
        renderMediaComposerBar();
        input?.focus();
    }

    startPendingMediaUpload().catch(() => {
        showNotify('Medya yüklenemedi.', { title: 'Yükleme hatası', type: 'error' });
    });
}

function clearPendingForward() {
    pendingForward = null;
    pendingForwardSourceChat = null;
    const slot = document.getElementById('forwardComposerSlot');
    if (slot) slot.replaceChildren();
}

function renderForwardComposerBar() {
    const slot = document.getElementById('forwardComposerSlot');
    if (!slot) return;

    slot.replaceChildren();
    if (!pendingForward) return;

    const bar = document.createElement('div');
    bar.className = 'forward-composer-bar';

    const accent = document.createElement('div');
    accent.className = 'forward-composer-accent';

    const content = document.createElement('div');
    content.className = 'forward-composer-content';

    const title = document.createElement('div');
    title.className = 'forward-composer-title';
    title.textContent = 'Mesaj ilet';

    const preview = document.createElement('div');
    preview.className = 'forward-composer-preview';
    preview.textContent = pendingForward.body
        || formatQuotePreview({
            content_type: pendingForward.contentType,
            body: ''
        });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'forward-composer-close';
    closeBtn.setAttribute('aria-label', 'İletmeyi iptal et');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => clearPendingForward());

    content.append(title, preview);
    bar.append(accent, content, closeBtn);
    slot.appendChild(bar);
}

function handleForwardRequest(payload) {
    if (!payload) return;

    pendingForward = payload;
    pendingForwardSourceChat = currentActiveChat;
    renderForwardComposerBar();

    showNotify('İletmek için soldan bir sohbet seçin.', { title: 'Mesaj ilet', type: 'info' });

    if (isMobileLayout()) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar?.classList.add('open');
        overlay?.classList.add('show');
    }
}

async function deliverPendingForward() {
    if (!pendingForward || !currentConversationId) return;
    if (pendingForwardSourceChat === currentActiveChat) return;

    const payload = pendingForward;
    clearPendingForward();

    const contentType = payload.contentType || 'text';
    const hasMedia = contentType !== 'text' && payload.mediaUrl;

    await dispatchOutgoingMessage({
        body: payload.body || '',
        contentType: hasMedia ? contentType : 'text',
        mediaUrl: hasMedia ? payload.mediaUrl : null
    });

    showNotify('Mesaj iletildi.', { title: 'İlet', type: 'success' });
}

async function openChat(chatId, title, { avatarUrl = null } = {}) {
    if (!chatId?.startsWith('User-')) {
        await showChatListHome();
        return;
    }

    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    showChatConversationUi();
    messageHistoryLoadId += 1;
    clearMessageContainer();
    currentActiveChat = chatId;
    const senderId = chatId.replace('User-', '');
    markNotificationsReadForChat(chatId, senderId);
    clearPendingQuote();
    clearPendingComposerMedia();
    exitSelectionMode(document.getElementById('messageContainer'));
    updateSelectionBarUi(0);
    switchView('chat-panel');
    if (isMobileLayout()) closeSidebar();

    document.getElementById('activeChatName').textContent = title;
    const statusEl = document.getElementById('activeChatStatus');
    const activeChatAvatar = document.getElementById('activeChatAvatar');

    statusEl.textContent = '';
    statusEl.style.display = 'none';
    const userId = senderId;
    const partnerAvatar = await resolveDmPartnerAvatar(userId, avatarUrl);
    applyAvatarDisplay(activeChatAvatar, partnerAvatar, title);

    document.querySelectorAll('.chat-item').forEach((item) => item.classList.remove('active'));

    dmTitles.set(userId, title);
    const listItem = document.getElementById(`user-${userId}`);
    if (listItem) listItem.classList.add('active');
    currentConversationId = dmConversations.get(userId);

    if (!currentConversationId) {
        clearMessageContainer();
        showEmptyChat();
        leaveRealtimeRoom();
        return;
    }

    subscribeDmRealtime(currentConversationId);
    refreshDmNotificationListeners();
    await loadMessageHistory(currentConversationId);

    await deliverPendingForward();

    saveAppRoute();
}

async function sendMessage() {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    const input = document.getElementById('messageInput');
    const body = sanitizeText(input?.value || '', 2000);
    const quote = getPendingQuote();

    if (typeof finishVoiceRecordingToPending === 'function') {
        await finishVoiceRecordingToPending();
    }

    if (isMediaSendModalOpen()) return;

    const hasPendingMedia = Boolean(pendingComposerMedia);
    if (!body && !hasPendingMedia) return;

    try {
        if (hasPendingMedia) {
            const ready = await ensurePendingMediaReady();
            clearPendingQuote();
            if (input) input.value = '';

            await dispatchOutgoingMessage({
                body,
                contentType: ready.kind,
                mediaUrl: ready.url,
                r2Key: ready.r2Key,
                quote
            });

            clearPendingComposerMedia();
            return;
        }

        clearPendingQuote();
        if (input) input.value = '';
        await dispatchOutgoingMessage({ body, contentType: 'text', quote });
    } catch (err) {
        showNotify(err.message || 'Mesaj gönderilemedi.', {
            title: 'Gönderim hatası',
            type: 'error'
        });
    }
}

async function toggleMessageReaction({ messageId, clientId, emoji }) {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    let resolvedMessageId = messageId;
    if (!resolvedMessageId && clientId) {
        const { data } = await supabase
            .from('messages')
            .select('id')
            .eq('client_id', clientId)
            .maybeSingle();
        resolvedMessageId = data?.id || null;
        if (resolvedMessageId) {
            setMessageDbIdByClientId(clientId, resolvedMessageId);
        }
    }

    let action = 'add';
    const messageEl = findMessageElement({ messageId: resolvedMessageId, clientId });

    if (!resolvedMessageId) {
        const minePill = messageEl?.querySelector('.message-reaction-pill.mine');
        action = minePill?.dataset.emoji === emoji ? 'remove' : 'add';
    } else {
        const { data: existing } = await supabase
            .from('message_reactions')
            .select('id, emoji')
            .eq('message_id', resolvedMessageId)
            .eq('user_id', currentUserId)
            .maybeSingle();

        if (existing?.emoji === emoji) {
            const { error } = await supabase
                .from('message_reactions')
                .delete()
                .eq('id', existing.id);
            if (error) {
                console.error('Tepki kaldırılamadı:', error.message);
                return;
            }
            action = 'remove';
        } else if (existing) {
            const { error } = await supabase
                .from('message_reactions')
                .update({ emoji })
                .eq('id', existing.id);
            if (error) {
                console.error('Tepki güncellenemedi:', error.message);
                return;
            }
        } else {
            const { error } = await supabase
                .from('message_reactions')
                .insert({
                    message_id: resolvedMessageId,
                    user_id: currentUserId,
                    emoji
                });
            if (error) {
                console.error('Tepki eklenemedi:', error.message);
                return;
            }
        }
    }

    if (messageEl) {
        handleIncomingReaction({
            message_id: resolvedMessageId,
            client_id: clientId,
            emoji,
            user_id: currentUserId,
            action
        }, currentUserId);
    }

    broadcastReaction({
        message_id: resolvedMessageId,
        client_id: clientId,
        emoji,
        user_id: currentUserId,
        action
    }).catch((err) => console.error('Tepki yayını başarısız:', err));
}

async function openChatFromSender(senderId, username) {
    if (!isLoggedIn()) {
        promptLogin();
        return;
    }

    if (senderId && senderId === currentUserId) return;

    let userId = senderId;

    if (!userId && username) {
        const { data } = await supabase
            .from('profiles')
            .select('id')
            .eq('username', username)
            .maybeSingle();
        userId = data?.id;
    }

    if (!userId) return;

    await openDmByUserId(userId, username || null);
}

function formatChatListTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return formatTime(dateString);
    }
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function setDmListSectionVisible(visible) {
    const title = document.getElementById('dmListSectionTitle');
    if (title) title.hidden = !visible;
}

function renderDmEmptyState() {
    const list = document.getElementById('myActiveChatsList');
    if (!list) return;

    list.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'chat-list-empty';
    empty.textContent = isLoggedIn()
        ? 'Henüz sohbet yok. Size gönderilen kullanıcı linki ile yeni bir sohbet başlatabilirsiniz.'
        : 'Giriş yaparak sohbetlerinizi görüntüleyin.';
    list.appendChild(empty);
    setDmListSectionVisible(false);
}

async function openDefaultStartupChat() {
    await showChatListHome();
}

function previewFromMessage({ body = '', contentType = 'text', isOutgoing = false }) {
    const prefix = isOutgoing ? 'Sen: ' : '';

    if (contentType === 'image') return `${prefix}📷 Fotoğraf`;
    if (contentType === 'video') return `${prefix}🎬 Video`;
    if (contentType === 'audio') return `${prefix}🎤 Ses`;

    const text = sanitizeText(body, 80);
    return text ? `${prefix}${text}` : `${prefix}Mesaj`;
}

function updateDmSidebarPreview(userId, preview, createdAt = null) {
    if (!userId || !preview) return;

    const item = document.getElementById(`user-${userId}`);
    if (!item) return;

    let previewEl = item.querySelector('.chat-preview');
    if (!previewEl) {
        previewEl = document.createElement('div');
        previewEl.className = 'chat-preview';
        item.querySelector('.chat-info')?.appendChild(previewEl);
    }
    previewEl.textContent = preview;

    if (createdAt) {
        const top = item.querySelector('.chat-info-top');
        let timeEl = item.querySelector('.chat-time');
        if (!timeEl && top) {
            timeEl = document.createElement('span');
            timeEl.className = 'chat-time';
            top.appendChild(timeEl);
        }
        if (timeEl) timeEl.textContent = formatChatListTime(createdAt);
    }

    const list = document.getElementById('myActiveChatsList');
    if (list && item.parentElement === list) {
        list.insertBefore(item, list.firstChild);
        setDmListSectionVisible(true);
    }
}

function syncDmSidebarPreview(chatId, payload, isOutgoing) {
    if (!chatId?.startsWith('User-')) return;

    const userId = isOutgoing
        ? chatId.replace('User-', '')
        : payload?.sender_id;

    if (!userId) return;

    updateDmSidebarPreview(userId, previewFromMessage({
        body: payload?.body || '',
        contentType: payload?.content_type || payload?.contentType || 'text',
        isOutgoing
    }), payload?.created_at || null);
}

function addDmToSidebar(userId, username, preview = '', avatarUrl = null, {
    lastTime = null,
    append = false
} = {}) {
    const list = document.getElementById('myActiveChatsList');
    if (document.getElementById(`user-${userId}`)) return;

    const item = document.createElement('div');
    item.className = 'chat-item';
    item.id = `user-${userId}`;
    item.addEventListener('click', () => {
        openChat(`User-${userId}`, username);
        closeSidebar();
    });

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    applyAvatarDisplay(avatar, avatarUrl, username);

    const info = document.createElement('div');
    info.className = 'chat-info';

    const name = document.createElement('span');
    name.className = 'chat-name';
    name.textContent = username;

    const top = document.createElement('div');
    top.className = 'chat-info-top';
    top.appendChild(name);

    if (lastTime) {
        const timeEl = document.createElement('span');
        timeEl.className = 'chat-time';
        timeEl.textContent = formatChatListTime(lastTime);
        top.appendChild(timeEl);
    }

    info.appendChild(top);

    if (preview) {
        const previewEl = document.createElement('div');
        previewEl.className = 'chat-preview';
        previewEl.textContent = preview;
        info.appendChild(previewEl);
    }

    item.append(avatar, info);

    if (append) list.appendChild(item);
    else list.insertBefore(item, list.firstChild);
    setDmListSectionVisible(true);
}

async function loadDmHistory() {
    mostRecentDmChat = null;
    dmConversations.clear();
    dmTitles.clear();

    const list = document.getElementById('myActiveChatsList');
    if (list) list.innerHTML = '';

    if (!isLoggedIn()) {
        renderDmEmptyState();
        return null;
    }

    const { data: memberships, error: membershipError } = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', currentUserId);

    if (membershipError || !memberships?.length) {
        renderDmEmptyState();
        return null;
    }

    const membershipIds = memberships.map((m) => m.conversation_id);

    const { data: conversations, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .in('id', membershipIds)
        .eq('type', 'dm');

    if (convError || !conversations?.length) {
        renderDmEmptyState();
        return null;
    }

    const dmConvIds = conversations.map((c) => c.id);

    const [
        { data: otherMembers, error: otherError },
        { data: messages, error: messagesError }
    ] = await Promise.all([
        supabase
            .from('conversation_members')
            .select('conversation_id, user_id')
            .in('conversation_id', dmConvIds)
            .neq('user_id', currentUserId),
        supabase
            .from('messages')
            .select('conversation_id, body, content_type, sender_id, created_at')
            .in('conversation_id', dmConvIds)
            .order('created_at', { ascending: false })
    ]);

    if (otherError || messagesError || !otherMembers?.length) {
        renderDmEmptyState();
        return null;
    }

    const lastMessageByConv = new Map();
    for (const msg of messages || []) {
        if (!lastMessageByConv.has(msg.conversation_id)) {
            lastMessageByConv.set(msg.conversation_id, msg);
        }
    }

    const chats = otherMembers
        .map((member) => {
            const lastMsg = lastMessageByConv.get(member.conversation_id);
            if (!lastMsg) return null;
            return {
                userId: member.user_id,
                conversationId: member.conversation_id,
                lastMsg
            };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.lastMsg.created_at) - new Date(a.lastMsg.created_at));

    if (!chats.length) {
        renderDmEmptyState();
        return null;
    }

    const userIds = [...new Set(chats.map((chat) => chat.userId))];
    const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', userIds);

    if (profileError || !profiles?.length) {
        renderDmEmptyState();
        return null;
    }

    const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
    setDmListSectionVisible(true);

    for (const chat of chats) {
        const profile = profileMap[chat.userId];
        if (!profile) continue;

        dmConversations.set(chat.userId, chat.conversationId);
        dmTitles.set(chat.userId, profile.username);

        addDmToSidebar(
            chat.userId,
            profile.username,
            previewFromMessage({
                body: chat.lastMsg.body,
                contentType: chat.lastMsg.content_type || 'text',
                isOutgoing: chat.lastMsg.sender_id === currentUserId
            }),
            profile.avatar_url,
            {
                lastTime: chat.lastMsg.created_at,
                append: true
            }
        );
    }

    const first = chats[0];
    const firstProfile = profileMap[first.userId];
    if (first && firstProfile) {
        mostRecentDmChat = {
            userId: first.userId,
            username: firstProfile.username,
            conversationId: first.conversationId
        };
    }

    refreshDmNotificationListeners();
    return mostRecentDmChat;
}

async function handleLogout() {
    if (!isLoggedIn()) return;

    leaveRealtimeRoom();
    leaveDmNotificationRooms();
    await supabase.auth.signOut();
    currentUserId = null;
    currentMyUsername = 'Misafir';
    currentMyAvatarUrl = null;
    currentMyAvatarR2Key = null;
    dmConversations.clear();
    dmTitles.clear();
    mostRecentDmChat = null;
    renderDmEmptyState();
    closeTopbarMenus();
    setNotificationUser(null);
    resetCloudPanel();
    refreshAvatarDisplays();
    refreshTopbarMenu();
    updateMessageInputState();
    await showChatListHome();
    syncAuthGateUi();
    maybeShowWelcomeModal();
}

async function refreshSessionState() {
    const session = await getSession();

    if (session) {
        currentUserId = session.user.id;
        closeWelcomeModal();
        setNotificationUser(currentUserId);
        profileReadyPromise = loadProfile();
        await profileReadyPromise;
        document.getElementById('myActiveChatsList').innerHTML = '';
        await loadDmHistory();

        if (currentActiveChat?.startsWith('User-') && currentConversationId) {
            subscribeDmRealtime(currentConversationId);
        }

        refreshAvatarDisplays();
        await refreshCloudAdminStatus();
        refreshTopbarMenu();
    } else {
        setNotificationUser(null);
        resetCloudPanel();
        renderDmEmptyState();
        refreshAvatarDisplays();
        refreshTopbarMenu();
        updateMessageInputState();
        maybeShowWelcomeModal();
    }

    syncAuthGateUi();
}

function bootstrapAppUi() {
    syncAuthGateUi();
    refreshAvatarDisplays();
    refreshTopbarMenu();
    updateMessageInputState();
    syncTopbarMenuIcon();
}

function runInitStep(name, fn) {
    try {
        fn();
    } catch (err) {
        console.error(`[woxifly] ${name} failed:`, err);
    }
}

async function initDashboard() {
    bootstrapAppUi();

    runInitStep('initSeo', initSeo);
    runInitStep('initPasswordVisibilityToggles', () => initPasswordVisibilityToggles());
    runInitStep('initHmCamouflage', initHmCamouflage);
    runInitStep('initLinkViewer', initLinkViewer);
    runInitStep('initViewer', initViewer);
    runInitStep('initCloudPanel', () => initCloudPanel({
        getSession,
        isLoggedIn,
        switchView,
        promptLogin,
        showNotify,
        onAdminStatusChange: () => refreshTopbarMenu()
    }));
    runInitStep('initAuthModal', () => initAuthModal(refreshSessionState));
    runInitStep('initWelcomeModal', () => initWelcomeModal({
        isLoggedIn,
        onLogin: promptLogin,
        onRegister: promptRegister
    }));
    runInitStep('initNotifyModal', initNotifyModal);
    if (window.__woxiflyStrippedSensitiveQuery) {
        delete window.__woxiflyStrippedSensitiveQuery;
        showNotify(
            'E-posta ve şifre adres çubuğunda görünmemeli. Bu bağlantıyı açtıysanız şifrenizi değiştirmeniz önerilir.',
            { title: 'Güvenlik uyarısı', type: 'warning' }
        );
    }
    runInitStep('initMediaComposer', initMediaComposer);
    runInitStep('initMessageInteractions', () => initMessageInteractions({
        messageContainer: document.getElementById('messageContainer'),
        isLoggedIn,
        promptLogin,
        getViewerContext: () => ({
            userId: currentUserId,
            username: currentMyUsername,
            showQuoteAuthor: false
        }),
        onReactionToggle: toggleMessageReaction,
        onDeleteMessages: softDeleteMessages,
        onSelectionChange: updateSelectionBarUi,
        onForwardMessage: handleForwardRequest,
        showNotify
    }));
    runInitStep('initMessageSelectionControls', initMessageSelectionControls);
    document.getElementById('appHomeLink')?.addEventListener('click', (event) => {
        event.preventDefault();
        showChatListHome();
    });
    runInitStep('initProfileAvatar', initProfileAvatar);
    runInitStep('initPushControls', initPushControls);
    runInitStep('initNotificationCenter', () => initNotificationCenter({
        onNavigate: (route) => {
            if (route) openChatFromNotification(route);
        }
    }));
    supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user?.id && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
            void refreshCloudAdminStatus().then(() => refreshTopbarMenu());
        }
    });
    bootstrapAppUi();

    const pushInitPromise = initPushNotifications()
        .then(() => finalizePushInit())
        .then(() => updatePushStatusUI())
        .catch(() => updatePushStatusUI());

    const session = await getSession();

    if (session) {
        currentUserId = session.user.id;
        closeWelcomeModal();
        setNotificationUser(currentUserId);
        profileReadyPromise = loadProfile();
        await profileReadyPromise;
        await refreshCloudAdminStatus();
        document.getElementById('myActiveChatsList').innerHTML = '';
        await loadDmHistory();
    } else {
        renderDmEmptyState();
        setNotificationUser(null);
        resetCloudPanel();
        maybeShowWelcomeModal();
    }

    syncAuthGateUi();
    refreshAvatarDisplays();
    refreshTopbarMenu();

    if (session) {
        const route = parseAppRoute();
        if (route) {
            await restoreAppRoute(route);
            saveAppRoute();
        } else {
            await openDefaultStartupChat();
        }

        await handleStartupNotificationRoute();
    }

    const params = new URLSearchParams(window.location.search);
    const authMode = params.get('auth');
    if (authMode === 'register') openAuthModal('register');
    else if (authMode === 'login') openAuthModal('login');
    if (authMode) {
        params.delete('auth');
        const qs = params.toString();
        history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }

    window.addEventListener('popstate', async () => {
        if (!isLoggedIn()) {
            maybeShowWelcomeModal();
            return;
        }
        const nextRoute = parseAppRoute();
        if (nextRoute) {
            await restoreAppRoute(nextRoute);
        } else {
            await showChatListHome();
        }
    });
    window.addEventListener('woxifly:notification-click', (event) => {
        handleNotificationNavigation(event.detail || {});
    });

    syncTopbarMenuIcon();
    void pushInitPromise;
}

function triggerPushForMessage(conversationId) {
    if (!conversationId) return;
    notifyPushRecipients({ conversationId });
}

function initPushControls() {
    const pushBtn = document.getElementById('pushToggleBtn');

    pushBtn?.addEventListener('click', async () => {
        if (!isLoggedIn()) {
            promptLogin();
            return;
        }

        try {
            const before = await getPushSubscriptionState();
            await togglePushNotifications();
            const after = await getPushSubscriptionState();
            updatePushStatusUI();

            if (after.pushEnabled && !before.pushEnabled) {
                showNotify(
                    after.subscribed
                        ? 'Bildirimler açıldı. Masaüstünde arka planda da uyarı alırsınız.'
                        : 'Bildirimler açıldı. Sekme açıkken masaüstü uyarıları alırsınız.',
                    { title: 'Bildirimler', type: 'info' }
                );
            } else if (!after.pushEnabled && before.pushEnabled) {
                showNotify('Bildirimler kapatıldı.', { title: 'Bildirimler', type: 'info' });
            }
        } catch (err) {
            showNotify(err.message || 'Bildirim ayarı değiştirilemedi.', {
                title: 'Bildirimler',
                type: 'error'
            });
        }
    });
}

async function updatePushStatusUI() {
    const statusEl = document.getElementById('pushStatusText');
    const btn = document.getElementById('pushToggleBtn');
    if (!statusEl || !btn) return;

    const state = await getPushSubscriptionState();
    const ui = describePushStatus(state);

    statusEl.textContent = ui.text;
    statusEl.className = ui.className;
    btn.textContent = ui.buttonText;
    btn.disabled = ui.disabled;
}

async function openChatFromNotification(route) {
    if (!route?.chatId && !route?.userId && !route?.usernameSlug) return;

    if (route.usernameSlug) {
        await openDmByUsernameSlug(route.usernameSlug);
        return;
    }

    const userId = route.userId || route.chatId?.replace('User-', '');
    if (userId) {
        await openDmByUserId(userId);
    }
}

async function handleNotificationNavigation(data) {
    const route = parseNotificationRoute(data) || (data.chatId ? data : null);
    if (!route) return;

    clearNotifyQueryParam();
    await openChatFromNotification(route);
}

async function handleStartupNotificationRoute() {
    const route = parseNotifyQueryParam();
    if (!route) return;

    clearNotifyQueryParam();
    await openChatFromNotification(route);
}

configureTopbar({
    getIsLoggedIn: isLoggedIn,
    getIsCloudAdmin: isCloudAdminUser,
    onLogin: promptLogin,
    onRegister: promptRegister,
    onProfileSettings: openProfileSettings,
    onCloudPanel: openCloudAdminPanel,
    onLogout: handleLogout,
    onMenuClick: () => window.toggleSidebar?.(),
    onProfileMenuOpen: () => refreshCloudAdminStatus()
});

refreshTopbarMenu();
bootstrapAppUi();
initDashboard().catch((err) => {
    console.error('[woxifly] initDashboard failed:', err);
    bootstrapAppUi();
});
