/** Davet kodu: 8 karakter, I/O/0/1 yok. */
const INVITE_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeInviteCode(raw) {
    return String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8);
}

export function isValidInviteCode(code) {
    return INVITE_CODE_RE.test(normalizeInviteCode(code));
}

export function buildInvitePath(code) {
    const normalized = normalizeInviteCode(code);
    if (!isValidInviteCode(normalized)) return null;
    return `/davet/${normalized}`;
}

export function buildInviteUrl(code, origin = '') {
    const path = buildInvitePath(code);
    if (!path) return null;
    const base = origin || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${base}${path}`;
}
