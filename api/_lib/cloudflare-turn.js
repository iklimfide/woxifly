import { bootstrapEnv, env } from './env.js';

const DEFAULT_TTL_SEC = 3600;

function filterIceUrls(urls) {
    const list = Array.isArray(urls) ? urls : [urls];
    return list.filter((url) => !String(url).includes(':53'));
}

export function getCloudflareTurnConfig() {
    bootstrapEnv();
    const keyId = env('CLOUDFLARE_TURN_KEY_ID', '').trim();
    const keySecret = env('CLOUDFLARE_TURN_KEY_SECRET', '').trim();
    if (!keyId || !keySecret) {
        return { configured: false, keyId: '', keySecret: '' };
    }
    return { configured: true, keyId, keySecret };
}

export async function fetchCloudflareIceServers({ ttlSec = DEFAULT_TTL_SEC } = {}) {
    const { configured, keyId, keySecret } = getCloudflareTurnConfig();
    if (!configured) {
        return {
            iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
            turnConfigured: false
        };
    }

    const ttl = Math.min(Math.max(Number(ttlSec) || DEFAULT_TTL_SEC, 60), 172800);
    const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${keySecret}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttl })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Cloudflare TURN yanıtı başarısız (${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
    }

    const data = await res.json();
    const raw = data?.iceServers;
    if (!raw) {
        throw new Error('Cloudflare TURN iceServers alanı eksik.');
    }

    const servers = Array.isArray(raw) ? raw : [raw];
    const iceServers = servers.map((entry) => {
        if (typeof entry === 'string') {
            return { urls: filterIceUrls(entry) };
        }
        const urls = filterIceUrls(entry.urls || entry.url || []);
        return {
            urls,
            username: entry.username,
            credential: entry.credential
        };
    });

    return { iceServers, turnConfigured: true };
}
