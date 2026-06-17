import { createClient } from '@supabase/supabase-js';
import { getSupabaseAuthConfig } from './env.js';

export async function verifyAuthToken(req) {
    const authHeader = typeof req.headers?.get === 'function'
        ? req.headers.get('authorization')
        : (req.headers?.authorization || req.headers?.Authorization);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { error: 'Yetkilendirme gerekli.', status: 401 };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
        return { error: 'Geçersiz token.', status: 401 };
    }

    const supabaseConfig = getSupabaseAuthConfig();
    if (supabaseConfig.error) {
        return { error: supabaseConfig.error, status: 500 };
    }

    const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return { error: 'Oturum geçersiz.', status: 401 };
    }

    return { user: data.user };
}

export function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
        }
    });
}
