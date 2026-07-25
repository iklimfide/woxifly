import { verifyAuthToken, jsonResponse } from './_lib/auth.js';
import { fetchCloudflareIceServers } from './_lib/cloudflare-turn.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Yalnızca GET desteklenir.' });
        return;
    }

    const auth = await verifyAuthToken(req);
    if (auth.error) {
        res.status(auth.status).json({ error: auth.error });
        return;
    }

    try {
        const { iceServers, turnConfigured } = await fetchCloudflareIceServers();
        res.status(200).json({ iceServers, turnConfigured });
    } catch (err) {
        console.error('[turn-credentials]', err);
        res.status(503).json({
            error: err instanceof Error ? err.message : 'TURN yapılandırması alınamadı.'
        });
    }
}
