import { getSession } from '../supabase-client.js';
import { isValidMediaUrl, toMediaUrl } from './urls.js';

const UPLOAD_URL = '/api/upload';
const TIMEOUT_MS = 120_000;

export async function uploadFile(file, kind) {
    const session = await getSession();
    if (!session?.access_token) {
        throw new Error('Oturum gerekli');
    }

    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('file', file, file.name || `upload.${kind}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
        response = await fetch(`${UPLOAD_URL}?kind=${encodeURIComponent(kind)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
            signal: controller.signal
        });
    } catch (err) {
        if (err?.name === 'AbortError') throw new Error('Yükleme zaman aşımına uğradı.');
        throw err;
    } finally {
        clearTimeout(timer);
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('Yükleme API bulunamadı. `npm run local` ile çalıştırın.');
        }
        throw new Error(data.error || `Yükleme başarısız (${response.status})`);
    }

    const url = toMediaUrl(data.url);
    if (!url || !isValidMediaUrl(url)) {
        throw new Error('Sunucu geçersiz medya adresi döndürdü.');
    }

    return {
        url,
        r2Key: data.r2Key,
        kind: data.kind || kind
    };
}
