import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
    SUPABASE_URL as PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY as PUBLIC_SUPABASE_ANON_KEY,
    R2_ACCOUNT_ID as PUBLIC_R2_ACCOUNT_ID,
    R2_ENDPOINT as PUBLIC_R2_ENDPOINT,
    R2_BUCKET_NAME as PUBLIC_R2_BUCKET_NAME
} from '../../shared/public-config.js';

let envBootstrapped = false;

function parseEnvFile(content) {
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const separator = line.indexOf('=');
        if (separator === -1) continue;

        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

function bootstrapEnv() {
    if (envBootstrapped) return;
    envBootstrapped = true;

    const root = process.cwd();
    for (const filename of ['.env.local', '.env']) {
        const filePath = join(root, filename);
        if (!existsSync(filePath)) continue;
        parseEnvFile(readFileSync(filePath, 'utf8'));
    }
}

function env(name, fallback = '') {
    bootstrapEnv();
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }
    return fallback;
}

export function getSupabaseAuthConfig() {
    const url = env('SUPABASE_URL', PUBLIC_SUPABASE_URL);
    const anonKey = env('SUPABASE_ANON_KEY', PUBLIC_SUPABASE_ANON_KEY);

    if (!url || !anonKey) {
        return {
            error: 'SUPABASE_URL veya SUPABASE_ANON_KEY eksik. Vercel ortam değişkenlerini kontrol edin.'
        };
    }

    return { url, anonKey };
}

export function getSupabaseServiceConfig() {
    const url = env('SUPABASE_URL', PUBLIC_SUPABASE_URL);
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !serviceKey) {
        return {
            error: 'SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik. .env.local veya Vercel ayarlarını kontrol edin.'
        };
    }

    return { url, serviceKey };
}

export function getR2Config() {
    const accountId = env('R2_ACCOUNT_ID', PUBLIC_R2_ACCOUNT_ID);
    const endpoint = env('R2_ENDPOINT', PUBLIC_R2_ENDPOINT);
    const bucket = env('R2_BUCKET_NAME', PUBLIC_R2_BUCKET_NAME);
    const publicBaseUrl = env('R2_PUBLIC_BASE_URL', '');
    const accessKeyId = env('R2_ACCESS_KEY_ID');
    const secretAccessKey = env('R2_SECRET_ACCESS_KEY');

    return {
        accountId,
        endpoint,
        bucket,
        publicBaseUrl,
        accessKeyId,
        secretAccessKey
    };
}

export function getCronSecret() {
    return env('CRON_SECRET');
}

export function getVapidConfig() {
    const publicKey = env('VAPID_PUBLIC_KEY');
    const privateKey = env('VAPID_PRIVATE_KEY');
    const subject = env('VAPID_SUBJECT', 'mailto:notify@woxifly.app');

    if (!publicKey || !privateKey) {
        return {
            error: 'VAPID_PUBLIC_KEY veya VAPID_PRIVATE_KEY eksik. Push bildirimleri devre dışı.'
        };
    }

    return { publicKey, privateKey, subject };
}
