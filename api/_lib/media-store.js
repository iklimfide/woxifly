import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getR2Config } from './env.js';

export const MEDIA_KINDS = {
    image: {
        mimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
        maxBytes: 10 * 1024 * 1024,
        ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' },
        prefix: 'images'
    },
    video: {
        mimes: new Set([
            'video/mp4',
            'video/webm',
            'video/quicktime',
            'video/x-matroska',
            'video/3gpp',
            'video/x-msvideo'
        ]),
        maxBytes: 50 * 1024 * 1024,
        ext: {
            'video/mp4': 'mp4',
            'video/webm': 'webm',
            'video/quicktime': 'mov',
            'video/x-matroska': 'mkv',
            'video/3gpp': '3gp',
            'video/x-msvideo': 'avi'
        },
        // Mevcut R2 dosyaları uploads/{userId}/ altında; videos/ klasörü boş.
        prefix: 'uploads'
    },
    audio: {
        mimes: new Set([
            'audio/webm',
            'audio/ogg',
            'audio/mp4',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/x-m4a',
            'audio/aac',
            'audio/x-aac'
        ]),
        maxBytes: 5 * 1024 * 1024,
        ext: {
            'audio/webm': 'webm',
            'audio/ogg': 'ogg',
            'audio/mp4': 'm4a',
            'audio/mpeg': 'mp3',
            'audio/mp3': 'mp3',
            'audio/wav': 'wav',
            'audio/x-m4a': 'm4a',
            'audio/aac': 'm4a',
            'audio/x-aac': 'm4a'
        },
        prefix: 'audio'
    },
    avatar: {
        mimes: new Set(['image/jpeg', 'image/png', 'image/webp']),
        maxBytes: 5 * 1024 * 1024,
        ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
        prefix: 'avatars'
    }
};

/** R2 kök klasörleri (eski uploads/ geriye dönük uyumluluk). */
export const MEDIA_R2_PREFIXES = ['images', 'videos', 'audio', 'avatars', 'uploads'];

const PROXY_BASE = '/api/media';

function getEndpoint() {
    const { endpoint, accountId } = getR2Config();
    if (endpoint) return endpoint.replace(/\/$/, '');
    if (accountId) return `https://${accountId}.r2.cloudflarestorage.com`;
    return '';
}

function getClient() {
    const { accessKeyId, secretAccessKey } = getR2Config();
    const endpoint = getEndpoint();

    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('R2 yapılandırması eksik.');
    }

    return new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey }
    });
}

export function mediaProxyUrl(r2Key) {
    return `${PROXY_BASE}/${r2Key}`;
}

/** Broadcast ve istemci için: R2_PUBLIC_BASE_URL varsa doğrudan CDN adresi döner. */
export function mediaPublicUrl(r2Key) {
    const { publicBaseUrl } = getR2Config();
    const base = (publicBaseUrl || '').replace(/\/$/, '');
    if (base && !base.includes('r2.cloudflarestorage.com')) {
        return `${base}/${r2Key}`;
    }
    return mediaProxyUrl(r2Key);
}

function normalizeMimeType(mimeType) {
    const base = (mimeType || '').split(';')[0].trim().toLowerCase();
    if (base === 'audio/x-m4a' || base === 'audio/aac' || base === 'audio/x-aac') {
        return 'audio/mp4';
    }
    if (base === 'video/x-m4v') return 'video/mp4';
    if (base === 'application/octet-stream') return base;
    return base;
}

function inferMimeFromName(fileName, kind) {
    const ext = String(fileName || '').split('.').pop()?.toLowerCase();
    if (!ext) return null;
    const rules = MEDIA_KINDS[kind];
    if (!rules) return null;
    for (const [mime, mappedExt] of Object.entries(rules.ext)) {
        if (mappedExt === ext) return mime;
    }
    return null;
}

