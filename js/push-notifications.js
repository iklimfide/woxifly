import { supabase, getSession } from './supabase-client.js';
import { parseLegacyNotifyParam, usernameToSlug } from './app-routes.js';

const MASKED_TITLE = 'Woxifly: Yeni bildirim';

let pushSupported = false;
let initReason = null;
let profilePushEnabled = false;
const foregroundNotificationCounts = new Map();

function buildNotificationTag(data) {
    if (data.userId) return `dm-${data.userId}`;
    return 'woxifly-notification';
}

function detectBrowserCapability() {
    if (typeof window === 'undefined') {
        return { supported: false, reason: 'no_window' };
    }
    if (!window.isSecureContext) {
        return { supported: false, reason: 'insecure_context' };
    }
    if (!('Notification' in window)) {
        return { supported: false, reason: 'no_notification_api' };
    }
    return { supported: true, reason: null };
}

async function unregisterLegacyServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;

    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
    } catch (err) {
        console.warn('Eski service worker kaldırılamadı:', err);
    }
}

async function getPushEnabledFromProfile() {
    const session = await getSession();
    if (!session) return false;

    const { data, error } = await supabase
        .from('profiles')
        .select('push_enabled')
        .eq('id', session.user.id)
        .maybeSingle();

    if (error) {
        console.warn('push_enabled okunamadı:', error.message);
        return profilePushEnabled;
    }

    profilePushEnabled = data?.push_enabled === true;
    return profilePushEnabled;
}

export async function syncPushEnabledFromProfile() {
    return getPushEnabledFromProfile();
}

async function setPushEnabledInProfile(enabled) {
    const session = await getSession();
    if (!session) throw new Error('Oturum gerekli.');

    const { error } = await supabase.from('profiles').update({
        push_enabled: enabled,
        updated_at: new Date().toISOString()
    }).eq('id', session.user.id);

    if (error) throw new Error(error.message);
    profilePushEnabled = enabled;
}

export function isPushSupported() {
    return pushSupported;
}

export function isWebPushReady() {
    return false;
}

export function getPushInitReason() {
    return initReason;
}

export async function initPushNotifications() {
    await unregisterLegacyServiceWorkers();

    const capability = detectBrowserCapability();
    pushSupported = capability.supported;
    initReason = capability.reason;

    if (!pushSupported) {
        return { enabled: false, reason: initReason };
    }

    return { enabled: true, reason: null };
}

export async function finalizePushInit() {
    await syncPushEnabledFromProfile().catch(() => {});
    return getPushSubscriptionState();
}

export async function ensurePushSubscription() {
    return getPushSubscriptionState();
}

export function getNotificationPermission() {
    if (!pushSupported) return 'unsupported';
    return Notification.permission;
}

export async function getPushSubscriptionState() {
    const permission = getNotificationPermission();
    const pushEnabled = await getPushEnabledFromProfile();
    const active = pushEnabled && permission === 'granted';

    return {
        subscribed: active,
        pushEnabled,
        permission,
        endpoint: null,
        foregroundOnly: false
    };
}

export async function enablePushNotifications() {
    if (!pushSupported) {
        if (initReason === 'insecure_context') {
            throw new Error('Bildirimler için HTTPS gerekli (localhost hariç).');
        }
        throw new Error('Bu tarayıcı bildirimlerini desteklemiyor.');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error('Bildirim izni verilmedi.');
    }

    await setPushEnabledInProfile(true);
    return getPushSubscriptionState();
}

export async function disablePushNotifications() {
    try {
        await setPushEnabledInProfile(false);
    } catch {
        // Oturum yoksa sessizce geç
    }

    return getPushSubscriptionState();
}

export async function togglePushNotifications() {
    const pushEnabled = await getPushEnabledFromProfile();
    if (pushEnabled) {
        return disablePushNotifications();
    }
    return enablePushNotifications();
}

export async function notifyPushRecipients() {
    // Arka plan Web Push devre dışı — bildirimler tarayıcı sekmesi + çan ikonu ile gelir.
}

