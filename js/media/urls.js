import { R2_PUBLIC_BASE_URL } from '../config.js';

/** Tüm medya dosyaları bu proxy üzerinden sunulur. */
export const MEDIA_BASE = '/api/media';

const MEDIA_FOLDER_RE = '(?:images|videos|audio|avatars|uploads)';
const R2_PREFIXES = ['images/', 'videos/', 'audio/', 'avatars/', 'uploads/'];
const MEDIA_PATH_LOOSE_RE = new RegExp(`${MEDIA_FOLDER_RE}/[a-zA-Z0-9._%-/]+\\.[a-zA-Z0-9]{2,5}`, 'i');

export function isR2MediaKey(key) {
    if (!key || typeof key !== 'string' || key.includes('..')) return false;
    const normalized = key.replace(/^\/+/, '').split('?')[0].split('#')[0];
    return R2_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function normalizeMediaInput(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

function extractMediaPath(input) {
    const decoded = normalizeMediaInput(input);
    if (!decoded) return null;

    const bare = decoded.replace(/^\/+/, '').split('?')[0].split('#')[0];
    if (isR2MediaKey(bare)) return bare;

    const direct = decoded.match(MEDIA_PATH_LOOSE_RE);
    if (direct) return direct[0];

    try {
        const { pathname } = new URL(decoded, 'http://local');
        const pathMatch = pathname.match(MEDIA_PATH_LOOSE_RE);
        if (pathMatch) return pathMatch[0];
    } catch {
        return null;
    }

    return null;
}

function legacyR2KeyFallback(key) {
    const match = String(key).match(/^videos\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    return `uploads/${match[1]}/${match[2]}`;
}

function normalizeR2Key(key) {
    const bare = String(key).replace(/^\/+/, '').split('?')[0].split('#')[0];
    return legacyR2KeyFallback(bare) || bare;
}

/** Geçmiş mesajlar: media_url + r2_key yedek çözümleme. */
export function resolveMessageMediaUrl(mediaUrl, r2Key = null) {
    const fromUrl = toMediaUrl(mediaUrl);
    if (fromUrl) {
        const path = extractMediaPath(fromUrl);
        if (path) {
            const normalized = normalizeR2Key(path);
            if (normalized !== path) return `${MEDIA_BASE}/${normalized}`;
        }
        return fromUrl;
    }

    if (isR2MediaKey(r2Key)) {
        const key = normalizeR2Key(r2Key);
        return `${MEDIA_BASE}/${key}`;
    }

    return null;
}

/** Broadcast için R2 public URL; yoksa proxy yolu. */
export function toBroadcastMediaUrl(input) {
    const mediaPath = extractMediaPath(input);
    if (!mediaPath) return null;

    if (R2_PUBLIC_BASE_URL) {
        return `${R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${mediaPath}`;
    }

    if (input.startsWith('http://') || input.startsWith('https://')) return input;
    if (input.startsWith(`${MEDIA_BASE}/`)) return input;
    return `${MEDIA_BASE}/${mediaPath}`;
}

/** Veritabanına kayıt — her zaman /api/media proxy yolu (constraint uyumlu). */
export function toPersistMediaUrl(input, r2Key = null) {
    if (isR2MediaKey(r2Key)) {
        const key = String(r2Key).replace(/^\/+/, '').split('?')[0].split('#')[0];
        return `${MEDIA_BASE}/${key}`;
    }

    const mediaPath = extractMediaPath(input);
    if (!mediaPath) return null;
    return `${MEDIA_BASE}/${mediaPath}`;
}

export function toMediaUrl(input) {
    if (!input || typeof input !== 'string') return null;
    if (input.startsWith('blob:')) return input;
    if (input.startsWith(`${MEDIA_BASE}/`)) return input;

    const mediaPath = extractMediaPath(input);
    if (!mediaPath) return null;

    return `${MEDIA_BASE}/${mediaPath}`;
}

/** img/video/audio src — iOS Safari için mutlak URL (blob hariç). */
export function displayMediaUrl(input) {
    if (!input || typeof input !== 'string') return null;
    if (input.startsWith('blob:')) return input;

    const path = toMediaUrl(input);
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) return path;

    if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin}${path}`;
    }

    return path;
}

export function isValidMediaUrl(url, r2Key = null) {
    return !!toPersistMediaUrl(url, r2Key);
}

export function kindFromFile(file) {
    if (!file?.type) return null;
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return null;
}

export const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

export function isMediaKind(value) {
    return MEDIA_KINDS.has(value);
}
