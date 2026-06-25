import { createClient } from '@supabase/supabase-js';
import { verifyAuthToken } from './_lib/auth.js';
import { getSupabaseServiceConfig } from './_lib/env.js';
import { sendMaskedPush } from './_lib/push.js';

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

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Yalnızca POST desteklenir.' });
        return;
    }

    const auth = await verifyAuthToken(req);
    if (auth.error) {
        res.status(auth.status).json({ error: auth.error });
        return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const conversationId = body?.conversationId?.trim();

    if (!conversationId) {
        res.status(400).json({ error: 'conversationId gerekli.' });
        return;
    }

    const service = getServiceClient();
    if (service.error) {
        res.status(service.status).json({ error: service.error });
        return;
    }

    const { data: conversation, error: convError } = await service.client
        .from('conversations')
        .select('id, type')
        .eq('id', conversationId)
        .maybeSingle();

    if (convError || !conversation) {
        res.status(404).json({ error: 'Sohbet bulunamadı.' });
        return;
    }

    if (conversation.type !== 'dm') {
        res.status(200).json({ ok: true, sent: 0 });
        return;
    }

    const senderId = auth.user.id;

    const { data: membership } = await service.client
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', senderId)
        .maybeSingle();

    if (!membership) {
        res.status(403).json({ error: 'Bu sohbete erişiminiz yok.' });
        return;
    }

    const { data: members } = await service.client
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .neq('user_id', senderId);

    const recipientIds = (members || []).map((m) => m.user_id);

    if (!recipientIds.length) {
        res.status(200).json({ ok: true, sent: 0 });
        return;
    }

    const { data: enabledProfiles, error: enabledError } = await service.client
        .from('profiles')
        .select('id')
        .in('id', recipientIds)
        .eq('push_enabled', true);

    if (enabledError) {
        res.status(500).json({ error: enabledError.message });
        return;
    }

    const enabledRecipientIds = (enabledProfiles || []).map((profile) => profile.id);
    if (!enabledRecipientIds.length) {
        res.status(200).json({ ok: true, sent: 0 });
        return;
    }

    const { data: subscriptions } = await service.client
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key, user_id')
        .in('user_id', enabledRecipientIds);

    if (!subscriptions?.length) {
        res.status(200).json({ ok: true, sent: 0 });
        return;
    }

    const navigation = {
        tag: `dm-${senderId}`,
        userId: senderId,
        username: null
    };

    const { data: senderProfile } = await service.client
        .from('profiles')
        .select('username')
        .eq('id', senderId)
        .maybeSingle();
    navigation.username = senderProfile?.username || null;

    let sent = 0;
    const expiredEndpoints = [];

    await Promise.all(subscriptions.map(async (sub) => {
        const result = await sendMaskedPush(sub, navigation);
        if (result.ok) sent += 1;
        if (result.expired) expiredEndpoints.push(sub.endpoint);
    }));

    if (expiredEndpoints.length) {
        await service.client
            .from('push_subscriptions')
            .delete()
            .in('endpoint', expiredEndpoints);
    }

    res.status(200).json({ ok: true, sent });
}
