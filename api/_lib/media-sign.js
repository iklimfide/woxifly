import crypto from 'crypto';
import { getMediaSigningSecret } from './env.js';
import { mediaProxyUrl } from './media-store.js';

const TTL_SEC = 3600;

function computeSig(r2Key, exp) {
    const secret = getMediaSigningSecret();
    if (!secret) {
        throw new Error('MEDIA_SIGNING_SECRET veya CRON_SECRET tanımlı değil.');
    }
    return crypto.createHmac('sha256', secret).update(`${r2Key}\n${exp}`).digest('base64url');
}

export function signMediaPath(r2Key) {
    const exp = Math.floor(Date.now() / 1000) + TTL_SEC;
    const sig = computeSig(r2Key, exp);
    return `${mediaProxyUrl(r2Key)}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

export function verifyMediaSignature(r2Key, exp, sig) {
    if (!r2Key || exp == null || !sig) return false;

    const expNum = Number(exp);
    if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) {
        return false;
    }

    let expected;
    try {
        expected = computeSig(r2Key, expNum);
    } catch {
        return false;
    }

    const a = Buffer.from(String(sig));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
}
