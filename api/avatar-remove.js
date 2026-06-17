import { createClient } from '@supabase/supabase-js';
import { verifyAuthToken } from './_lib/auth.js';
import { deleteMedia } from './_lib/media-store.js';
import { getSupabaseAuthConfig } from './_lib/env.js';

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST' && req.method !== 'DELETE') {
        res.status(405).json({ error: 'Yalnızca POST desteklenir.' });
        return;
    }

    try {
        const auth = await verifyAuthToken(req);
        if (auth.error) {
            res.status(auth.status).json({ error: auth.error });
            return;
        }

        const supabaseConfig = getSupabaseAuthConfig();
        if (supabaseConfig.error) {
            res.status(500).json({ error: supabaseConfig.error });
            return;
        }

        const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
        const token = authHeader.slice(7).trim();

        const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } }
        });

        const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('avatar_r2_key')
            .eq('id', auth.user.id)
            .single();

        if (fetchError) {
            res.status(400).json({ error: 'Profil okunamadı.' });
            return;
        }

        const r2Key = profile?.avatar_r2_key;
        const safeUserId = String(auth.user.id).replace(/[^a-zA-Z0-9-]/g, '');

        if (r2Key && r2Key.startsWith(`avatars/${safeUserId}/`)) {
            try {
                await deleteMedia(r2Key);
            } catch (err) {
                console.error('avatar remove r2 error:', r2Key, err);
            }
        }

        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                avatar_url: null,
                avatar_r2_key: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', auth.user.id);

        if (updateError) {
            res.status(400).json({ error: updateError.message });
            return;
        }

        res.status(200).json({ ok: true });
    } catch (err) {
        console.error('avatar-remove error:', err);
        res.status(500).json({ error: 'Fotoğraf kaldırılamadı.' });
    }
}
