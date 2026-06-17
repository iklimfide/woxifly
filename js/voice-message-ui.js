const BAR_COUNT = 36;
const liveWaveformBars = [];

function hashSeed(value) {
    let hash = 0;
    const str = String(value || 'voice');
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) || 1;
}

export function formatVoiceDuration(totalSeconds) {
    const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function seededHeights(count, seed) {
    let state = hashSeed(seed);
    const heights = [];
    for (let i = 0; i < count; i += 1) {
        state = (state * 16807) % 2147483647;
        heights.push(0.22 + ((state % 1000) / 1000) * 0.78);
    }
    return heights;
}

function createWaveformElement({ heights, className = 'voice-waveform', interactive = false }) {
    const wrap = document.createElement('div');
    wrap.className = className;
    wrap.setAttribute('role', interactive ? 'slider' : 'presentation');
    if (interactive) {
        wrap.setAttribute('aria-label', 'Oynatma konumu');
        wrap.tabIndex = 0;
    }

    heights.forEach((height, index) => {
        const bar = document.createElement('span');
        bar.className = 'voice-waveform-bar';
        bar.style.setProperty('--bar-height', `${Math.round(height * 100)}%`);
        bar.dataset.index = String(index);
        wrap.appendChild(bar);
    });

    return wrap;
}

function setWaveformProgress(waveformEl, progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    const activeCount = Math.round(clamped * BAR_COUNT);
    waveformEl.querySelectorAll('.voice-waveform-bar').forEach((bar, index) => {
        bar.classList.toggle('is-active', index < activeCount);
    });
}

function svgPlayIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
}

function svgPauseIcon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
}

let recordingTimerId = null;
let recordingAnimId = null;
let recordingAnalyser = null;
let recordingAudioContext = null;

function ensureLiveBars(container) {
    if (liveWaveformBars.length) return;
    container.replaceChildren();
    for (let i = 0; i < BAR_COUNT; i += 1) {
        const bar = document.createElement('span');
        bar.className = 'voice-waveform-bar voice-waveform-bar--live';
        bar.style.setProperty('--bar-height', '28%');
        container.appendChild(bar);
        liveWaveformBars.push(bar);
    }
}

function updateLiveBars(analyser) {
    if (!analyser || !liveWaveformBars.length) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const step = Math.max(1, Math.floor(data.length / BAR_COUNT));

    liveWaveformBars.forEach((bar, index) => {
        const value = data[Math.min(data.length - 1, index * step)] || 0;
        const height = 18 + (value / 255) * 72;
        bar.style.setProperty('--bar-height', `${height}%`);
    });
}

export function showVoiceRecordingPanel() {
    const area = document.getElementById('messageInputArea');
    const panel = document.getElementById('voiceRecordingPanel');
    if (!area || !panel) return;

    area.classList.add('is-recording');
    panel.hidden = false;

    const timeEl = document.getElementById('voiceRecordingTime');
    const waveformEl = document.getElementById('voiceRecordingWaveform');
    if (timeEl) timeEl.textContent = '0:00';
    if (waveformEl) ensureLiveBars(waveformEl);
}

export function hideVoiceRecordingPanel() {
    const area = document.getElementById('messageInputArea');
    const panel = document.getElementById('voiceRecordingPanel');
    if (!area || !panel) return;

    area.classList.remove('is-recording');
    panel.hidden = true;
}

export function startRecordingUi({ getElapsedMs, analyser, audioContext }) {
    stopRecordingUi();
    recordingAnalyser = analyser || null;
    recordingAudioContext = audioContext || null;

    const tickTime = () => {
        const timeEl = document.getElementById('voiceRecordingTime');
        if (timeEl) timeEl.textContent = formatVoiceDuration((getElapsedMs?.() || 0) / 1000);
    };

    tickTime();
    recordingTimerId = window.setInterval(tickTime, 200);

    const animate = () => {
        updateLiveBars(recordingAnalyser);
        recordingAnimId = requestAnimationFrame(animate);
    };
    animate();
}

