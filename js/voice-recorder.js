const MAX_RECORD_MS = 2 * 60 * 1000;

let mediaRecorder = null;
let recordChunks = [];
let recordTimer = null;
let recordStartedAt = 0;
let onStopCallback = null;
let cancelRequested = false;
let recordStream = null;
let recordAudioContext = null;

function pickMimeType() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
        'audio/aac'
    ];

    for (const type of candidates) {
        if (MediaRecorder.isTypeSupported(type)) return type;
    }

    return '';
}

export function normalizeAudioMimeType(mimeType) {
    const base = (mimeType || '').split(';')[0].trim().toLowerCase();

    if (base === 'audio/x-m4a' || base === 'audio/aac' || base === 'audio/x-aac') {
        return 'audio/mp4';
    }

    if (base.startsWith('audio/')) return base;
    return 'audio/webm';
}

export function audioExtensionForMime(mimeType) {
    const base = normalizeAudioMimeType(mimeType);
    if (base === 'audio/mp4') return 'm4a';
    if (base === 'audio/ogg') return 'ogg';
    if (base === 'audio/mpeg' || base === 'audio/mp3') return 'mp3';
    if (base === 'audio/wav') return 'wav';
    return 'webm';
}

function clearTimer() {
    if (recordTimer) {
        clearTimeout(recordTimer);
        recordTimer = null;
    }
}

function stopTracks(stream) {
    stream?.getTracks?.().forEach((track) => track.stop());
}

export function isVoiceRecordingSupported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export async function startVoiceRecording({ onMaxDuration, onError, onReady } = {}) {
    if (mediaRecorder?.state === 'recording') return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordStream = stream;
        const mimeType = pickMimeType();
        recordChunks = [];
        cancelRequested = false;

        mediaRecorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

        let analyser = null;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                recordAudioContext = new AudioCtx();
                analyser = recordAudioContext.createAnalyser();
                analyser.fftSize = 128;
                analyser.smoothingTimeConstant = 0.65;
                const source = recordAudioContext.createMediaStreamSource(stream);
                source.connect(analyser);
            }
        } catch {
            analyser = null;
        }

        mediaRecorder.ondataavailable = (event) => {
            if (event.data?.size > 0) recordChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            clearTimer();
            const mimeType = normalizeAudioMimeType(mediaRecorder.mimeType);
            const blob = cancelRequested
                ? null
                : new Blob(recordChunks, { type: mimeType });

            stopTracks(recordStream);
            recordStream = null;

            if (recordAudioContext) {
                recordAudioContext.close().catch(() => {});
                recordAudioContext = null;
            }

            mediaRecorder = null;
            recordChunks = [];

            if (!cancelRequested && onStopCallback) {
                const cb = onStopCallback;
                onStopCallback = null;
                await cb(blob);
            } else {
                onStopCallback = null;
            }

            cancelRequested = false;
        };

        mediaRecorder.onerror = () => {
            clearTimer();
            stopTracks(recordStream);
            recordStream = null;
            if (recordAudioContext) {
                recordAudioContext.close().catch(() => {});
                recordAudioContext = null;
            }
            onError?.(new Error('Kayıt hatası'));
        };

        recordStartedAt = Date.now();
        // Timeslice kullanma: kısa kayıtlarda dataavailable gelmeden stop olursa blob boş kalır.
        mediaRecorder.start();
        onReady?.({ analyser, audioContext: recordAudioContext });

        recordTimer = setTimeout(() => {
            onMaxDuration?.();
            stopVoiceRecording();
        }, MAX_RECORD_MS);
    } catch (err) {
        onError?.(err);
        throw err;
    }
}

export function cancelVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return false;
    cancelRequested = true;
    onStopCallback = null;
    mediaRecorder.stop();
    return true;
}

export function stopVoiceRecording(callback) {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return false;
    onStopCallback = callback || null;
    mediaRecorder.stop();
    return true;
}

export function isRecording() {
    return mediaRecorder?.state === 'recording';
}

export function getRecordingElapsedMs() {
    if (!isRecording()) return 0;
    return Date.now() - recordStartedAt;
}
