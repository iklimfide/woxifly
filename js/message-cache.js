const CACHE_VERSION = 1;
const STORAGE_PREFIX = `woxifly:msg-hist:v${CACHE_VERSION}`;
const MAX_CONVERSATIONS = 15;

function bucketKey(userId) {
    return `${STORAGE_PREFIX}:${userId || 'anon'}`;
}

function readBucket(userId) {
    try {
        const raw = localStorage.getItem(bucketKey(userId));
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function writeBucket(userId, bucket) {
    try {
        localStorage.setItem(bucketKey(userId), JSON.stringify(bucket));
    } catch {
        const keys = Object.keys(bucket).sort(
            (a, b) => (bucket[a]?.savedAt || 0) - (bucket[b]?.savedAt || 0)
        );
        while (keys.length > 1) {
            delete bucket[keys.shift()];
            try {
                localStorage.setItem(bucketKey(userId), JSON.stringify(bucket));
                return;
            } catch {
                // keep evicting
            }
        }
    }
}

function trimBucket(bucket) {
    const keys = Object.keys(bucket);
    if (keys.length <= MAX_CONVERSATIONS) return bucket;

    keys
        .sort((a, b) => (bucket[a]?.savedAt || 0) - (bucket[b]?.savedAt || 0))
        .slice(0, keys.length - MAX_CONVERSATIONS)
        .forEach((key) => {
            delete bucket[key];
        });

    return bucket;
}

/** @returns {{ messages: object[], reactionRows: object[] } | null} */
export function getCachedMessageHistory(userId, conversationId) {
    if (!conversationId) return null;

    const entry = readBucket(userId)[conversationId];
    if (!entry?.messages?.length) return null;

    return {
        messages: entry.messages,
        reactionRows: entry.reactionRows || []
    };
}

export function setCachedMessageHistory(userId, conversationId, { messages, reactionRows = [] }) {
    if (!conversationId || !messages?.length) return;

    const bucket = trimBucket(readBucket(userId));
    bucket[conversationId] = {
        savedAt: Date.now(),
        messages,
        reactionRows
    };
    writeBucket(userId, bucket);
}

export function clearCachedMessageHistory(userId, conversationId) {
    if (!conversationId) return;

    const bucket = readBucket(userId);
    if (!bucket[conversationId]) return;

    delete bucket[conversationId];
    writeBucket(userId, bucket);
}
