import { normalizeInviteCode, isValidInviteCode } from './invite-code.js';

const RESERVED_TOP_LEVEL = new Set(['uye', 'profil', 'profile', 'sohbetler', 'chats', 'bulut', 'davet']);

export function usernameToSlug(username) {
    if (!username) return '';
    return username
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9._-]+/g, '');
}

export function buildAppPath({ activePanel, currentActiveChat } = {}) {
    if (activePanel === 'profile-panel') return '/profil';
    if (activePanel === 'bulut-panel') return '/bulut';
    return '/';
}

export function parseUserInviteQuery() {
    const params = new URLSearchParams(window.location.search);
    const davetRaw = params.get('davet') || params.get('invite');
    if (davetRaw?.trim()) {
        const code = normalizeInviteCode(davetRaw);
        if (isValidInviteCode(code)) return { inviteCode: code };
    }

    const raw = params.get('u') || params.get('uye');
    if (!raw?.trim()) return null;
    const slug = usernameToSlug(raw.trim()) || raw.trim().toLowerCase();
    return slug ? { usernameSlug: slug } : null;
}

export function clearUserInviteQuery() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('u') && !params.has('uye') && !params.has('davet') && !params.has('invite')) return;
    params.delete('u');
    params.delete('uye');
    params.delete('davet');
    params.delete('invite');
    const qs = params.toString();
    history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

export function parseAppPath(pathname) {
    const path = (pathname || '/').replace(/\/+$/, '') || '/';

    if (path === '/' || path === '/sohbetler' || path === '/chats') {
        return { view: 'chats-home' };
    }

    if (path === '/profil' || path === '/profile') {
        return { view: 'profile-panel' };
    }

    if (path === '/bulut') {
        return { view: 'bulut-panel' };
    }

    const inviteMatch = path.match(/^\/davet\/([^/]+)$/i);
    if (inviteMatch) {
        const code = normalizeInviteCode(decodeURIComponent(inviteMatch[1]));
        if (isValidInviteCode(code)) return { inviteCode: code };
    }

    const dmProfileMatch = path.match(/^\/uye\/([^/]+)\/profil$/i);
    if (dmProfileMatch) {
        return {
            view: 'member-profile',
            usernameSlug: decodeURIComponent(dmProfileMatch[1]).toLowerCase()
        };
    }

    const dmMatch = path.match(/^\/uye\/([^/]+)$/i);
    if (dmMatch) {
        return { usernameSlug: decodeURIComponent(dmMatch[1]).toLowerCase() };
    }

    return null;
}

export function parseLegacyHash(hash) {
    const raw = (hash || '').replace(/^#/, '');
    if (!raw) return null;

    if (raw === 'profile') return { view: 'profile-panel' };
    if (raw === 'bulut') return { view: 'bulut-panel' };
    if (raw === 'chats') return { view: 'chats-home' };

    const [type, ...rest] = raw.split('/');
    const value = decodeURIComponent(rest.join('/'));

    if (type === 'u' && value) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
            return { userId: value };
        }
        return { usernameSlug: value.toLowerCase() };
    }

    return null;
}

export function parseLegacyNotifyParam(raw) {
    if (!raw) return null;

    if (raw.startsWith('/')) {
        return parseAppPath(raw);
    }

    return parseLegacyHash(`#${raw}`);
}

export function parseAppRoute() {
    const hash = window.location.hash;
    if (hash) {
        const legacy = parseLegacyHash(hash);
        if (legacy) {
            return legacy;
        }
    }

    const invite = parseUserInviteQuery();
    if (invite) return invite;

    return parseAppPath(window.location.pathname);
}

export function isStandalonePwa() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
}

/** PWA kısayolundan açılışta sohbet URL'lerini anasayfaya çevir (bildirim deeplink hariç). */
export function shouldForcePwaHomeStart({ hasNotifyRoute = false } = {}) {
    if (!isStandalonePwa() || hasNotifyRoute) return false;

    const route = parseAppRoute();
    if (!route) return true;

    if (route.view === 'chats-home') return false;
    if (route.view === 'profile-panel' || route.view === 'bulut-panel') return false;
    if (route.view === 'member-profile' || route.usernameSlug || route.userId || route.inviteCode) return false;

    return true;
}

export function replaceAppPath(path) {
    const qs = window.location.search;
    const target = `${path}${qs}`;
    const current = `${window.location.pathname}${qs}`;

    if (current !== target || window.location.hash) {
        history.replaceState(null, '', target);
    }
}

export function pushAppPath(path) {
    const qs = window.location.search;
    history.pushState(null, '', `${path}${qs}`);
}
