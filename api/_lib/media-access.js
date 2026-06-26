import { createClient } from '@supabase/supabase-js';
import { getSupabaseServiceConfig } from './env.js';
import { r2KeyFromProxyPath } from './media-store.js';

const OWNER_MEDIA_PREFIXES = new Set(['uploads', 'images', 'videos', 'audio']);

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

async function findMessagesForR2Key(sb, r2Key) {
    const { data: byKey, error: keyError } = await sb
        .from('messages')
        .select('id, conversation_id')
        .eq('r2_key', r2Key)
        .is('deleted_at', null)
        .limit(20);

    if (keyError) throw keyError;
    if (byKey?.length) return byKey;

    const { data: byUrl, error: urlError } = await sb
        .from('messages')
        .select('id, conversation_id')
        .ilike('media_url', `%${r2Key}%`)
        .is('deleted_at', null)
        .limit(20);

    if (urlError) throw urlError;
    return byUrl || [];
}

async function usersShareDm(userId, otherUserId) {
    if (!userId || !otherUserId || userId === otherUserId) return false;

    const sb = getService();
    const { data: memberships, error } = await sb
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userId);

    if (error || !memberships?.length) return false;

    const convIds = memberships.map((row) => row.conversation_id);
    const { data: partnerRows, error: partnerError } = await sb
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', otherUserId)
        .in('conversation_id', convIds);

    if (partnerError || !partnerRows?.length) return false;

    for (const row of partnerRows) {
        const { data: conversation } = await sb
            .from('conversations')
            .select('type')
            .eq('id', row.conversation_id)
            .maybeSingle();

        if (conversation?.type === 'dm') return true;
    }

    return false;
}

async function canAccessViaDmPartner(userId, r2Key) {
    const parts = r2Key.split('/');
    if (parts.length < 3 || !OWNER_MEDIA_PREFIXES.has(parts[0])) return false;

    const ownerId = parts[1];
    if (!ownerId || ownerId === userId) return false;

    if (await isPairBlocked(userId, ownerId)) return false;
    return usersShareDm(userId, ownerId);
}

export async function userCanAccessMedia(userId, rawKey) {
    const r2Key = normalizeKey(rawKey);
    if (!userId || !r2Key) return false;

    if (r2Key.startsWith('avatars/')) return true;

    const parts = r2Key.split('/');
    if (parts.length >= 2 && parts[1] === userId) return true;

    try {
        const sb = getService();
        const messages = await findMessagesForR2Key(sb, r2Key);

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
    } catch (err) {
        console.error('userCanAccessMedia message lookup failed:', r2Key, err);
    }

    return canAccessViaDmPartner(userId, r2Key);
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
