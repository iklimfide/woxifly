import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

export async function getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
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
