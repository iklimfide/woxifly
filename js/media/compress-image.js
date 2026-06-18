const OUTPUT_MIME = 'image/jpeg';

async function loadImageFromFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();

    try {
        img.src = url;
        if (img.decode) {
            await img.decode();
        } else {
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = () => reject(new Error('Görsel okunamadı.'));
            });
        }

        if (!img.naturalWidth || !img.naturalHeight) {
            throw new Error('Görsel okunamadı.');
        }

        return img;
    } catch (err) {
        if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(file);
            try {
                if (!bitmap.width || !bitmap.height) {
                    throw new Error('Görsel okunamadı.');
                }

                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Görsel işlenemedi.');
                ctx.drawImage(bitmap, 0, 0);

                const fallback = new Image();
                fallback.src = canvas.toDataURL('image/png');
                if (fallback.decode) {
                    await fallback.decode();
                } else {
                    await new Promise((resolve, reject) => {
                        fallback.onload = resolve;
                        fallback.onerror = () => reject(new Error('Görsel okunamadı.'));
                    });
                }
                return fallback;
            } finally {
                bitmap.close?.();
            }
        }
        throw err;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Görsel sıkıştırılamadı.'));
        }, mime, quality);
    });
}

function fitDimensions(width, height, maxWidth, maxHeight) {
    if (width <= maxWidth && height <= maxHeight) {
        return { width, height };
    }
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio))
    };
}

function shouldSkipCompression(file, maxBytes) {
    if (!file?.type?.startsWith('image/')) return true;
    if (file.type === 'image/gif') return true;
    // Ekran görüntüsü yapıştırmaları: canvas JPEG dönüşümü bazen siyah kare üretir.
    if (file.type === 'image/png' && file.size <= maxBytes) return true;
    return false;
}

export async function compressImageFile(file, {
    maxWidth = 1600,
    maxHeight = 1600,
    maxBytes = 1.5 * 1024 * 1024,
    quality = 0.85
} = {}) {
    if (shouldSkipCompression(file, maxBytes)) return file;

    const img = await loadImageFromFile(file);
    const { width, height } = fitDimensions(
        img.naturalWidth,
        img.naturalHeight,
        maxWidth,
        maxHeight
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('Görsel işlenemedi.');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let q = quality;
    let blob = await canvasToBlob(canvas, OUTPUT_MIME, q);

    while (blob.size > maxBytes && q > 0.5) {
        q -= 0.08;
        blob = await canvasToBlob(canvas, OUTPUT_MIME, q);
    }

    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: OUTPUT_MIME });
}

export function compressImageForChat(file) {
    return compressImageFile(file, {
        maxWidth: 1600,
        maxHeight: 1600,
        maxBytes: 1.5 * 1024 * 1024,
        quality: 0.85
    });
}

export function compressImageForAvatar(file) {
    return compressImageFile(file, {
        maxWidth: 512,
        maxHeight: 512,
        maxBytes: 800 * 1024,
        quality: 0.82
    });
}
