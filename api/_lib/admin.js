import { bootstrapEnv } from './env.js';

function env(name, fallback = '') {
    bootstrapEnv();
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return fallback;
}

function splitList(raw) {
    return (raw || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function mergeUnique(target, items) {
    for (const item of items) {
        if (!target.includes(item)) target.push(item);
    }
}

function readEnvList(...names) {
    const values = [];
    for (const name of names) {
        mergeUnique(values, splitList(env(name)));
    }
    return values;
}

function normalizeAdminEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email || !email.includes('@') || email.length < 5) return null;
    return email;
}

function resolveUserEmail(user) {
    const candidates = [
        user?.email,
        user?.user_metadata?.email,
        user?.raw_user_meta_data?.email
    ];

    for (const candidate of candidates) {
        const normalized = normalizeAdminEmail(candidate);
        if (normalized) return normalized;
    }

    return null;
}

export function getAdminAllowlist() {
    const userIds = readEnvList(
        'ADMIN_USER_IDS',
        'MASTER_USER_IDS',
        'MASTER_USER_ID'
    );

    const emails = readEnvList(
        'ADMIN_EMAILS',
        'MASTER_USER_EMAILS',
        'MASTER_USER_EMAIL',
        'MASTER_EMAIL',
        'MASTER_EMAILS'
    )
        .map(normalizeAdminEmail)
        .filter(Boolean);

    const masterUser = env('MASTER_USER');
    if (masterUser) {
        if (masterUser.includes('@')) {
            const normalized = normalizeAdminEmail(masterUser);
            if (normalized) mergeUnique(emails, [normalized]);
        } else {
            mergeUnique(userIds, [masterUser]);
        }
    }

    return { userIds, emails };
}

export function isAdminUser(user) {
    if (!user?.id) return false;

    const { userIds, emails } = getAdminAllowlist();
    if (!userIds.length && !emails.length) return false;

    if (userIds.includes(user.id)) return true;

    const email = resolveUserEmail(user);
    return email ? emails.includes(email) : false;
}

export function describeAdminDenial(user) {
    if (!hasAdminConfig()) {
        return 'Yönetici listesi tanımlı değil. Yerelde .env.local içine ADMIN_EMAILS ekleyip npm run local ile yeniden başlatın; canlıda Vercel ortam değişkenlerine ekleyip deploy edin.';
    }

    const email = resolveUserEmail(user) || '(oturumda e-posta yok)';
    return `Giriş yapılan hesap (${email}) yönetici listesinde değil. ADMIN_EMAILS veya MASTER_USER değerinin bu e-posta ile eşleştiğinden emin olun.`;
}

export function hasAdminConfig() {
    const { userIds, emails } = getAdminAllowlist();
    return userIds.length > 0 || emails.length > 0;
}
