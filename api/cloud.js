import { createClient } from '@supabase/supabase-js';
import { verifyAuthToken } from './_lib/auth.js';
import { isAdminUser, describeAdminDenial } from './_lib/admin.js';
import { getSupabaseServiceConfig } from './_lib/env.js';

function sendJson(res, status, body) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'Authorization');
    res.status(status).json(body);
}

function getServiceClient() {
    const config = getSupabaseServiceConfig();
    if (config.error) return { error: config.error, status: 500 };
    return {
        client: createClient(config.url, config.serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        })
    };
}

function previewBody(message) {
    if (!message) return '';
    const type = message.content_type || 'text';
    if (type === 'image') return '📷 Görsel';
    if (type === 'video') return '🎬 Video';
    if (type === 'audio') return '🎙️ Ses';
    const body = (message.body || '').trim();
    if (!body) return 'Mesaj';
    return body.length > 120 ? `${body.slice(0, 120)}…` : body;
}

function conversationTitle(conversation, memberNames = []) {
    if (memberNames.length) return memberNames.join(' ↔ ');
    return 'Özel Sohbet';
}

async function loadMemberUsernamesByConversation(client, conversationIds) {
    const membersByConv = new Map();
    if (!conversationIds.length) return membersByConv;

    const { data: members, error: memberError } = await client
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('conversation_id', conversationIds);

    if (memberError) throw memberError;

    const userIds = [...new Set((members || []).map((item) => item.user_id))];
    const usernameById = new Map();

    if (userIds.length) {
        const { data: profiles, error: profileError } = await client
            .from('profiles')
            .select('id, username')
            .in('id', userIds);

        if (profileError) throw profileError;

        for (const profile of profiles || []) {
            usernameById.set(profile.id, profile.username);
        }
    }

    for (const member of members || []) {
        const username = usernameById.get(member.user_id) || 'Kullanıcı';
        const list = membersByConv.get(member.conversation_id) || [];
        list.push(username);
        membersByConv.set(member.conversation_id, list);
    }

    return membersByConv;
}

async function requireAdmin(req, res) {
    const auth = await verifyAuthToken(req);
    if (auth.error) {
        sendJson(res, auth.status, { error: auth.error });
        return null;
    }

    if (!isAdminUser(auth.user)) {
        sendJson(res, 403, {
            error: 'Bulut YP erişimi yok.',
            hint: describeAdminDenial(auth.user)
        });
        return null;
    }

    return auth.user;
}

async function handleAccess(res, user) {
    sendJson(res, 200, {
        allowed: true,
        userId: user.id,
        email: user.email || null
    });
}

async function handleConversations(client, query, res) {
    const search = (query.q || '').trim().toLowerCase();
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 80, 1), 200);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

    let convQuery = client
        .from('conversations')
        .select('id, type, created_at')
        .eq('type', 'dm')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    const { data: conversations, error: convError } = await convQuery;
    if (convError) {
        sendJson(res, 500, { error: convError.message });
        return;
    }

    const convList = conversations || [];
    const convIds = convList.map((item) => item.id);
    if (!convIds.length) {
        sendJson(res, 200, { conversations: [], hasMore: false });
        return;
    }

    const { data: latestMessages, error: msgError } = await client
        .from('messages')
        .select('conversation_id, body, created_at, content_type, deleted_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false });

    if (msgError) {
        sendJson(res, 500, { error: msgError.message });
        return;
    }

    const latestByConv = new Map();
    const deletedLatestByConv = new Map();
    for (const message of latestMessages || []) {
        if (message.deleted_at) {
            if (!deletedLatestByConv.has(message.conversation_id)) {
                deletedLatestByConv.set(message.conversation_id, message);
            }
            continue;
        }
        if (!latestByConv.has(message.conversation_id)) {
            latestByConv.set(message.conversation_id, message);
        }
    }

    const dmIds = convList.filter((item) => item.type === 'dm').map((item) => item.id);
    let membersByConv = new Map();

    if (dmIds.length) {
        try {
            membersByConv = await loadMemberUsernamesByConversation(client, dmIds);
        } catch (err) {
            sendJson(res, 500, { error: err.message });
            return;
        }
    }

    let items = convList.map((conversation) => {
        const latest = latestByConv.get(conversation.id)
            || deletedLatestByConv.get(conversation.id)
            || null;
        const memberNames = membersByConv.get(conversation.id) || [];
        const title = conversationTitle(conversation, memberNames);

        return {
            id: conversation.id,
            type: conversation.type,
            title,
            memberUsernames: memberNames,
            lastAt: latest?.created_at || conversation.created_at,
            preview: previewBody(latest),
            previewDeleted: !!latest?.deleted_at
        };
    });

    items.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

    if (search) {
        items = items.filter((item) => {
            const haystack = [
                item.title,
                item.preview,
                ...(item.memberUsernames || [])
            ].join(' ').toLowerCase();
            return haystack.includes(search);
        });
    }

    sendJson(res, 200, {
        conversations: items,
        hasMore: convList.length === limit
    });
}

function escapeIlike(value) {
    return String(value || '').replace(/[%_\\]/g, '\\$&');
}

