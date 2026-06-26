import { verifyAuthToken } from './_lib/auth.js';
import { filterAccessibleKeys } from './_lib/media-access.js';
import { signMediaPath } from './_lib/media-sign.js';

function parseBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string' && req.body.trim()) {
        return JSON.parse(req.body);
    }
    return {};
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Yalnızca POST desteklenir.' });
        return;
    }

    const auth = await verifyAuthToken(req);
    if (auth.error) {
        res.status(auth.status).json({ error: auth.error });
        return;
    }

    let body;
    try {
        body = parseBody(req);
    } catch {
        res.status(400).json({ error: 'Geçersiz JSON.' });
        return;
    }

    const keys = Array.isArray(body.keys)
        ? body.keys.filter((key) => typeof key === 'string' && key.trim())
        : [];

    if (!keys.length) {
        res.status(400).json({ error: 'keys dizisi gerekli.' });
        return;
    }

    try {
        const allowed = await filterAccessibleKeys(auth.user.id, keys);
        const urls = {};
        for (const key of allowed) {
            urls[key] = signMediaPath(key);
        }
        res.status(200).json({ urls });
    } catch (err) {
        console.error('media-sign error:', err);
        res.status(500).json({ error: 'İmzalama başarısız.' });
    }
}
