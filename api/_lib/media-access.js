import { createClient } from '@supabase/supabase-js';
import { getSupabaseServiceConfig } from './env.js';
import { r2KeyFromProxyPath } from './media-store.js';

let serviceClient = null;

function getService() {
    if (serviceClient) return serviceClient;
    const cfg = getSupabaseServiceConfig();
    if (cfg.error) throw new Error(cfg.error);
    serviceClient = createClient(cfg.url, cfg.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return serviceClient;
}

function normalizeKey(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim().replace(/^\/+/, '');
    if (trimmed.startsWith('/api/media/')) {
        return r2KeyFromProxyPath(trimmed.replace(/^\/api\/media\//, ''));
    }
    return r2KeyFromProxyPath(trimmed) || (trimmed.includes('..') ? null : trimmed);
}

async function isPairBlocked(userId, otherId) {
    if (!userId || !otherId || userId === otherId) return false;
    const sb = getService();
    const { count, error } = await sb
        .from('user_blocks')
        .select('id', { count: 'exact', head: true })
        .or(`and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`);
    if (error) return true;
    return (count || 0) > 0;
}

export async function userCanAccessMedia(userId, rawKey) {
    const r2Key = normalizeKey(rawKey);
    if (!userId || !r2Key) return false;

    if (r2Key.startsWith('avatars/')) return true;

    const parts = r2Key.split('/');
    if (parts.length >= 2 && parts[1] === userId) return true;

    const sb = getService();
    const { data: messages, error } = await sb
        .from('messages')
        .select('id, conversation_id')
        .or(`r2_key.eq.${r2Key},media_url.ilike.%${r2Key}%`)
        .is('deleted_at', null)
        .limit(20);

    if (error || !messages?.length) return false;

    for (const message of messages) {
        const { data: conversation } = await sb
            .from('conversations')
            .select('type')
            .eq('id', message.conversation_id)
            .maybeSingle();

        if (conversation?.type !== 'dm') continue;

        const { data: members } = await sb
            .from('conversation_members')
            .select('user_id')
            .eq('conversation_id', message.conversation_id);

        const memberIds = (members || []).map((row) => row.user_id);
        if (!memberIds.includes(userId)) continue;

        const otherId = memberIds.find((id) => id !== userId);
        if (otherId && await isPairBlocked(userId, otherId)) continue;

        return true;
    }

    return false;
}

export async function filterAccessibleKeys(userId, rawKeys) {
    const keys = [...new Set((rawKeys || []).map(normalizeKey).filter(Boolean))].slice(0, 50);
    const allowed = [];

    for (const key of keys) {
        if (await userCanAccessMedia(userId, key)) {
            allowed.push(key);
        }
    }

    return allowed;
}
