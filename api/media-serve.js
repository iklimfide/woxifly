import { readMedia, r2KeyFromProxyPath } from './_lib/media-store.js';

function parseRangeHeader(value) {
    if (typeof value !== 'string') return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match) return null;
    return value.trim();
}

async function sendBody(res, body) {
    if (body && typeof body.pipe === 'function') {
        body.pipe(res);
        return;
    }

    const bytes = await body.transformToByteArray();
    res.send(Buffer.from(bytes));
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

    try {
        const range = parseRangeHeader(req.headers.range);
        const object = await readMedia(key, { range });

        res.setHeader('Content-Type', object.contentType);
        res.setHeader('Cache-Control', object.cacheControl);
        res.setHeader('Accept-Ranges', 'bytes');

        if (object.contentLength != null) {
            res.setHeader('Content-Length', String(object.contentLength));
        }

        if (object.partial) {
            res.status(206);
            if (object.contentRange) {
                res.setHeader('Content-Range', object.contentRange);
            }
        }

        if (req.method === 'HEAD') {
            res.status(object.partial ? 206 : 200).end();
            return;
        }

        if (!object.partial) {
            res.status(200);
        }

        await sendBody(res, object.body);
    } catch (err) {
        console.error('media serve error:', key, err);
        res.status(404).json({ error: 'Medya bulunamadı.' });
    }
}
