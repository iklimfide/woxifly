let activeChannel = null;
let activeRoomKey = null;
let supabaseClient = null;
const seenClientIds = new Set();
const notificationChannels = new Map();
const notificationSeenClientIds = new Set();
const notificationChannelByConversation = new Map();

function dispatchCallSignal(payload) {
    if (!payload?.call_id || !payload?.type) return;
    if (shouldDedupeCallSignal(payload)) return;
    onCallSignal?.(payload);
}

let onCallSignal = null;
/** Açık sohbet — bildirim kanalındaki mesaj yinelemesini önlemek için (arama sinyali her zaman dinlenir). */
let dmNotificationActiveConversationId = null;

const recentCallSignalKeys = new Map();
const CALL_SIGNAL_DEDUPE_MS = 4000;
/** Mobil ↔ masaüstü: Realtime broadcast gecikmesi için. */
const CALL_BROADCAST_SEND_TIMEOUT_MS = 12000;
const CALL_CHANNEL_JOIN_TIMEOUT_MS = 12000;

export function shouldDedupeCallSignal(payload) {
    if (!payload?.call_id || !payload?.type) return false;
    if (payload.type === 'ice') return false;
    const key = `${payload.call_id}:${payload.type}:${payload.from_user_id || ''}`;
    const now = Date.now();
    const prev = recentCallSignalKeys.get(key);
    if (prev != null && now - prev < CALL_SIGNAL_DEDUPE_MS) return true;
    recentCallSignalKeys.set(key, now);
    if (recentCallSignalKeys.size > 80) {
        for (const [k, t] of recentCallSignalKeys) {
            if (now - t > CALL_SIGNAL_DEDUPE_MS) recentCallSignalKeys.delete(k);
        }
    }
    return false;
}

export function setVoiceCallSignalHandler(handler) {
    onCallSignal = typeof handler === 'function' ? handler : null;
}

function presenceKey(userId) {
    return userId;
}

export function clearSeenBroadcasts() {
    seenClientIds.clear();
}

export function leaveRealtimeRoom() {
    if (activeChannel && supabaseClient) {
        supabaseClient.removeChannel(activeChannel);
    }
    activeChannel = null;
    activeRoomKey = null;
    clearSeenBroadcasts();
}

export function leaveDmNotificationRooms() {
    if (supabaseClient) {
        for (const channel of notificationChannels.values()) {
            supabaseClient.removeChannel(channel);
        }
    }
    notificationChannels.clear();
    notificationChannelByConversation.clear();
    notificationSeenClientIds.clear();
}

/**
 * Açık olmayan DM sohbetlerinde gelen mesajlar için arka plan dinleyicileri.
 */