export function buildNotificationDataFromPayload(payload) {
    if (payload?.sender_id) {
        return { userId: payload.sender_id };
    }
    return null;
}

export function maybeShowForegroundNotification(payload, {
    viewingConversationId = null,
    messageConversationId = null
} = {}) {
    if (!pushSupported || !profilePushEnabled || Notification.permission !== 'granted') return;

    const chatPanelActive = document.getElementById('chat-panel')?.classList.contains('active');
    const viewingSameChat = chatPanelActive
        && viewingConversationId
        && messageConversationId
        && viewingConversationId === messageConversationId;
    if (!document.hidden && document.hasFocus() && viewingSameChat) return;

    const data = buildNotificationDataFromPayload(payload);
    if (!data) return;

    const tag = buildNotificationTag(data);
    const count = (foregroundNotificationCounts.get(tag) || 0) + 1;
    foregroundNotificationCounts.set(tag, count);

    const notification = new Notification(MASKED_TITLE, {
        body: count > 1 ? `${count} yeni mesaj` : '',
        icon: '/icons/icon-192.png',
        tag,
        renotify: count > 1,
        data: { ...data, count }
    });

    notification.onclick = () => {
        foregroundNotificationCounts.delete(tag);
        window.focus();
        notification.close();
        window.dispatchEvent(new CustomEvent('woxifly:notification-click', { detail: data }));
    };
}

export function parseNotificationRoute(data) {
    if (data.username) {
        return { usernameSlug: usernameToSlug(data.username) };
    }
    if (data.userId) {
        return { userId: data.userId };
    }
    return null;
}

export function parseNotifyQueryParam() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('notify');
    if (!raw) return null;

    return parseLegacyNotifyParam(raw);
}

export function clearNotifyQueryParam() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('notify')) return;
    params.delete('notify');
    const qs = params.toString();
    history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export function describePushStatus({ permission, subscribed, pushEnabled }) {
    if (!pushSupported) {
        if (initReason === 'insecure_context') {
            return {
                text: 'Bildirimler için HTTPS gerekli. localhost veya güvenli alan adı kullanın.',
                className: 'push-status push-status--off',
                buttonText: 'Bildirim İzinlerini Yönet',
                disabled: true
            };
        }
        return {
            text: 'Bu tarayıcı bildirim API\'sini desteklemiyor.',
            className: 'push-status push-status--off',
            buttonText: 'Bildirim İzinlerini Yönet',
            disabled: true
        };
    }

    if (!pushEnabled) {
        if (permission === 'denied') {
            return {
                text: 'Bildirim izni tarayıcı ayarlarından engellenmiş.',
                className: 'push-status push-status--off',
                buttonText: 'Bildirim İzinlerini Yönet',
                disabled: false
            };
        }

        const reopenLabel = permission === 'granted' ? 'Bildirimleri Aç' : 'Bildirim İzinlerini Yönet';
        const text = permission === 'default'
            ? 'Bildirimler kapalı. Açmak için tarayıcıdan izin vermeniz gerekir.'
            : 'Bildirimler kapalı.';

        return {
            text,
            className: 'push-status push-status--off',
            buttonText: reopenLabel,
            disabled: false
        };
    }

    if (subscribed) {
        return {
            text: 'Bildirimler açık. Tarayıcı sekmesi açıkken uyarı ve çan ikonu çalışır.',
            className: 'push-status push-status--on',
            buttonText: 'Bildirimleri Kapat',
            disabled: false
        };
    }

    if (permission === 'denied') {
        return {
            text: 'Bildirim izni tarayıcı ayarlarından engellenmiş.',
            className: 'push-status push-status--off',
            buttonText: 'Bildirimleri Kapat',
            disabled: true
        };
    }

    return {
        text: 'Bildirimler açık; tarayıcı izni bekleniyor.',
        className: 'push-status push-status--on',
        buttonText: 'Bildirimleri Kapat',
        disabled: false
    };
}
