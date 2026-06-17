import { createClient } from '@supabase/supabase-js';
import { verifyAuthToken } from './_lib/auth.js';
import { getSupabaseServiceConfig } from './_lib/env.js';

function getServiceClient() {
    const config = getSupabaseServiceConfig();
    if (config.error) return { error: config.error, status: 500 };
    return {
        client: createClient(config.url, config.serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        })
    };
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const auth = await verifyAuthToken(req);
    if (auth.error) {
        res.status(auth.status).json({ error: auth.error });
        return;
    }

    const service = getServiceClient();
    if (service.error) {
        res.status(service.status).json({ error: service.error });
        return;
    }

    if (req.method === 'POST') {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const endpoint = body?.endpoint?.trim();
        const p256dh = body?.keys?.p256dh?.trim();
        const authKey = body?.keys?.auth?.trim();

        if (!endpoint || !p256dh || !authKey) {
            res.status(400).json({ error: 'Geçersiz abonelik verisi.' });
            return;
        }

        const { error } = await service.client
            .from('push_subscriptions')
            .upsert({
                user_id: auth.user.id,
                endpoint,
                p256dh,
                auth_key: authKey,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,endpoint' });

        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }

        await service.client
            .from('profiles')
            .update({ push_enabled: true, updated_at: new Date().toISOString() })
            .eq('id', auth.user.id);

        res.status(200).json({ ok: true });
        return;
    }

    if (req.method === 'DELETE') {
        const endpoint = typeof req.query?.endpoint === 'string' ? req.query.endpoint : '';
        if (!endpoint) {
            res.status(400).json({ error: 'endpoint gerekli.' });
            return;
        }

        await service.client
            .from('push_subscriptions')
            .delete()
            .eq('user_id', auth.user.id)
            .eq('endpoint', endpoint);

        const { count } = await service.client
            .from('push_subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', auth.user.id);

        if (!count) {
            await service.client
                .from('profiles')
                .update({ push_enabled: false, updated_at: new Date().toISOString() })
                .eq('id', auth.user.id);
        }

        res.status(200).json({ ok: true });
        return;
    }

    res.status(405).json({ error: 'POST veya DELETE desteklenir.' });
}
