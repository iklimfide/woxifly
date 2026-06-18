import { supabase, getSession } from './supabase-client.js';
import { parseLegacyNotifyParam, usernameToSlug } from './app-routes.js';

const SW_URL = '/service-worker.js';
const MASKED_TITLE = 'Woxifly: Yeni bildirim';

let swRegistration = null;
let vapidPublicKey = null;
let pushSupported = false;
let webPushReady = false;
let initReason = null;
const foregroundNotificationCounts = new Map();

function buildNotificationTag(data) {
    if (data.chatType === 'group') {
        return `group-${data.district}-${data.userId || 'room'}`;
    }
    if (data.userId) return `dm-${data.userId}`;
    return 'woxifly-notification';
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
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

async function authHeaders() {
    const session = await getSession();
    if (!session?.access_token) return null;
    return {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
    };
}

async function setPushEnabledInProfile(enabled) {
    const session = await getSession();
    if (!session) throw new Error('Oturum gerekli.');

    const { error } = await supabase.from('profiles').update({
        push_enabled: enabled,
        updated_at: new Date().toISOString()
    }).eq('id', session.user.id);

    if (error) throw new Error(error.message);
}

export function isPushSupported() {
    return pushSupported;
}

export function isWebPushReady() {
    return webPushReady;
}

export function getPushInitReason() {
    return initReason;
}

function waitForServiceWorkerReady(timeoutMs = 8000) {
    if (!navigator.serviceWorker?.ready) {
        return Promise.resolve(null);
    }

    return Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error('service_worker_ready_timeout')), timeoutMs);
        })
    ]);
}

export async function initPushNotifications() {
    const capability = detectBrowserCapability();
    pushSupported = capability.supported;
    initReason = capability.reason;
    webPushReady = false;

    if (!pushSupported) {
        return { enabled: false, reason: initReason };
    }

    if ('serviceWorker' in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register(SW_URL, {
                scope: '/',
                updateViaCache: 'none'
            });
            await waitForServiceWorkerReady();
            swRegistration.update().catch(() => {});

            swRegistration.addEventListener('updatefound', () => {
                const worker = swRegistration.installing;
                if (!worker) return;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                        worker.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });

            if (swRegistration.waiting) {
                swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            let swReloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (swReloading) return;
                swReloading = true;
                window.location.reload();
            });

            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'NOTIFICATION_CLICK') {
                    window.dispatchEvent(new CustomEvent('woxifly:notification-click', {
                        detail: event.data.data || {}
                    }));
                }
            });
        } catch (err) {
            console.warn('Service worker kaydı başarısız:', err);
            swRegistration = null;
            initReason = err?.message === 'service_worker_ready_timeout'
                ? 'sw_ready_timeout'
                : 'sw_register_failed';
        }
    } else {
        initReason = 'no_service_worker';
    }

    if (swRegistration?.pushManager) {
        try {
            const res = await fetch('/api/push-vapid-public');
            const data = await res.json().catch(() => ({}));
            if (data.enabled && data.publicKey) {
                vapidPublicKey = data.publicKey;
                webPushReady = true;
                initReason = null;
            } else if (!initReason) {
                initReason = data.error ? 'vapid_missing' : 'vapid_unavailable';
            }
        } catch (err) {
            console.warn('VAPID anahtarı alınamadı:', err);
            if (!initReason) initReason = 'vapid_fetch_failed';
        }
    } else if (!initReason) {
        initReason = 'no_push_manager';
    }

    return {
        enabled: true,
        webPush: webPushReady,
        reason: initReason
    };
}

export function getNotificationPermission() {
    if (!pushSupported) return 'unsupported';
    return Notification.permission;
}

export async function getPushSubscriptionState() {
    const permission = getNotificationPermission();
    if (!swRegistration?.pushManager) {
        return { subscribed: false, permission, endpoint: null, foregroundOnly: permission === 'granted' };
    }

    const sub = await swRegistration.pushManager.getSubscription();
    return {
        subscribed: !!sub,
        permission,
        endpoint: sub?.endpoint || null,
        foregroundOnly: permission === 'granted' && !sub
    };
}

