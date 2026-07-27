import {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    R2_ACCOUNT_ID,
    R2_ENDPOINT,
    R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL
} from '../shared/public-config.js';

export {
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    R2_ACCOUNT_ID,
    R2_ENDPOINT,
    R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL
};

/** Kayıtta konum seçilmediyse grup/radar için kullanılan sistem ilçesi. */
export const DEFAULT_LOCATION = 'Belirsiz';

const DEFAULT_COORDS = { lat: 40.981857142857145, lon: 29.186857142857146 };

export function getLocationCoords() {
    if (DEFAULT_LOCATION === 'Belirsiz') return null;
    return DEFAULT_COORDS;
}

/** Tek seferde yüklenen mesaj sayfası (yukarı kaydırınca daha eski mesajlar eklenir). */
export const MESSAGE_HISTORY_LIMIT = 50;

/** Mesaj geçmişi saklama süresi (gün). Bu süreden eski mesajlar gösterilmez ve silinir. */
export const MESSAGE_RETENTION_DAYS = 7;
export const MESSAGE_RETENTION_MS = MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function getMessageRetentionCutoffDate() {
    return new Date(Date.now() - MESSAGE_RETENTION_MS);
}

export function getMessageRetentionCutoffIso() {
    return getMessageRetentionCutoffDate().toISOString();
}

export function isWithinMessageRetention(createdAt) {
    if (!createdAt) return false;
    const ts = new Date(createdAt).getTime();
    return Number.isFinite(ts) && ts >= getMessageRetentionCutoffDate().getTime();
}
