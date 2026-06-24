import { readMedia, r2KeyFromProxyPath } from './_lib/media-store.js';

function parseRangeHeader(value) {
    if (typeof value !== 'string') return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
    if (!match) return null;
    return value.trim();
}

function pipeStreamToResponse(body, res) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const finish = (err) => {
            if (settled) return;
            settled = true;
            body.removeListener('error', onError);
            res.removeListener('error', onError);
            res.removeListener('finish', onFinish);
            res.removeListener('close', onClose);
            if (err) reject(err);
            else resolve();
        };

        const onError = (err) => finish(err);
        const onFinish = () => finish();
        const onClose = () => {
            if (!res.writableFinished) {
                try {
                    body.destroy?.();
                } catch {
                    // ignore
                }
            }
            finish();
        };

        body.on('error', onError);
        res.on('error', onError);
        res.on('finish', onFinish);
        res.on('close', onClose);
        body.pipe(res);
    });
}

async function sendBody(res, body) {
    if (!body) {
        res.end();
        return;
    }

    if (typeof body.transformToByteArray === 'function') {
        const bytes = await body.transformToByteArray();
        if (!res.writableEnded) {
            res.send(Buffer.from(bytes));
        }
        return;
    }

    if (typeof body.pipe === 'function') {
        await pipeStreamToResponse(body, res);
        return;
    }

    res.end();
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
