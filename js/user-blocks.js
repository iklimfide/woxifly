import { supabase } from './supabase-client.js';
import { PROFILE_DIRECTORY } from './profile-directory.js';

const blockedRelationIds = new Set();

function normalizeId(id) {
    return String(id || '').trim().toLowerCase();
}

export function isUserBlocked(userId) {
    return blockedRelationIds.has(normalizeId(userId));
}

export function clearBlockedRelations() {
    blockedRelationIds.clear();
}

export async function refreshBlockedRelations() {
    if (!supabase) return;

    const { data, error } = await supabase.rpc('list_block_relation_ids');
    blockedRelationIds.clear();

    if (error) {
        console.warn('[blocks] liste yüklenemedi:', error.message);
        return;
    }

    for (const id of data || []) {
        const normalized = normalizeId(id);
        if (normalized) blockedRelationIds.add(normalized);
    }
}

export async function fetchBlockStatus(userId) {
    const empty = { blockedByMe: false, blockedMe: false, isBlocked: false };
    if (!userId) return empty;

    const { data, error } = await supabase.rpc('get_block_status', { p_other: userId });
    if (error) {
        console.warn('[blocks] durum okunamadı:', error.message);
        return empty;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const blockedByMe = !!row?.blocked_by_me;
    const blockedMe = !!row?.blocked_me;
    return {
        blockedByMe,
        blockedMe,
        isBlocked: blockedByMe || blockedMe
    };
}

export async function blockUser(userId) {
    const { error } = await supabase.rpc('block_user', { p_blocked_id: userId });
    if (error) throw error;
    blockedRelationIds.add(normalizeId(userId));
}

export async function unblockUser(userId) {
    const { error } = await supabase.rpc('unblock_user', { p_blocked_id: userId });
    if (error) throw error;

    const normalized = normalizeId(userId);
    blockedRelationIds.delete(normalized);

    const { blockedMe } = await fetchBlockStatus(userId);
    if (blockedMe) {
        blockedRelationIds.add(normalized);
    }
}

export function isBlockError(error) {
    const message = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
    return /mesajlaşamazsınız|user_blocked|blocked/i.test(message);
}

export async function fetchBlockedByMeList() {
    const { data: rows, error } = await supabase
        .from('user_blocks')
        .select('blocked_id, created_at')
        .order('created_at', { ascending: false });

    if (error) throw error;
    if (!rows?.length) return [];

    const ids = rows.map((row) => row.blocked_id);
    const { data: profiles, error: profileError } = await supabase
        .from(PROFILE_DIRECTORY)
        .select('id, username, avatar_url')
        .in('id', ids);

    if (profileError) throw profileError;

    const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
    return rows.map((row) => {
        const profile = profileMap.get(row.blocked_id);
        return {
            userId: row.blocked_id,
            blockedAt: row.created_at,
            username: profile?.username || 'Kullanıcı',
            avatarUrl: profile?.avatar_url || null,
            avatarR2Key: profile?.avatar_r2_key || null
        };
    });
}