export function stopRecordingUi() {
    if (recordingTimerId) {
        clearInterval(recordingTimerId);
        recordingTimerId = null;
    }
    if (recordingAnimId) {
        cancelAnimationFrame(recordingAnimId);
        recordingAnimId = null;
    }

    recordingAnalyser = null;
    if (recordingAudioContext) {
        recordingAudioContext.close().catch(() => {});
        recordingAudioContext = null;
    }
}

export function createVoiceMessagePlayer({ src, state = 'ready', seed = src }) {
    const root = document.createElement('div');
    root.className = 'voice-message';
    root.dataset.voiceState = state;

    if (state === 'pending' && !src) {
        root.classList.add('voice-message--pending');
        const playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'voice-message-play';
        playBtn.disabled = true;
        playBtn.innerHTML = svgPlayIcon();

        const body = document.createElement('div');
        body.className = 'voice-message-body';
        body.appendChild(createWaveformElement({
            heights: seededHeights(BAR_COUNT, seed),
            className: 'voice-waveform voice-waveform--static'
        }));

        const time = document.createElement('span');
        time.className = 'voice-message-time';
        time.textContent = '…';

        root.append(playBtn, body, time);
        return root;
    }

    if (state === 'failed') {
        root.classList.add('voice-message--failed');
        root.innerHTML = '<span class="voice-message-error">Ses gönderilemedi</span>';
        return root;
    }

    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = src || '';
    audio.hidden = true;

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'voice-message-play';
    playBtn.setAttribute('aria-label', 'Oynat');
    playBtn.innerHTML = svgPlayIcon();
    if (state === 'pending') {
        root.classList.add('voice-message--pending');
        playBtn.disabled = false;
    }

    const body = document.createElement('div');
    body.className = 'voice-message-body';

    const waveform = createWaveformElement({
        heights: seededHeights(BAR_COUNT, seed),
        className: 'voice-waveform voice-waveform--static',
        interactive: true
    });
    body.appendChild(waveform);

    const time = document.createElement('span');
    time.className = 'voice-message-time';
    time.textContent = '0:00';

    root.append(playBtn, body, time, audio);

    let duration = 0;

    const updateTimeLabel = () => {
        if (!duration) {
            time.textContent = '0:00';
            return;
        }
        const remaining = Math.max(0, duration - audio.currentTime);
        time.textContent = audio.paused
            ? formatVoiceDuration(duration)
            : formatVoiceDuration(remaining);
    };

    const updateProgress = () => {
        const progress = duration > 0 ? audio.currentTime / duration : 0;
        setWaveformProgress(waveform, progress);
        updateTimeLabel();
    };

    const setPlaying = (playing) => {
        playBtn.classList.toggle('is-playing', playing);
        playBtn.setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
        playBtn.innerHTML = playing ? svgPauseIcon() : svgPlayIcon();
    };

    const seekTo = (clientX) => {
        if (!duration) return;
        const rect = waveform.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        audio.currentTime = ratio * duration;
        updateProgress();
    };

    playBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!audio.src) return;

        if (audio.paused) {
            document.querySelectorAll('.voice-message audio').forEach((other) => {
                if (other !== audio && !other.paused) {
                    other.pause();
                    other.dispatchEvent(new Event('pause'));
                }
            });
            audio.play().catch(() => {});
        } else {
            audio.pause();
        }
    });

    waveform.addEventListener('click', (event) => {
        event.stopPropagation();
        seekTo(event.clientX);
    });

    waveform.addEventListener('keydown', (event) => {
        if (!duration) return;
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            audio.currentTime = Math.min(duration, audio.currentTime + 1);
            updateProgress();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            audio.currentTime = Math.max(0, audio.currentTime - 1);
            updateProgress();
        }
    });

    audio.addEventListener('loadedmetadata', () => {
        duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        updateProgress();
    });

    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('ended', () => {
        setPlaying(false);
        audio.currentTime = 0;
        updateProgress();
    });
    audio.addEventListener('play', () => setPlaying(true));
    audio.addEventListener('pause', () => setPlaying(false));

    root.addEventListener('click', (event) => event.stopPropagation());

    return root;
}
