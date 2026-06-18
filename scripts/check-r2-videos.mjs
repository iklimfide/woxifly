import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
    for (const file of ['.env.local', '.env']) {
        const path = join(process.cwd(), file);
        if (!existsSync(path)) continue;
        for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const i = trimmed.indexOf('=');
            if (i === -1) continue;
            const key = trimmed.slice(0, i).trim();
            let value = trimmed.slice(i + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            if (process.env[key] === undefined) process.env[key] = value;
        }
    }
}

loadEnv();

const bucket = process.env.R2_BUCKET_NAME || 'woxifly';
const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!accessKeyId || !secretAccessKey) {
    console.error('R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY eksik');
    process.exit(1);
}

const s3 = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
});

async function listPrefix(prefix, max = 500) {
    const items = [];
    let token;
    do {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: Math.min(1000, max - items.length)
        }));
        for (const obj of res.Contents || []) {
            items.push({ key: obj.Key, size: obj.Size, modified: obj.LastModified });
            if (items.length >= max) break;
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token && items.length < max);
    return items;
}

async function headKey(key) {
    try {
        const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { ok: true, contentType: res.ContentType, size: res.ContentLength };
    } catch (err) {
        return { ok: false, error: err.name || err.message };
    }
}

function keyFromMessage(row) {
    if (row.r2_key) return row.r2_key.replace(/^\/+/, '');
    const url = row.media_url || '';
    const m = url.match(/(?:images|videos|audio|avatars|uploads)\/.+$/i);
    return m ? m[0] : null;
}

async function main() {
    console.log('=== R2 bucket:', bucket, '===\n');

    for (const prefix of ['videos/', 'uploads/', 'images/', 'audio/']) {
        const items = await listPrefix(prefix, 200);
        const totalSize = items.reduce((s, i) => s + (i.size || 0), 0);
        console.log(`${prefix}: ${items.length} dosya (${(totalSize / 1024 / 1024).toFixed(2)} MB)`);
        for (const item of items.slice(0, 5)) {
            console.log(`  - ${item.key} (${item.size} B)`);
        }
        if (items.length > 5) console.log(`  ... +${items.length - 5} daha`);
        console.log('');
    }

    if (!supabaseUrl || !serviceKey) {
        console.log('Supabase service key yok — DB kontrolü atlandı');
        return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: videos, error } = await supabase
        .from('messages')
        .select('id, created_at, content_type, media_url, r2_key, sender_id')
        .eq('content_type', 'video')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Supabase hata:', error.message);
        return;
    }

    console.log(`=== Son ${videos.length} video mesajı (DB) ===\n`);

    const missing = [];
    const mismatch = [];

    for (const row of videos) {
        const key = keyFromMessage(row);
        const urlPrefix = row.media_url?.includes('/uploads/') ? 'uploads' : row.media_url?.includes('/videos/') ? 'videos' : '?';
        const r2Prefix = row.r2_key?.split('/')[0] || '?';

        console.log(`id=${row.id} created=${row.created_at}`);
        console.log(`  media_url=${row.media_url}`);
        console.log(`  r2_key=${row.r2_key}`);
        console.log(`  resolved_key=${key}`);

        if (!key) {
            console.log(`  status=NO KEY\n`);
            missing.push(row);
            continue;
        }

        const head = await headKey(key);
        const status = head.ok ? `OK (${head.contentType}, ${head.size}B)` : `MISSING (${head.error})`;
        console.log(`  status=${status}\n`);

        if (!head.ok) {
            missing.push({ ...row, key });
        }

        if (row.r2_key && row.media_url) {
            const urlKey = keyFromMessage({ media_url: row.media_url });
            if (urlKey && urlKey !== row.r2_key.replace(/^\/+/, '')) {
                mismatch.push({ id: row.id, r2_key: row.r2_key, media_url: row.media_url });
            }
        }
    }

    const uploadsRes = await listPrefix('uploads/', 500);
    const uploadVideos = uploadsRes.filter((o) => /\.(mp4|mov|webm|m4v)$/i.test(o.key));
    console.log(`uploads/ altında video dosyası: ${uploadVideos.length}`);
    for (const v of uploadVideos) {
        console.log(`  ${v.key} (${v.size} B)`);
    }

    console.log(`\n=== Özet ===`);
    console.log(`Toplam video mesaj: ${videos.length}`);
    console.log(`R2'de bulunamayan: ${missing.length}`);
    console.log(`media_url vs r2_key uyumsuz: ${mismatch.length}`);

    if (missing.length) {
        console.log('\nEksik dosya anahtarları:');
        for (const m of missing) {
            console.log(`  - ${m.key || m.media_url} (msg ${m.id})`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
