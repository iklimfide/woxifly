import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

const REFRESH_SOON_SEC = 120;
const SESSION_KEEPALIVE_MS = 45 * 60 * 1000;
let sessionKeepAliveStarted = false;

export async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
}

function sessionNeedsRefresh(session, { forceRefresh = false } = {}) {
    if (forceRefresh) return true;
    if (!session?.access_token) return false;
    const expiresAt = session.expires_at;
    if (typeof expiresAt !== 'number') return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return expiresAt <= nowSec + REFRESH_SOON_SEC;
}

/** Vercel API route'ları için güncel access token (süresi dolmuşsa yeniler). */
export async function getAccessTokenForApi({ forceRefresh = false } = {}) {
    let session = await getSession();

    if (!session?.access_token) {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data.session?.access_token) {
            return data.session.access_token;
        }
        return null;
    }

    if (!sessionNeedsRefresh(session, { forceRefresh })) {
        return session.access_token;
    }

    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session?.access_token) {
        return data.session.access_token;
    }

    if (sessionNeedsRefresh(session, { forceRefresh: true })) {
        return null;
    }

    return session.access_token;
}

export async function getAuthHeadersForApi(options = {}) {
    const token = await getAccessTokenForApi(options);
    if (!token) return null;
    return { Authorization: `Bearer ${token}` };
}

/** Bearer token ile fetch; 401'de bir kez oturum yenileyip tekrar dener. */
export async function fetchWithAuth(input, init = {}) {
    const buildInit = (token) => {
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        return { ...init, headers };
    };

    let token = await getAccessTokenForApi();
    if (!token) {
        token = await getAccessTokenForApi({ forceRefresh: true });
    }
    if (!token) {
        throw new Error('Oturum gerekli.');
    }

    let res = await fetch(input, buildInit(token));
    if (res.status === 401) {
        token = await getAccessTokenForApi({ forceRefresh: true });
        if (token) {
            res = await fetch(input, buildInit(token));
        }
    }

    return res;
}

/** Uygulama açıkken JWT'nin arka planda bayatlamaması (mobil / uzun sekme). */
export function initSessionKeepAlive() {
    if (sessionKeepAliveStarted) return;
    sessionKeepAliveStarted = true;

    const touch = (forceRefresh = false) => {
        if (!document.hidden || forceRefresh) {
            void getAccessTokenForApi({ forceRefresh }).catch(() => {});
        }
    };

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) touch(true);
    });

    window.addEventListener('online', () => touch(true));

    window.setInterval(() => touch(false), SESSION_KEEPALIVE_MS);

    supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') return;
        if (event === 'TOKEN_REFRESHED') return;
    });
}

export async function requireAuth(redirectTo = '/auth.html') {
    const session = await getSession();
    if (!session) {
        window.location.href = redirectTo;
        return null;
    }
    return session;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.href = '/index.html';
}

export function getLoginUrl(returnPath) {
    const path = returnPath || (window.location.pathname + window.location.search);
    return `/auth.html?return=${encodeURIComponent(path)}`;
}

export function getRegisterUrl(returnPath) {
    const path = returnPath || (window.location.pathname + window.location.search);
    return `/auth.html?mode=register&return=${encodeURIComponent(path)}`;
}
