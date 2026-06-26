/**
 * Windows'ta vercel dev UV_HANDLE_CLOSING hatasını önlemek için
 * hafif yerel geliştirme sunucusu. API handler'ları doğrudan çalıştırır.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapEnv } from '../api/_lib/env.js';
import { getAdminAllowlist, hasAdminConfig } from '../api/_lib/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

bootstrapEnv();

const adminAllowlist = getAdminAllowlist();
if (hasAdminConfig()) {
    console.log(`> Bulut YP: ${adminAllowlist.emails.length} yönetici e-postası yüklendi`);
} else {
    console.warn('> Bulut YP: ADMIN_EMAILS veya MASTER_USER tanımlı değil (.env.local)');
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml'
};

const API_HANDLERS = [
    { pattern: /^\/api\/media-sign$/, module: 'media-sign', jsonBody: true },
    { pattern: /^\/api\/media\/(.+)$/, module: 'media-serve', query: (m) => ({ key: decodeURIComponent(m[1]) }) },
    { pattern: /^\/api\/upload$/, module: 'upload' },
    { pattern: /^\/api\/cloud$/, module: 'cloud' },
    { pattern: /^\/api\/avatar-remove$/, module: 'avatar-remove' },
    { pattern: /^\/api\/push-subscribe$/, module: 'push-subscribe', jsonBody: true },
    { pattern: /^\/api\/push-vapid-public$/, module: 'push-vapid-public' },
    { pattern: /^\/api\/push-notify$/, module: 'push-notify', jsonBody: true },
    { pattern: /^\/api\/r2-cleanup$/, module: 'r2-cleanup' }
];

const STATIC_ROOTS = new Set(['js', 'css', 'shared', 'icons', 'api']);

function enhanceResponse(res) {
    if (res._enhanced) return res;
    res._enhanced = true;
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.end(JSON.stringify(body));
    };
    return res;
}

function parseUrlQuery(url) {
    const parsed = new URL(url, 'http://127.0.0.1');
    const query = {};
    parsed.searchParams.forEach((value, key) => {
        query[key] = value;
    });
    return { pathname: parsed.pathname, query };
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function matchApi(pathname) {
    for (const route of API_HANDLERS) {
        const match = pathname.match(route.pattern);
        if (match) return { route, match };
    }
    return null;
}

function isSpaRoute(pathname) {
    if (pathname === '/' || pathname === '/index.html') return true;
    const first = pathname.replace(/^\/+/, '').split('/')[0];
    if (!first) return true;
    if (STATIC_ROOTS.has(first)) return false;
    if (first.includes('.')) return false;
    return true;
}

function serveStatic(pathname, res) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.normalize(path.join(ROOT, filePath.replace(/^\/+/, '')));

    if (!filePath.startsWith(ROOT)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (isSpaRoute(pathname)) {
                fs.readFile(path.join(ROOT, 'index.html'), (spaErr, spaData) => {
                    if (spaErr) {
                        res.statusCode = 404;
                        res.end('Not found');
                        return;
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', MIME['.html']);
                    res.setHeader('Cache-Control', 'no-cache');
                    res.end(spaData);
                });
                return;
            }
            res.statusCode = 404;
            res.end('Not found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        if (ext === '.html') {
            res.setHeader('Cache-Control', 'no-cache');
        }
        res.end(data);
    });
}

async function dispatchApi(req, res, route, match) {
    const mod = await import(`../api/${route.module}.js`);
    const handler = mod.default;
    if (!handler) {
        res.statusCode = 500;
        res.end('Handler missing');
        return;
    }

    const { query: urlQuery } = parseUrlQuery(req.url);
    const extraQuery = route.query ? route.query(match) : {};
    req.query = { ...urlQuery, ...extraQuery };

    if (route.jsonBody && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const raw = await readRequestBody(req);
        try {
            req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
        } catch {
            res.statusCode = 400;
            res.json({ error: 'Geçersiz JSON.' });
            return;
        }
    }

    enhanceResponse(res);
    try {
        await handler(req, res);
    } catch (err) {
        console.error(`[api/${route.module}]`, err);
        if (!res.headersSent) {
            res.status(500).json({ error: err?.message || 'API hatası.' });
        }
    }
}

const server = http.createServer(async (req, res) => {
    try {
        const { pathname } = parseUrlQuery(req.url);
        const api = matchApi(pathname);

        if (api) {
            await dispatchApi(req, res, api.route, api.match);
            return;
        }

        serveStatic(pathname, res);
    } catch (err) {
        console.error('local-dev error:', err);
        if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal error');
        }
    }
});

server.keepAliveTimeout = 5000;
server.headersTimeout = 10000;

server.listen(PORT, () => {
    console.log(`> Woxifly local dev: http://localhost:${PORT}`);
    console.log('> (vercel dev yerine — Windows UV_HANDLE_CLOSING yok)');
});
