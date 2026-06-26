import { headMedia, readMedia, r2KeyFromProxyPath } from './_lib/media-store.js';
import { verifyMediaSignature } from './_lib/media-sign.js';

const IMAGE_PREFIX_RE = /^(?:images|avatars)\//;

const CACHE_MAX = 128;
const CACHE_TTL_MS = 15 * 60 * 1000;
const mediaCache = new Map();

function parseRangeHeader(value) {
    if (typeof value !== 'string') return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match) return null;
    return value.trim();
}

function shouldIgnoreRange(key) {
    return IMAGE_PREFIX_RE.test(key);
}

function getCachedObject(key) {
    const entry = mediaCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
        mediaCache.delete(key);
        return null;
    }
    return entry;
}

function setCachedObject(key, object) {
    if (!shouldIgnoreRange(key)) return;
    if (mediaCache.size >= CACHE_MAX) {
        const oldest = mediaCache.keys().next().value;
        mediaCache.delete(oldest);
    }
    mediaCache.set(key, { ...object, at: Date.now() });
}

async function readBodyBytes(body) {
    if (!body) return Buffer.alloc(0);

    if (typeof body.transformToByteArray === 'function') {
        const bytes = await body.transformToByteArray();
        return Buffer.from(bytes);
    }

    if (typeof body[Symbol.asyncIterator] === 'function') {
        const chunks = [];
        for await (const chunk of body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
    }

    return Buffer.alloc(0);
}

function writeHeaders(res, object, byteLength) {
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', object.cacheControl);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', String(byteLength));
    res.setHeader('Connection', 'close');

    if (object.partial && object.contentRange) {
        res.setHeader('Content-Range', object.contentRange);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(405).json({ error: 'Yalnızca GET desteklenir.' });
        return;
    }

    const key = r2KeyFromProxyPath(req.query.key || '');
    if (!key) {
        res.status(403).json({ error: 'Geçersiz medya yolu.' });
        return;
    }

    const isAvatar = key.startsWith('avatars/');
    if (!isAvatar) {
        const exp = req.query.exp;
        const sig = req.query.sig;
        if (!verifyMediaSignature(key, exp, sig)) {
            res.status(403).json({ error: 'Geçersiz veya süresi dolmuş medya bağlantısı.' });
            return;
        }
    }

    let bodyStream = null;

    try {
        const ignoreRange = shouldIgnoreRange(key);
        const range = ignoreRange ? null : parseRangeHeader(req.headers.range);

        const cached = ignoreRange ? getCachedObject(key) : null;
        if (cached?.bytes) {
            if (req.method === 'HEAD') {
                writeHeaders(res, cached, cached.bytes.length);
                res.status(200);
                res.end();
                return;
            }
            writeHeaders(res, cached, cached.bytes.length);
            res.status(200);
            res.end(cached.bytes);
            return;
        }

        const object = req.method === 'HEAD' && !range
            ? await headMedia(key)
            : await readMedia(key, { range });

        bodyStream = object.body;

        if (req.method === 'HEAD') {
            if (bodyStream) {
                await readBodyBytes(bodyStream);
                bodyStream = null;
            }
            writeHeaders(res, object, object.contentLength ?? 0);
            res.status(object.partial ? 206 : 200);
            res.end();
            return;
        }

        const bytes = await readBodyBytes(bodyStream);
        bodyStream = null;

        if (ignoreRange) {
            setCachedObject(key, {
                bytes,
                contentType: object.contentType,
                cacheControl: object.cacheControl,
                partial: false,
                contentRange: null
            });
        }

        writeHeaders(res, object, bytes.length);
        res.status(ignoreRange ? 200 : (object.partial ? 206 : 200));
        res.end(bytes);
    } catch (err) {
        if (bodyStream) {
            try {
                await readBodyBytes(bodyStream);
            } catch {
                // ignore cleanup errors
            }
        }
        console.error('media serve error:', key, err);
        if (!res.headersSent) {
            res.status(404).json({ error: 'Medya bulunamadı.' });
        }
    }
}
