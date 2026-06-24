const RESERVED_TOP_LEVEL = new Set(['uye', 'profil', 'profile', 'sohbetler', 'chats', 'bulut']);

export function usernameToSlug(username) {
    if (!username) return '';
    return username
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9._-]+/g, '');
}

export function buildAppPath({ activePanel, currentActiveChat, username, profileUsername, memberProfileUsername } = {}) {
    if (activePanel === 'profile-panel') {
        const slug = usernameToSlug(profileUsername);
        if (slug) return `/uye/${slug}`;
        return '/profil';
    }
    if (activePanel === 'member-profile-panel') {
        const slug = usernameToSlug(memberProfileUsername);
        if (slug) return `/uye/${slug}/profil`;
    }
    if (activePanel === 'bulut-panel') return '/bulut';
    if (!currentActiveChat) return '/';

    if (currentActiveChat.startsWith('User-') && username) {
        const slug = usernameToSlug(username);
        return slug ? `/uye/${slug}` : '/';
    }

    return '/';
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

    return parseAppPath(window.location.pathname);
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
