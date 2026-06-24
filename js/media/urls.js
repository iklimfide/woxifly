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
    const bare = String(key).replace(/^\/+/, '').split('?')[0].split('#')[0];
    const videoMatch = bare.match(/^videos\/([^/]+)\/([^/]+)$/);
    if (videoMatch) return `uploads/${videoMatch[1]}/${videoMatch[2]}`;

    const imageMatch = bare.match(/^images\/([^/]+)\/([^/]+)$/);
    if (imageMatch) return `uploads/${imageMatch[1]}/${imageMatch[2]}`;

    return null;
}

function normalizeR2Key(key) {
    const bare = String(key).replace(/^\/+/, '').split('?')[0].split('#')[0];
    return bare;
}

function mediaUrlCandidates(mediaUrl, r2Key = null) {
    const candidates = [];
    const seen = new Set();
    const addPath = (path) => {
        if (!path || seen.has(path)) return;
        seen.add(path);
        candidates.push(`${MEDIA_BASE}/${path}`);
    };

    const paths = [];
    const fromUrl = extractMediaPath(mediaUrl);
    if (fromUrl) paths.push(fromUrl);
    if (isR2MediaKey(r2Key)) {
        paths.push(String(r2Key).replace(/^\/+/, '').split('?')[0].split('#')[0]);
    }

    for (const path of paths) {
        addPath(path);
        const legacy = legacyR2KeyFallback(path);
        if (legacy) addPath(legacy);
    }

    return candidates;
}

/** Geçmiş mesajlar: media_url + r2_key yedek çözümleme. */
export function resolveMessageMediaUrl(mediaUrl, r2Key = null) {
    const candidates = mediaUrlCandidates(mediaUrl, r2Key);
    return candidates[0] || null;
}

/** img/video/audio src listesi — birincil + yedek yollar. */
export function getMediaDisplayUrls(mediaUrl, r2Key = null) {
    const seen = new Set();
    const out = [];
    for (const path of mediaUrlCandidates(mediaUrl, r2Key)) {
        const url = displayMediaUrl(path) || path;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        out.push(url);
    }
    return out;
}

export function resolveAvatarMediaUrl(avatarUrl, avatarR2Key = null) {
    return resolveMessageMediaUrl(avatarUrl, avatarR2Key);
}

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

const EXT_KIND = {
    jpg: 'image',
    jpeg: 'image',
    png: 'image',
    webp: 'image',
    gif: 'image',
    heic: 'image',
    heif: 'image',
    mp4: 'video',
    m4v: 'video',
    webm: 'video',
    mov: 'video',
    mkv: 'video',
    '3gp': 'video',
    avi: 'video',
    ogg: 'audio',
    mp3: 'audio',
    wav: 'audio',
    m4a: 'audio',
    aac: 'audio'
};

function mimeKind(mime) {
    const base = (mime || '').split(';')[0].trim().toLowerCase();
    if (!base) return null;
    if (base.startsWith('image/')) return 'image';
    if (base.startsWith('video/')) return 'video';
    if (base.startsWith('audio/')) return 'audio';
    if (base === 'application/octet-stream') return null;
    return null;
}

function extensionKind(fileName) {
    const ext = String(fileName || '').split('.').pop()?.toLowerCase();
    return ext ? EXT_KIND[ext] || null : null;
}

export function kindFromFile(file) {
    if (!file) return null;
    return mimeKind(file.type) || extensionKind(file.name);
}

export const MEDIA_KINDS = new Set(['image', 'video', 'audio']);

export function isMediaKind(value) {
    return MEDIA_KINDS.has(value);
}