async function saveSubscription(subscription) {
    const headers = await authHeaders();
    if (!headers) throw new Error('Oturum gerekli.');

    const json = subscription.toJSON();
    const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers,
        body: JSON.stringify({
            endpoint: json.endpoint,
            keys: json.keys
        })
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Abonelik kaydedilemedi.');
    }
}

async function removeSubscription(endpoint) {
    const headers = await authHeaders();
    if (!headers) return;

    await fetch(`/api/push-subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
        headers
    });
}

export async function enablePushNotifications() {
    if (!pushSupported) {
        if (initReason === 'insecure_context') {
            throw new Error('Bildirimler için HTTPS gerekli (localhost hariç).');
        }
        throw new Error('Bu tarayıcı masaüstü bildirimlerini desteklemiyor.');
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error('Bildirim izni verilmedi.');
    }

    await setPushEnabledInProfile(true);

    if (webPushReady && swRegistration?.pushManager && vapidPublicKey) {
        let subscription = await swRegistration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
            });
        }
        await saveSubscription(subscription);
    }

    return getPushSubscriptionState();
}

export async function disablePushNotifications() {
    if (swRegistration?.pushManager) {
        const subscription = await swRegistration.pushManager.getSubscription();
        if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            await removeSubscription(endpoint);
        }
    }

    try {
        await setPushEnabledInProfile(false);
    } catch {
        // Oturum yoksa sessizce geç
    }

    return getPushSubscriptionState();
}

export async function togglePushNotifications() {
    const state = await getPushSubscriptionState();
    if (state.subscribed || state.foregroundOnly) {
        return disablePushNotifications();
    }
    return enablePushNotifications();
}

export async function notifyPushRecipients({ conversationId }) {
    const headers = await authHeaders();
    if (!headers || !conversationId) return;

    fetch('/api/push-notify', {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationId })
    }).catch((err) => console.warn('Push bildirimi tetiklenemedi:', err));
}

export function buildNotificationDataFromPayload(payload, activeChatId) {
    if (activeChatId?.startsWith('Group-')) {
        return {
            chatType: 'group',
            district: activeChatId.replace('Group-', ''),
            userId: payload?.sender_id || null
        };
    }
    if (payload?.sender_id) {
        return {
            chatType: 'dm',
            userId: payload.sender_id
        };
    }
    return null;
}

export function maybeShowForegroundNotification(payload, activeChatId) {
    if (!pushSupported || Notification.permission !== 'granted') return;

    const onChatPanel = document.getElementById('chat-panel')?.classList.contains('active');
    if (!document.hidden && document.hasFocus() && onChatPanel) return;

    const data = buildNotificationDataFromPayload(payload, activeChatId);
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
    if (data.chatType === 'group' && data.district) {
        return { chatId: `Group-${data.district}` };
    }
    if (data.chatType === 'dm' && data.username) {
        return { usernameSlug: usernameToSlug(data.username) };
    }
    if (data.chatType === 'dm' && data.userId) {
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

export function describePushStatus({ permission, subscribed, foregroundOnly }) {
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

    if (subscribed) {
        return {
            text: 'Bildirimler açık (arka plan + masaüstü) — yalnızca maske metin gösterilir.',
            className: 'push-status push-status--on',
            buttonText: 'Bildirimleri Kapat',
            disabled: false
        };
    }

    if (foregroundOnly) {
        const hint = webPushReady ? '' : ' Arka plan push sunucusu yapılandırılmamış; sekme açıkken bildirim alırsınız.';
        return {
            text: `Masaüstü bildirimleri açık (ön plan).${hint}`,
            className: 'push-status push-status--on',
            buttonText: 'Bildirimleri Kapat',
            disabled: false
        };
    }

    if (permission === 'denied') {
        return {
            text: 'Bildirim izni tarayıcı ayarlarından engellenmiş.',
            className: 'push-status push-status--off',
            buttonText: 'Bildirim İzinlerini Yönet',
            disabled: false
        };
    }

    const desktopHint = webPushReady
        ? ' Chrome, Edge ve Firefox masaüstünde desteklenir.'
        : ' API çalışıyor; tam arka plan push için VAPID anahtarları gerekli.';

    return {
        text: `Bildirimler kapalı.${desktopHint}`,
        className: 'push-status push-status--off',
        buttonText: 'Bildirim İzinlerini Yönet',
        disabled: false
    };
}
