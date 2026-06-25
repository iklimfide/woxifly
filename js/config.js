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

/** Profil kaydı için varsayılan konum (UI'da gösterilmez). */
export const DEFAULT_LOCATION = 'İstanbul Anadolu';

const DEFAULT_COORDS = { lat: 40.981857142857145, lon: 29.186857142857146 };

export function getLocationCoords() {
    return DEFAULT_COORDS;
}

/** Tek seferde yüklenen mesaj sayfası (yukarı kaydırınca daha eski mesajlar eklenir). */
export const MESSAGE_HISTORY_LIMIT = 50;
