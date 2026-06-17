import webpush from 'web-push';
import { getVapidConfig } from './env.js';

let configured = false;

function ensureConfigured() {
    if (configured) return getVapidConfig();

    const config = getVapidConfig();
    if (config.error) return config;

    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    configured = true;
    return config;
}

export function getVapidPublicKey() {
    const config = getVapidConfig();
    if (config.error) return { error: config.error };
    return { publicKey: config.publicKey };
}

export async function sendMaskedPush(subscription, navigationData) {
    const config = ensureConfigured();
    if (config.error) return { error: config.error, skipped: true };

    const payload = JSON.stringify({
        tag: navigationData.tag || `woxifly-${Date.now()}`,
        chatType: navigationData.chatType,
        district: navigationData.district || null,
        userId: navigationData.userId || null,
        username: navigationData.username || null
    });

    try {
        await webpush.sendNotification(
            {
                endpoint: subscription.endpoint,
                keys: {
                    p256dh: subscription.p256dh,
                    auth: subscription.auth_key
                }
            },
            payload,
            { TTL: 60 * 60 }
        );
        return { ok: true };
    } catch (err) {
        const status = err?.statusCode || err?.status;
        if (status === 404 || status === 410) {
            return { expired: true, endpoint: subscription.endpoint };
        }
        return { error: err?.message || 'Push gönderilemedi.' };
    }
}
