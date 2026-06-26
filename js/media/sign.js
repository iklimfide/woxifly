import { getSession } from '../supabase-client.js';
import { displayMediaUrl, mediaR2KeyFromMessage } from './urls.js';

const SIGN_URL = '/api/media-sign';
const cache = new Map();

function cacheEntry(url) {
    const match = /[?&]exp=(\d+)/.exec(url || '');
    return {
        url,
        exp: Number(match?.[1] || 0)
    };
}

function isFresh(entry) {
    return entry && entry.exp > Math.floor(Date.now() / 1000) + 120;
}

function needsSignature(path) {
    return path && !path.startsWith('avatars/') && !path.startsWith('blob:');
}

export function mediaPathNeedsSignature(pathOrUrl) {
    const path = mediaR2KeyFromMessage(pathOrUrl, pathOrUrl);
    return needsSignature(path);
}

export async function signMediaPaths(keys) {
    const unique = [...new Set((keys || []).map((key) => mediaR2KeyFromMessage(null, key)).filter(needsSignature))];
    const missing = unique.filter((key) => !isFresh(cache.get(key)));
    if (!missing.length) return {};

    const session = await getSession();
    if (!session?.access_token) return {};

    const response = await fetch(SIGN_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keys: missing })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) return {};

    for (const [key, url] of Object.entries(data.urls || {})) {
        cache.set(key, cacheEntry(url));
    }

    return data.urls || {};
}

export async function ensureSignedMediaUrl(mediaUrl, r2Key = null) {
    if (!mediaUrl || mediaUrl.startsWith('blob:')) return mediaUrl;

    const path = mediaR2KeyFromMessage(mediaUrl, r2Key);
    if (!path || !needsSignature(path)) {
        return displayMediaUrl(mediaUrl, r2Key) || mediaUrl;
    }

    const cached = cache.get(path);
    if (isFresh(cached)) return cached.url;

    const urls = await signMediaPaths([path]);
    const signed = urls[path] || cache.get(path)?.url;
    // İmzasız proxy URL 403 döner; yalnızca imzalı adres kullanılır.
    return signed || null;
}

export async function signMediaInContainer(root) {
    if (!root) return;

    const keys = new Set();
    root.querySelectorAll('.message-media').forEach((host) => {
        const path = mediaR2KeyFromMessage(host.dataset.mediaSrc, host.dataset.mediaR2Key);
        if (needsSignature(path)) keys.add(path);
    });

    if (!keys.size) return;
    await signMediaPaths([...keys]);

    root.querySelectorAll('.message-media').forEach((host) => {
        const path = mediaR2KeyFromMessage(host.dataset.mediaSrc, host.dataset.mediaR2Key);
        if (!needsSignature(path)) return;
        const signed = cache.get(path)?.url;
        if (!signed) return;

        host.querySelectorAll('img, video, audio').forEach((el) => {
            if (!signed) return;
            if (!el.src || !el.src.includes('sig=')) {
                el.src = signed;
            }
        });
    });
}

export function collectMediaKeysFromMessages(messages) {
    const keys = [];
    for (const msg of messages || []) {
        const path = mediaR2KeyFromMessage(msg.media_url, msg.r2_key);
        if (needsSignature(path)) keys.push(path);
    }
    return keys;
}
