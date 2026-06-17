import { createClient } from '@supabase/supabase-js';
import { deleteMedia } from './_lib/media-store.js';
import { getCronSecret, getSupabaseServiceConfig } from './_lib/env.js';

const BATCH_SIZE = 50;

export default async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const cronSecret = getCronSecret();
    const authHeader = typeof req.headers?.get === 'function'
        ? req.headers.get('authorization')
        : (req.headers?.authorization || req.headers?.Authorization || '');

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        res.status(401).json({ error: 'Yetkisiz' });
        return;
    }

    const supabaseConfig = getSupabaseServiceConfig();
    if (supabaseConfig.error) {
        res.status(500).json({ error: supabaseConfig.error });
        return;
    }

    const supabase = createClient(supabaseConfig.url, supabaseConfig.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: queue, error } = await supabase
        .from('r2_deletion_queue')
        .select('id, r2_key')
        .is('processed_at', null)
        .order('queued_at', { ascending: true })
        .limit(BATCH_SIZE);

    if (error) {
        console.error('queue read error:', error);
        res.status(500).json({ error: 'Kuyruk okunamadı' });
        return;
    }

    if (!queue?.length) {
        res.status(200).json({ processed: 0, message: 'Kuyruk boş' });
        return;
    }

    let processed = 0;
    const failures = [];

    for (const item of queue) {
        if (item.r2_key?.startsWith('avatars/')) {
            await supabase
                .from('r2_deletion_queue')
                .update({ processed_at: new Date().toISOString() })
                .eq('id', item.id);
            continue;
        }

        try {
            await deleteMedia(item.r2_key);
            const { error: updateError } = await supabase
                .from('r2_deletion_queue')
                .update({ processed_at: new Date().toISOString() })
                .eq('id', item.id);

            if (updateError) throw updateError;
            processed += 1;
        } catch (err) {
            console.error('R2 delete failed:', item.r2_key, err);
            failures.push(item.r2_key);
        }
    }

    res.status(200).json({
        processed,
        failed: failures.length,
        failures
    });
}
