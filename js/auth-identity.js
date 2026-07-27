/** Supabase Auth kimliği — gerçek posta kutusu değil. */
export const LOGIN_EMAIL_DOMAIN = 'login.woxifly.internal';

export function normalizeLoginUsername(username) {
    return String(username || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim()
        .slice(0, 24)
        .toLowerCase();
}

export function usernameToLoginEmail(username) {
    const normalized = normalizeLoginUsername(username);
    if (!normalized) return '';
    return `${normalized}@${LOGIN_EMAIL_DOMAIN}`;
}

/** Giriş alanı: rumuz veya (eski hesaplar için) e-posta. */
export function resolveAuthLoginEmail(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return '';
    if (trimmed.includes('@') && !trimmed.toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`)) {
        return trimmed.toLowerCase();
    }
    return usernameToLoginEmail(trimmed);
}

export function isValidLoginPassword(password) {
    return typeof password === 'string' && password.length >= 6 && password.length <= 72;
}