export function syncDmNotificationRooms(supabase, conversationIds, {
    activeConversationId = null,
    onMessage,
    onReaction
} = {}) {
    supabaseClient = supabase;
    dmNotificationActiveConversationId = activeConversationId || null;
    const targetIds = new Set((conversationIds || []).filter(Boolean));

    for (const [convId, channel] of notificationChannels) {
        if (!targetIds.has(convId)) {
            supabase.removeChannel(channel);
            notificationChannels.delete(convId);
            notificationChannelByConversation.delete(convId);
        }
    }

    for (const convId of targetIds) {
        if (notificationChannels.has(convId)) continue;

        const roomKey = `dm:${convId}`;
        const channel = supabase.channel(roomKey, {
            config: { broadcast: { ack: false, self: false } }
        });

        channel.on('broadcast', { event: 'shout' }, ({ payload }) => {
            if (convId === dmNotificationActiveConversationId) return;
            if (!payload?.client_id) return;
            if (seenClientIds.has(payload.client_id)) return;
            if (notificationSeenClientIds.has(payload.client_id)) return;
            notificationSeenClientIds.add(payload.client_id);
            onMessage?.(payload, convId);
        }).on('broadcast', { event: 'reaction' }, ({ payload }) => {
            if (convId === dmNotificationActiveConversationId) return;
            onReaction?.(payload, convId);
        }).on('broadcast', { event: 'call' }, ({ payload }) => {
            dispatchCallSignal(payload);
        }).subscribe();

        notificationChannels.set(convId, channel);
        notificationChannelByConversation.set(convId, channel);
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export function joinDmRoom(supabase, conversationId, { userId, username, onMessage, onPresence, onReaction, onDelete, onEdit }) {
    supabaseClient = supabase;
    const roomKey = `dm:${conversationId}`;
    if (activeRoomKey === roomKey) return activeChannel;

    leaveRealtimeRoom();
    activeRoomKey = roomKey;

    const channel = supabase.channel(roomKey, {
        config: {
            broadcast: { ack: false, self: false },
            presence: { key: presenceKey(userId) }
        }
    });

    channel
        .on('broadcast', { event: 'shout' }, ({ payload }) => {
            if (!payload?.client_id || seenClientIds.has(payload.client_id)) return;
            seenClientIds.add(payload.client_id);
            onMessage(payload);
        })
        .on('broadcast', { event: 'reaction' }, ({ payload }) => {
            onReaction?.(payload);
        })
        .on('broadcast', { event: 'message_delete' }, ({ payload }) => {
            onDelete?.(payload);
        })
        .on('broadcast', { event: 'message_edit' }, ({ payload }) => {
            onEdit?.(payload);
        })
        .on('broadcast', { event: 'call' }, ({ payload }) => {
            dispatchCallSignal(payload);
        })
        .on('presence', { event: 'sync' }, () => onPresence?.(countPresence(channel)))
        .subscribe(async (status) => {
            if (status !== 'SUBSCRIBED' || !userId) return;
            await channel.track({
                user_id: userId,
                username: username || 'Kullanıcı',
                online_at: new Date().toISOString()
            });
            onPresence?.(countPresence(channel));
        });

    activeChannel = channel;
    return channel;
}

function countPresence(channel) {
    const state = channel.presenceState();
    return Object.values(state).reduce((sum, entries) => sum + entries.length, 0);
}

export async function broadcastShout(payload) {
    if (!activeChannel) return;
    seenClientIds.add(payload.client_id);

    try {
        await Promise.race([
            activeChannel.send({
                type: 'broadcast',
                event: 'shout',
                payload
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Broadcast zaman aşımı')), 5000);
            })
        ]);
    } catch (err) {
        console.error('Broadcast gönderilemedi:', err);
    }
}

export async function broadcastMessageDelete(payload) {
    if (!activeChannel) return;

    try {
        await Promise.race([
            activeChannel.send({
                type: 'broadcast',
                event: 'message_delete',
                payload
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Silme yayını zaman aşımı')), 5000);
            })
        ]);
    } catch (err) {
        console.error('Silme yayını gönderilemedi:', err);
    }
}

export async function broadcastMessageEdit(payload) {
    if (!activeChannel) return;

    try {
        await Promise.race([
            activeChannel.send({
                type: 'broadcast',
                event: 'message_edit',
                payload
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Düzenleme yayını zaman aşımı')), 5000);
            })
        ]);
    } catch (err) {
        console.error('Düzenleme yayını gönderilemedi:', err);
    }
}

export async function broadcastReaction(payload) {
    if (!activeChannel) return;

    try {
        await Promise.race([
            activeChannel.send({
                type: 'broadcast',
                event: 'reaction',
                payload
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Tepki yayını zaman aşımı')), 5000);
            })
        ]);
    } catch (err) {
        console.error('Tepki yayını gönderilemedi:', err);
    }
}

/**
 * Arama sinyali (offer/answer/ICE) göndermeden önce dm kanalının abone olduğundan emin ol.
 * Telefonda sohbet açık değilken notify kanalı henüz join olmamış olabilir.
 */
export async function ensureCallBroadcastReady(supabase, conversationId, timeoutMs = CALL_CHANNEL_JOIN_TIMEOUT_MS) {
    if (supabase) supabaseClient = supabase;
    if (!supabaseClient || !conversationId) return false;

    const roomKey = `dm:${conversationId}`;

    let notifyChannel = notificationChannelByConversation.get(conversationId);
    if (!notifyChannel) {
        notifyChannel = supabaseClient.channel(roomKey, {
            config: { broadcast: { ack: false, self: false } }
        });
        notifyChannel.on('broadcast', { event: 'call' }, ({ payload }) => {
            dispatchCallSignal(payload);
        });
        notificationChannels.set(conversationId, notifyChannel);
        notificationChannelByConversation.set(conversationId, notifyChannel);
        notifyChannel.subscribe();
    }

    /** @type {import('@supabase/supabase-js').RealtimeChannel[]} */
    const channels = [];
    if (activeChannel && activeRoomKey === roomKey && !channels.includes(activeChannel)) {
        channels.push(activeChannel);
    }
    if (notifyChannel && !channels.includes(notifyChannel)) {
        channels.push(notifyChannel);
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (channels.some((ch) => ch.state === 'joined')) return true;
        await new Promise((resolve) => {
            setTimeout(resolve, 80);
        });
    }
    return channels.some((ch) => ch.state === 'joined');
}

async function sendCallOnChannel(channel, payload) {
    if (!channel) return false;
    try {
        await Promise.race([
            channel.send({
                type: 'broadcast',
                event: 'call',
                payload
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Arama sinyali zaman aşımı')), CALL_BROADCAST_SEND_TIMEOUT_MS);
            })
        ]);
        return true;
    } catch (err) {
        console.error('Arama sinyali gönderilemedi:', err);
        return false;
    }
}

export async function broadcastCallSignal(payload) {
    if (!payload?.conversation_id) return false;

    const ready = await ensureCallBroadcastReady(null, payload.conversation_id).catch(() => false);
    if (!ready) {
        console.warn('[realtime-chat] Arama broadcast kanalı hazır değil:', {
            conversation_id: payload.conversation_id,
            type: payload.type
        });
    }

    const roomKey = `dm:${payload.conversation_id}`;
    const tried = new Set();
    let sent = false;

    const trySend = async (channel) => {
        if (!channel || tried.has(channel)) return false;
        tried.add(channel);
        if (channel.state !== 'joined') return false;
        return sendCallOnChannel(channel, payload);
    };

    if (activeChannel && activeRoomKey === roomKey) {
        sent = await trySend(activeChannel) || sent;
    }

    const notifyChannel = notificationChannelByConversation.get(payload.conversation_id);
    sent = await trySend(notifyChannel) || sent;

    return sent;
}
