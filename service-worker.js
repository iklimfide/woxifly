/* Woxifly — hafif PWA service worker (push + önbellek) */

const CACHE_NAME = 'woxifly-shell-v1';
const SHELL_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/favicon.png'
];

const MASKED_TITLE = 'Woxifly: Yeni bildirim';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((response) => {
                    if (response.ok && (url.pathname === '/' || url.pathname.endsWith('.html'))) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || network;
        })
    );
});

self.addEventListener('push', (event) => {
    event.waitUntil(handlePush(event));
});

async function handlePush(event) {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = {};
    }

    const tag = payload.tag || 'woxifly-notification';
    const existing = await self.registration.getNotifications({ tag });
    const previousCount = existing.reduce((max, notification) => {
        const count = Number(notification.data?.count) || 1;
        return Math.max(max, count);
    }, 0);
    const count = previousCount + 1;

    existing.forEach((notification) => notification.close());

    const options = {
        body: count > 1 ? `${count} yeni mesaj` : '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        renotify: count > 1,
        silent: false,
        data: {
            chatType: payload.chatType || null,
            district: payload.district || null,
            userId: payload.userId || null,
            username: payload.username || null,
            count
        }
    };

    await self.registration.showNotification(MASKED_TITLE, options);
}

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const data = event.notification.data || {};
    const targetUrl = buildNotifyUrl(data);

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clients) => {
                for (const client of clients) {
                    if (client.url.startsWith(self.location.origin)) {
                        client.postMessage({ type: 'NOTIFICATION_CLICK', data });
                        return client.focus();
                    }
                }
                return self.clients.openWindow(targetUrl);
            })
    );
});

function slugDistrict(district) {
    return district
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9]+/g, '');
}

function slugUsername(username) {
    return username
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/ı/g, 'i')
        .replace(/[^a-z0-9._-]+/g, '');
}

function buildNotifyUrl(data) {
    if (data.chatType === 'group' && data.district) {
        return `/${slugDistrict(data.district)}`;
    }
    if (data.chatType === 'dm' && data.username) {
        return `/uye/${slugUsername(data.username)}`;
    }
    if (data.chatType === 'dm' && data.userId) {
        return `/?notify=u/${data.userId}`;
    }
    return '/';
}

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
