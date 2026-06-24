let activeChannel = null;
let activeRoomKey = null;
let supabaseClient = null;
const seenClientIds = new Set();
const notificationChannels = new Map();
const notificationSeenClientIds = new Set();

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
    notificationSeenClientIds.clear();
}

/**
 * Açık olmayan DM sohbetlerinde gelen mesajlar için arka plan dinleyicileri.
 */
export function syncDmNotificationRooms(supabase, conversationIds, { activeConversationId = null, onMessage } = {}) {
    supabaseClient = supabase;
    const targetIds = new Set((conversationIds || []).filter(Boolean));

    for (const [convId, channel] of notificationChannels) {
        if (!targetIds.has(convId) || convId === activeConversationId) {
            supabase.removeChannel(channel);
            notificationChannels.delete(convId);
        }
    }

    for (const convId of targetIds) {
        if (convId === activeConversationId || notificationChannels.has(convId)) continue;

        const roomKey = `dm:${convId}`;
        const channel = supabase.channel(roomKey, {
            config: { broadcast: { ack: false, self: false } }
        });

        channel.on('broadcast', { event: 'shout' }, ({ payload }) => {
            if (!payload?.client_id) return;
            if (seenClientIds.has(payload.client_id)) return;
            if (notificationSeenClientIds.has(payload.client_id)) return;
            notificationSeenClientIds.add(payload.client_id);
            onMessage?.(payload, convId);
        }).subscribe();

        notificationChannels.set(convId, channel);
    }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export function joinDmRoom(supabase, conversationId, { userId, username, onMessage, onPresence, onReaction, onDelete }) {
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