async function loadEmailsForUserIds(client, userIds) {
    const emailById = new Map();
    if (!userIds.length) return emailById;

    const results = await Promise.all(
        userIds.map(async (userId) => {
            try {
                const { data, error } = await client.auth.admin.getUserById(userId);
                if (error || !data?.user?.email) return null;
                return [userId, data.user.email];
            } catch {
                return null;
            }
        })
    );

    for (const entry of results) {
        if (entry) emailById.set(entry[0], entry[1]);
    }

    return emailById;
}

function memberLocation(profile) {
    const district = profile.current_district || profile.district || '';
    if (district === 'Yurtdışı' && profile.abroad_city) {
        return `Yurtdışı · ${profile.abroad_city}`;
    }
    return district || '—';
}

async function handleMembers(client, query, res) {
    const search = (query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

    let profileQuery = client
        .from('profiles')
        .select('id, username, district, current_district, abroad_city, created_at, is_visible, avatar_url', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (search) {
        const term = escapeIlike(search);
        profileQuery = profileQuery.or(
            `username.ilike.%${term}%,district.ilike.%${term}%,current_district.ilike.%${term}%,abroad_city.ilike.%${term}%`
        );
    }

    const { data: profiles, error, count } = await profileQuery;
    if (error) {
        sendJson(res, 500, { error: error.message });
        return;
    }

    const list = profiles || [];
    const emailById = await loadEmailsForUserIds(client, list.map((item) => item.id));

    sendJson(res, 200, {
        members: list.map((profile) => ({
            id: profile.id,
            username: profile.username || 'Kullanıcı',
            location: memberLocation(profile),
            email: emailById.get(profile.id) || null,
            createdAt: profile.created_at,
            isVisible: profile.is_visible !== false,
            avatarUrl: profile.avatar_url || null
        })),
        total: typeof count === 'number' ? count : null,
        hasMore: list.length === limit
    });
}

async function handleMessages(client, query, res) {
    const conversationId = (query.conversationId || '').trim();
    if (!conversationId) {
        sendJson(res, 400, { error: 'conversationId gerekli.' });
        return;
    }

    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 100);
    const before = (query.before || '').trim();

    let msgQuery = client
        .from('messages')
        .select('id, body, created_at, sender_id, sender_username, content_type, media_url, r2_key, deleted_at, client_id')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (before) {
        msgQuery = msgQuery.lt('created_at', before);
    }

    const { data: messages, error } = await msgQuery;
    if (error) {
        sendJson(res, 500, { error: error.message });
        return;
    }

    const ordered = [...(messages || [])].reverse();
    const senderIds = [...new Set(ordered.filter((item) => !item.sender_username).map((item) => item.sender_id))];
    const profileMap = new Map();

    if (senderIds.length) {
        const { data: profiles, error: profileError } = await client
            .from('profiles')
            .select('id, username')
            .in('id', senderIds);

        if (profileError) {
            sendJson(res, 500, { error: profileError.message });
            return;
        }

        for (const profile of profiles || []) {
            profileMap.set(profile.id, profile.username);
        }
    }

    const { data: conversation, error: convError } = await client
        .from('conversations')
        .select('id, type')
        .eq('id', conversationId)
        .maybeSingle();

    if (convError || !conversation) {
        sendJson(res, 404, { error: 'Sohbet bulunamadı.' });
        return;
    }

    let memberUsernames = [];
    try {
        const membersByConv = await loadMemberUsernamesByConversation(client, [conversationId]);
        memberUsernames = membersByConv.get(conversationId) || [];
    } catch (err) {
        sendJson(res, 500, { error: err.message });
        return;
    }

    sendJson(res, 200, {
        conversation: {
            id: conversation.id,
            type: conversation.type,
            title: conversationTitle(conversation, memberUsernames),
            memberUsernames
        },
        messages: ordered.map((message) => ({
            id: message.id,
            body: message.body,
            createdAt: message.created_at,
            senderId: message.sender_id,
            senderName: message.sender_username || profileMap.get(message.sender_id) || 'Kullanıcı',
            receiverId: null,
            receiverName: null,
            contentType: message.content_type || 'text',
            mediaUrl: message.media_url,
            r2Key: message.r2_key,
            deletedAt: message.deleted_at,
            clientId: message.client_id
        })),
        hasMore: (messages || []).length === limit
    });
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Yalnızca POST desteklenir.' });
        return;
    }

    const action = (req.query?.action || 'access').trim().toLowerCase();

    if (action === 'access') {
        const user = await requireAdmin(req, res);
        if (!user) return;
        await handleAccess(res, user);
        return;
    }

    const user = await requireAdmin(req, res);
    if (!user) return;

    const service = getServiceClient();
    if (service.error) {
        sendJson(res, service.status, { error: service.error });
        return;
    }

    if (action === 'conversations') {
        await handleConversations(service.client, req.query || {}, res);
        return;
    }

    if (action === 'messages') {
        await handleMessages(service.client, req.query || {}, res);
        return;
    }

    if (action === 'members') {
        await handleMembers(service.client, req.query || {}, res);
        return;
    }

    sendJson(res, 400, { error: 'Geçersiz action.' });
}
