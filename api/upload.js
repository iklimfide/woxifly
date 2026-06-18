import { createClient } from '@supabase/supabase-js';
import { verifyAuthToken } from './_lib/auth.js';
import { saveMedia, deleteMedia, MEDIA_KINDS } from './_lib/media-store.js';
import { readRawBody, parseMultipart } from './_lib/multipart.js';
import { getSupabaseAuthConfig } from './_lib/env.js';

async function getPreviousAvatarKey(req, userId) {
    const supabaseConfig = getSupabaseAuthConfig();
    if (supabaseConfig.error) return null;

    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    const { data } = await supabase
        .from('profiles')
        .select('avatar_r2_key')
        .eq('id', userId)
        .single();

    return data?.avatar_r2_key || null;
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Yalnızca POST desteklenir.' });
        return;
    }

    try {
        const auth = await verifyAuthToken(req);
        if (auth.error) {
            res.status(auth.status).json({ error: auth.error });
            return;
        }

        const header = req.headers['content-type'] || '';
        if (!header.includes('multipart/form-data')) {
            res.status(400).json({ error: 'multipart/form-data gerekli.' });
            return;
        }

        const boundaryMatch = header.match(/boundary=([^;]+)/i);
        if (!boundaryMatch) {
            res.status(400).json({ error: 'Geçersiz multipart isteği.' });
            return;
        }

        const parts = parseMultipart(await readRawBody(req), boundaryMatch[1]);
        const filePart = parts.find((p) => p.name === 'file');
        const kindPart = parts.find((p) => p.name === 'kind') || parts.find((p) => p.name === 'type');

        if (!filePart?.data?.length) {
            res.status(400).json({ error: 'Dosya bulunamadı.' });
            return;
        }

        const queryKind = typeof req.query?.kind === 'string' ? req.query.kind.trim() : '';
        const partKind = kindPart?.data?.toString('utf8').trim() || '';
        const kind = queryKind || partKind;
        if (!MEDIA_KINDS[kind]) {
            res.status(400).json({ error: 'Geçersiz kind alanı (image|video|audio|avatar).' });
            return;
        }

        const mimeType = (filePart.contentType || '').split(';')[0].trim().toLowerCase();
        const fileName = filePart.filename || '';

        const previousAvatarKey = kind === 'avatar'
            ? await getPreviousAvatarKey(req, auth.user.id)
            : null;

        const result = await saveMedia({
            userId: auth.user.id,
            fileBuffer: filePart.data,
            mimeType,
            kind,
            fileName
        });

        if (result.error) {
            res.status(400).json({ error: result.error });
            return;
        }

        if (kind === 'avatar' && previousAvatarKey && previousAvatarKey !== result.r2Key) {
            const safeUserId = String(auth.user.id).replace(/[^a-zA-Z0-9-]/g, '');
            if (previousAvatarKey.startsWith(`avatars/${safeUserId}/`)) {
                try {
                    await deleteMedia(previousAvatarKey);
                } catch (err) {
                    console.error('previous avatar delete error:', previousAvatarKey, err);
                }
            }
        }

        res.status(200).json(result);
    } catch (err) {
        console.error('upload error:', err);
        res.status(500).json({ error: 'Yükleme başarısız.' });
    }
}

export const config = {
    api: { bodyParser: false }
};