function validateFile(fileBuffer, mimeType, kind, fileName = '') {
    const rules = MEDIA_KINDS[kind];
    if (!rules) return { error: 'Geçersiz medya tipi.' };

    mimeType = normalizeMimeType(mimeType);
    if (!mimeType || mimeType === 'application/octet-stream') {
        const fromName = inferMimeFromName(fileName, kind);
        const fallback = fromName || {
            audio: 'audio/webm',
            image: 'image/jpeg',
            video: 'video/mp4',
            avatar: 'image/jpeg'
        }[kind];
        mimeType = fallback || mimeType;
    }

    if (!rules.mimes.has(mimeType)) return { error: 'İzin verilmeyen dosya türü.' };
    if (!fileBuffer?.length) return { error: 'Boş dosya.' };
    if (fileBuffer.length > rules.maxBytes) return { error: 'Dosya boyutu sınırı aşıldı.' };

    const ext = rules.ext[mimeType];
    if (!ext) return { error: 'Dosya uzantısı belirlenemedi.' };

    return { ext, mimeType };
}

export async function saveMedia({ userId, fileBuffer, mimeType, kind, fileName = '' }) {
    const { bucket } = getR2Config();
    if (!bucket) throw new Error('R2_BUCKET_NAME eksik.');

    const validation = validateFile(fileBuffer, mimeType, kind, fileName);
    if (validation.error) return { error: validation.error };

    mimeType = validation.mimeType;

    const rules = MEDIA_KINDS[kind];
    const safeUserId = String(userId).replace(/[^a-zA-Z0-9-]/g, '');
    const prefix = rules.prefix;
    const r2Key = `${prefix}/${safeUserId}/${randomUUID()}.${validation.ext}`;

    await getClient().send(new PutObjectCommand({
        Bucket: bucket,
        Key: r2Key,
        Body: fileBuffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable'
    }));

    return {
        url: mediaProxyUrl(r2Key),
        r2Key,
        kind
    };
}

/** videos/user/file → uploads/user/file; images/user/file → uploads/user/file (eski kayıtlar). */
function legacyR2KeyFallback(r2Key) {
    const key = String(r2Key);
    const videoMatch = key.match(/^videos\/([^/]+)\/([^/]+)$/);
    if (videoMatch) return `uploads/${videoMatch[1]}/${videoMatch[2]}`;

    const imageMatch = key.match(/^images\/([^/]+)\/([^/]+)$/);
    if (imageMatch) return `uploads/${imageMatch[1]}/${imageMatch[2]}`;

    return null;
}

function legacyR2KeyFallbacks(r2Key) {
    const fallback = legacyR2KeyFallback(r2Key);
    return fallback && fallback !== r2Key ? [fallback] : [];
}

async function getObjectFromR2(r2Key, { range } = {}) {
    const { bucket } = getR2Config();
    if (!bucket || !r2Key) throw new Error('Medya bulunamadı.');

    const params = { Bucket: bucket, Key: r2Key };
    if (range) params.Range = range;

    const result = await getClient().send(new GetObjectCommand(params));

    return {
        body: result.Body,
        contentType: result.ContentType || 'application/octet-stream',
        cacheControl: result.CacheControl || 'public, max-age=31536000, immutable',
        contentLength: result.ContentLength,
        contentRange: result.ContentRange,
        partial: Boolean(range && result.ContentRange)
    };
}

export async function readMedia(r2Key, { range } = {}) {
    if (!r2Key) throw new Error('Medya bulunamadı.');

    try {
        return await getObjectFromR2(r2Key, { range });
    } catch (err) {
        for (const fallbackKey of legacyR2KeyFallbacks(r2Key)) {
            try {
                return await getObjectFromR2(fallbackKey, { range });
            } catch {
                // sonraki yedek
            }
        }
        throw err;
    }
}

export async function deleteMedia(r2Key) {
    const { bucket } = getR2Config();
    if (!bucket || !r2Key) return false;

    await getClient().send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: r2Key
    }));

    return true;
}

export function r2KeyFromProxyPath(path) {
    if (!path || typeof path !== 'string') return null;
    if (path.includes('..')) return null;

    const allowed = MEDIA_R2_PREFIXES.some((prefix) => path.startsWith(`${prefix}/`));
    if (!allowed) return null;

    return path;
}
