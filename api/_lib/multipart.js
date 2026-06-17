const MAX_BODY_BYTES = 52 * 1024 * 1024;

export function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error('İstek gövdesi çok büyük.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

export function parseMultipart(buffer, boundary) {
    let cleanBoundary = boundary.trim();
    if (cleanBoundary.startsWith('"') && cleanBoundary.endsWith('"')) {
        cleanBoundary = cleanBoundary.slice(1, -1);
    }

    const delimiter = Buffer.from(`--${cleanBoundary}`);
    const parts = [];
    let start = buffer.indexOf(delimiter);

    while (start !== -1) {
        const next = buffer.indexOf(delimiter, start + delimiter.length);
        if (next === -1) break;

        let partBuffer = buffer.subarray(start + delimiter.length, next);
        if (partBuffer.length === 0) {
            start = next;
            continue;
        }

        if (partBuffer[0] === 0x0d && partBuffer[1] === 0x0a) {
            partBuffer = partBuffer.subarray(2);
        }

        if (partBuffer.length < 2) {
            start = next;
            continue;
        }

        const headerEnd = partBuffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
            start = next;
            continue;
        }

        const headerText = partBuffer.subarray(0, headerEnd).toString('utf8');
        let data = partBuffer.subarray(headerEnd + 4);

        if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
            data = data.subarray(0, data.length - 2);
        }

        const nameMatch = headerText.match(/name="([^"]+)"/i)
            || headerText.match(/name='([^']+)'/i)
            || headerText.match(/name=([^\s;]+)/i);
        const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

        parts.push({
            name: nameMatch?.[1] || '',
            contentType: contentTypeMatch?.[1] || 'application/octet-stream',
            data
        });

        start = next;
    }

    return parts;
}
