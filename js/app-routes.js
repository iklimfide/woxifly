import { districtToRoomSlug, DISTRICTS } from './config.js';

const SLUG_TO_DISTRICT = new Map(
    DISTRICTS.map((district) => [districtToRoomSlug(district), district])
);

const RESERVED_TOP_LEVEL = new Set(['uye', 'profil', 'profile', 'sohbetler', 'chats']);

export function usernameToSlug(username) {
    if (!username) return '';
    return username
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9._-]+/g, '');
}

export function roomSlugToDistrict(slug) {
    if (!slug) return null;
    return SLUG_TO_DISTRICT.get(slug.toLowerCase()) || null;
}

export function buildAppPath({ activePanel, currentActiveChat, username } = {}) {
    if (activePanel === 'profile-panel') return '/profil';
    if (!currentActiveChat) return '/';

    if (currentActiveChat.startsWith('Group-')) {
        const district = currentActiveChat.replace('Group-', '');
        return `/${districtToRoomSlug(district)}`;
    }

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

    const dmMatch = path.match(/^\/uye\/([^/]+)$/i);
    if (dmMatch) {
        return { usernameSlug: decodeURIComponent(dmMatch[1]).toLowerCase() };
    }

    const slug = path.slice(1);
    if (slug && !slug.includes('/') && !RESERVED_TOP_LEVEL.has(slug.toLowerCase())) {
        const district = roomSlugToDistrict(slug);
        if (district) {
            return { chatId: `Group-${district}` };
        }
    }

    return null;
}

export function parseLegacyHash(hash) {
    const raw = (hash || '').replace(/^#/, '');
    if (!raw) return null;

    if (raw === 'profile') return { view: 'profile-panel' };
    if (raw === 'chats') return { view: 'chats-home' };

    const [type, ...rest] = raw.split('/');
    const value = decodeURIComponent(rest.join('/'));

    if (type === 'g' && value) {
        return { chatId: `Group-${value}` };
    }

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
