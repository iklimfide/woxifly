import { getVapidPublicKey } from './_lib/push.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Yalnızca GET desteklenir.' });
        return;
    }

    const result = getVapidPublicKey();
    if (result.error) {
        res.status(503).json({ error: result.error, enabled: false });
        return;
    }

    res.status(200).json({ publicKey: result.publicKey, enabled: true });
}
