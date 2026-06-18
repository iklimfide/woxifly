import { bootstrapEnv } from './env.js';

function env(name, fallback = '') {
    bootstrapEnv();
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return fallback;
}

export function getAdminAllowlist() {
    const userIds = env('ADMIN_USER_IDS', '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    const emails = env('ADMIN_EMAILS', '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

    return { userIds, emails };
}

export function isAdminUser(user) {
    if (!user?.id) return false;

    const { userIds, emails } = getAdminAllowlist();
    if (!userIds.length && !emails.length) return false;

    if (userIds.includes(user.id)) return true;

    const email = (user.email || '').trim().toLowerCase();
    return email ? emails.includes(email) : false;
}
