const OUTPUT_MIME = 'image/jpeg';

function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Görsel okunamadı.'));
        };
        img.src = url;
    });
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

export async function compressImageFile(file, {
    maxWidth = 1600,
    maxHeight = 1600,
    maxBytes = 1.5 * 1024 * 1024,
    quality = 0.85
} = {}) {
    if (!file?.type?.startsWith('image/')) return file;
    if (file.type === 'image/gif') return file;

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
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Görsel işlenemedi.');

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
