import { R2_PUBLIC_BASE_URL } from '../config.js';

/** Tüm medya dosyaları bu proxy üzerinden sunulur. */
export const MEDIA_BASE = '/api/media';

const MEDIA_FOLDER_RE = '(?:images|videos|audio|avatars|uploads)';
const MEDIA_PATH_RE = new RegExp(`${MEDIA_FOLDER_RE}/[a-zA-Z0-9-]+/[a-f0-9-]{36}\\.[a-z0-9]+$`, 'i');

function extractMediaPath(input) {
    if (!input || typeof input !== 'string') return null;

    const direct = input.match(MEDIA_PATH_RE);
    if (direct) return direct[0];

    try {
        const { pathname } = new URL(input, 'http://local');
        const pathMatch = pathname.match(new RegExp(`/(?:${MEDIA_FOLDER_RE})/[a-zA-Z0-9-]+/[a-f0-9-]{36}\\.[a-z0-9]+$`, 'i'));
        if (pathMatch) return pathMatch[0].replace(/^\//, '');
    } catch {
        return null;
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
    if (r2Key && typeof r2Key === 'string') {
        const key = r2Key.replace(/^\/+/, '');
        if (MEDIA_PATH_RE.test(key)) return `${MEDIA_BASE}/${key}`;
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
