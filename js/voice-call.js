import { fetchWithAuth } from './supabase-client.js';
import { broadcastCallSignal } from './realtime-chat.js';
import { formatDisplayUsername } from './utils.js';

/** @typedef {'idle'|'calling'|'ringing'|'connected'|'incoming'} CallPhase */

let deps = null;
/** @type {CallPhase} */
let phase = 'idle';
let callId = null;
let conversationId = null;
let partnerUserId = null;
let partnerDisplayName = 'Kullanıcı';
let isCaller = false;
let pendingOffer = null;

/** @type {RTCPeerConnection|null} */
let pc = null;
/** @type {MediaStream|null} */
let localStream = null;
let remoteAudioEl = null;
let ringTimer = null;
let muted = false;
let connectedAt = null;
let callLogRecorded = false;
let remoteDescriptionSet = false;
/** @type {RTCIceCandidateInit[]} */
const pendingIceCandidates = [];
/** @type {AudioContext|null} */
let sharedCallAudioContext = null;
/** @type {number|null} */
let ringbackIntervalId = null;
/** @type {number|null} */
let incomingRingIntervalId = null;
/** @type {Notification|null} */
let incomingCallNotification = null;
let callAudioUnlockBound = false;
/** @type {MediaStreamAudioSourceNode|null} */
let remoteWebAudioSource = null;
let cachedIceServers = null;
let cachedIceServersAt = 0;
const ICE_SERVERS_CACHE_MS = 5 * 60 * 1000;

const callSessionId = (() => {
    try {
        const key = 'woxifly-call-session-id';
        let id = sessionStorage.getItem(key);
        if (!id) {
            id = crypto.randomUUID();
            sessionStorage.setItem(key, id);
        }
        return id;
    } catch {
        return crypto.randomUUID();
    }
})();

function resetIceState() {
    remoteDescriptionSet = false;
    pendingIceCandidates.length = 0;
}

function toSessionDescription(sdp) {
    if (!sdp) return null;
    if (sdp instanceof RTCSessionDescription) return sdp;
    if (typeof sdp === 'object' && sdp.type && sdp.sdp) {
        return new RTCSessionDescription(sdp);
    }
    return null;
}

async function flushPendingIceCandidates() {
    if (!pc || !remoteDescriptionSet || !pc.remoteDescription) return;
    while (pendingIceCandidates.length) {
        const init = pendingIceCandidates.shift();
        try {
            await pc.addIceCandidate(new RTCIceCandidate(init));
        } catch {
            /* stale */
        }
    }
}

async function queueOrAddIceCandidate(candidateInit) {
    if (!pc || !candidateInit) return;
    const cand =
        typeof candidateInit === 'string'
            ? { candidate: candidateInit }
            : candidateInit;
    if (!cand.candidate && !cand.sdpMid && cand.sdpMLineIndex == null) return;
    if (!remoteDescriptionSet || !pc.remoteDescription) {
        pendingIceCandidates.push(cand);
        return;
    }
    try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch {
        /* ignore stale */
    }
}

async function markRemoteDescriptionSet() {
    remoteDescriptionSet = true;
    await flushPendingIceCandidates();
}

function primeRemoteAudioPlayback() {
    if (!remoteAudioEl) return;
    remoteAudioEl.autoplay = true;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.setAttribute('playsinline', '');
    remoteAudioEl.setAttribute('webkit-playsinline', '');
    remoteAudioEl.muted = true;
    void remoteAudioEl.play()
        .then(() => {
            remoteAudioEl.pause();
            remoteAudioEl.currentTime = 0;
            remoteAudioEl.muted = false;
        })
        .catch(() => {
            remoteAudioEl.muted = false;
        });
    getSharedCallAudioContext();
}

function disconnectRemoteWebAudioRoute() {
    if (remoteWebAudioSource) {
        try {
            remoteWebAudioSource.disconnect();
        } catch {
            /* ignore */
        }
        remoteWebAudioSource = null;
    }
}

function routeRemoteViaWebAudio(stream) {
    const ctx = getSharedCallAudioContext();
    if (!ctx || !stream) return false;
    try {
        disconnectRemoteWebAudioRoute();
        remoteWebAudioSource = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 1;
        remoteWebAudioSource.connect(gain);
        gain.connect(ctx.destination);
        void ctx.resume();
        return true;
    } catch (err) {
        console.warn('[voice-call] Web Audio yönlendirmesi başarısız:', err);
        return false;
    }
}

function playRemoteAudio() {
    if (!remoteAudioEl?.srcObject) return;
    remoteAudioEl.volume = 1;
    remoteAudioEl.muted = false;
    remoteAudioEl.autoplay = true;
    remoteAudioEl.playsInline = true;
    void remoteAudioEl.play().catch((err) => {
        console.warn('[voice-call] Uzak ses (audio) oynatılamadı:', err);
        if (remoteAudioEl.srcObject) {
            const stream = remoteAudioEl.srcObject;
            remoteAudioEl.srcObject = null;
            routeRemoteViaWebAudio(stream);
        }
    });
}

function attachRemoteStream(stream) {
    if (!stream || !remoteAudioEl) return;
    remoteAudioEl.srcObject = stream;
    stopAllCallAlertSounds();
    playRemoteAudio();
}

function getSharedCallAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedCallAudioContext || sharedCallAudioContext.state === 'closed') {
        sharedCallAudioContext = new AudioCtx();
    }
    if (sharedCallAudioContext.state === 'suspended') {
        void sharedCallAudioContext.resume();
    }
    return sharedCallAudioContext;
}

function bindCallAudioUnlock() {
    if (callAudioUnlockBound) return;
    callAudioUnlockBound = true;
    const unlock = () => {
        getSharedCallAudioContext();
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
}

function stopRingbackTone() {
    if (ringbackIntervalId != null) {
        window.clearInterval(ringbackIntervalId);
        ringbackIntervalId = null;
    }
}

function stopIncomingRingtone() {
    if (incomingRingIntervalId != null) {
        window.clearInterval(incomingRingIntervalId);
        incomingRingIntervalId = null;
    }
}

function closeIncomingCallNotification() {
    try {
        incomingCallNotification?.close();
    } catch {
        /* ignore */
    }
    incomingCallNotification = null;
}

function stopAllCallAlertSounds() {
    stopRingbackTone();
    stopIncomingRingtone();
    closeIncomingCallNotification();
}

function playDualToneBurst(ctx, masterGain, t0, freqA, freqB, duration) {
    const tone = (freq, start, len) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t0 + start);
        g.gain.linearRampToValueAtTime(1, t0 + start + 0.02);
        g.gain.setValueAtTime(1, t0 + start + len - 0.02);
        g.gain.linearRampToValueAtTime(0, t0 + start + len);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(t0 + start);
        osc.stop(t0 + start + len + 0.01);
    };
    tone(freqA, 0, duration);
    tone(freqB, 0, duration);
}

function startRingbackTone() {
    if (!isCaller || phase === 'connected') return;
    stopRingbackTone();
    const ctx = getSharedCallAudioContext();
    if (!ctx) return;

    try {
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.06;
        masterGain.connect(ctx.destination);

        const playRingbackBurst = () => {
            if (!sharedCallAudioContext || sharedCallAudioContext.state === 'closed') return;
            void sharedCallAudioContext.resume();
            playDualToneBurst(sharedCallAudioContext, masterGain, sharedCallAudioContext.currentTime, 440, 480, 0.9);
        };

        playRingbackBurst();
        ringbackIntervalId = window.setInterval(playRingbackBurst, 2800);
    } catch (err) {
        console.warn('[voice-call] Arama sesi başlatılamadı:', err);
        stopRingbackTone();
    }
}

function startIncomingRingtone() {
    if (isCaller || phase !== 'incoming') return;
    stopIncomingRingtone();
    const ctx = getSharedCallAudioContext();
    if (!ctx) return;

    try {
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0.12;
        masterGain.connect(ctx.destination);

        let ringStep = 0;
        const playIncomingBurst = () => {
            if (!sharedCallAudioContext || sharedCallAudioContext.state === 'closed') return;
            if (phase !== 'incoming') return;
            void sharedCallAudioContext.resume();
            const t0 = sharedCallAudioContext.currentTime;
            if (ringStep % 2 === 0) {
                playDualToneBurst(sharedCallAudioContext, masterGain, t0, 440, 480, 0.45);
            } else {
                playDualToneBurst(sharedCallAudioContext, masterGain, t0, 520, 580, 0.45);
            }
            ringStep += 1;
        };

        playIncomingBurst();
        incomingRingIntervalId = window.setInterval(playIncomingBurst, 1200);
    } catch (err) {
        console.warn('[voice-call] Gelen arama sesi başlatılamadı:', err);
        stopIncomingRingtone();
    }
}

function canShowIncomingCallNotification() {
    if (typeof deps?.isIncomingCallNotifyEnabled === 'function') {
        return deps.isIncomingCallNotifyEnabled();
    }
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function showIncomingCallNotification(fromName) {
    if (!canShowIncomingCallNotification()) return;
    if (!callId) return;

    const label = partnerLabel(fromName);
    const viewingIncomingChat =
        !document.hidden
        && document.hasFocus()
        && deps?.getConversationId?.() === conversationId
        && phase === 'incoming';

    try {
        closeIncomingCallNotification();
        if (viewingIncomingChat) return;

        incomingCallNotification = new Notification('Sesli arama', {
            body: `${label} sizi arıyor`,
            icon: '/icons/icon-192.png',
            tag: `woxifly-call-${callId}`,
            renotify: true,
            requireInteraction: true,
            silent: false
        });
        incomingCallNotification.onclick = () => {
            window.focus();
            closeIncomingCallNotification();
        };
    } catch {
        /* ignore */
    }
}

function bindIceCandidateHandler(connection) {
    connection.onicecandidate = (event) => {
        if (!event.candidate || !callId || !conversationId) return;
        void sendSignal({
            type: 'ice',
            candidate: event.candidate.toJSON()
        });
    };
}

function el(id) {
    return document.getElementById(id);
}

function setPhase(next) {
    if (next === 'connected' && phase !== 'connected') {
        connectedAt = Date.now();
        stopAllCallAlertSounds();
    }
    if (next !== 'incoming' && phase === 'incoming') {
        stopIncomingRingtone();
        closeIncomingCallNotification();
    }
    if (next !== 'calling' && phase === 'calling') {
        stopRingbackTone();
    }
    phase = next;
    syncCallUi();
}

function postCallLog(outcome, { durationSec = 0, actor = null } = {}) {
    if (callLogRecorded || !conversationId || !deps?.recordCallLog) return;
    const initiatorId = isCaller ? deps.getUserId() : partnerUserId;
    if (!initiatorId) return;
    callLogRecorded = true;
    void deps.recordCallLog({
        conversationId,
        outcome,
        initiatorId,
        durationSec,
        actor
    });
}

function clearRingTimer() {
    if (ringTimer) {
        window.clearTimeout(ringTimer);
        ringTimer = null;
    }
}

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.cloudflare.com:3478' }];

function parseJsonResponse(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

async function fetchIceServers() {
    const now = Date.now();
    if (cachedIceServers && now - cachedIceServersAt < ICE_SERVERS_CACHE_MS) {
        return cachedIceServers;
    }

    let res;
    try {
        res = await fetchWithAuth('/api/turn-credentials');
    } catch {
        throw new Error('Oturum gerekli.');
    }

    const text = await res.text();
    const data = parseJsonResponse(text);

    if (!data) {
        console.warn('[voice-call] /api/turn-credentials JSON değil:', res.status, text.slice(0, 120));
        deps?.showToast?.(
            res.status === 404
                ? 'TURN API bulunamadı. Yerel geliştirmede sunucuyu yeniden başlatın veya deploy edin.'
                : 'TURN yanıtı okunamadı; yalnızca STUN kullanılıyor.',
            { type: 'warning' }
        );
        return DEFAULT_ICE_SERVERS;
    }

    if (!res.ok) {
        if (res.status === 401) {
            deps?.showToast?.(
                'Oturum sunucuda doğrulanamadı; arama STUN ile deneniyor. Sorun sürerse çıkış yapıp tekrar girin veya Vercel SUPABASE anahtarlarını kontrol edin.',
                { type: 'warning' }
            );
            return DEFAULT_ICE_SERVERS;
        }
        if (res.status >= 500) {
            deps?.showToast?.(data.error || 'TURN geçici olarak kullanılamıyor; STUN deneniyor.', {
                type: 'warning'
            });
            return data.iceServers?.length ? data.iceServers : DEFAULT_ICE_SERVERS;
        }
        deps?.showToast?.(data.error || 'TURN alınamadı; STUN kullanılıyor.', { type: 'warning' });
        return DEFAULT_ICE_SERVERS;
    }

    const servers = data.iceServers?.length ? data.iceServers : DEFAULT_ICE_SERVERS;
    cachedIceServers = servers;
    cachedIceServersAt = Date.now();
    return servers;
}

async function createPeerConnection() {
    resetIceState();
    const iceServers = await fetchIceServers();
    const connection = new RTCPeerConnection({
        iceServers,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
    });

    connection.ontrack = (event) => {
        const stream = event.streams?.[0] ?? (event.track ? new MediaStream([event.track]) : null);
        if (stream) attachRemoteStream(stream);
        if (event.track) {
            event.track.onunmute = () => playRemoteAudio();
        }
    };

    connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === 'connected') {
            setPhase('connected');
            clearRingTimer();
            void playRemoteAudio();
        } else if (state === 'failed') {
            deps?.showToast?.('Bağlantı kurulamadı.', { type: 'warning' });
            void teardownCall({ notifyRemote: true, reason: 'hangup' });
        } else if (state === 'disconnected') {
            deps?.showToast?.('Bağlantı koptu.', { type: 'warning' });
            void teardownCall({ notifyRemote: true, reason: 'hangup' });
        }
    };

    connection.oniceconnectionstatechange = () => {
        if (connection.iceConnectionState === 'connected' || connection.iceConnectionState === 'completed') {
            void playRemoteAudio();
        }
    };

    return connection;
}

async function ensureLocalAudio() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: false
    });
    return localStream;
}

function attachLocalTracks(connection) {
    if (!localStream) return;
    for (const track of localStream.getTracks()) {
        const already = connection.getSenders().some((s) => s.track?.id === track.id);
        if (!already) {
            connection.addTrack(track, localStream);
        }
    }
}

async function sendSignal(extra) {
    if (!callId || !conversationId || !deps?.getUserId?.()) return false;
    const payload = {
        call_id: callId,
        conversation_id: conversationId,
        from_user_id: deps.getUserId(),
        session_id: callSessionId,
        ...extra
    };
    return broadcastCallSignal(payload);
}

function partnerLabel(name) {
    return formatDisplayUsername(name || 'Kullanıcı');
}

function syncCallUi() {
    const overlay = el('voiceCallOverlay');
    const incoming = el('voiceCallIncoming');
    const active = el('voiceCallActive');
    const status = el('voiceCallStatus');
    const nameEl = el('voiceCallPartnerName');
    const callBtn = el('topbarCallBtn');
    const muteBtn = el('voiceCallMuteBtn');
    const inCallBar = el('voiceCallInCallBar');
    const inBarName = el('voiceCallInBarName');
    const inBarStatus = el('voiceCallInBarStatus');
    const inBarMute = el('voiceCallInBarMuteBtn');
    const inBarEnd = el('voiceCallInBarEndBtn');

    const busy = phase !== 'idle';
    const inCall = phase === 'connected';
    const showOverlay = busy && !inCall;
    const partner = partnerLabel(partnerDisplayName);
    const statusText = inCall
        ? (muted ? 'Sessiz · görüşmede' : 'Görüşmede')
        : '';

    if (overlay) overlay.hidden = !showOverlay;
    if (incoming) incoming.hidden = phase !== 'incoming';
    if (active) active.hidden = phase === 'idle' || phase === 'incoming';

    if (inCallBar) inCallBar.hidden = !inCall;
    if (inBarName) inBarName.textContent = partner;
    if (inBarStatus) inBarStatus.textContent = statusText;
    if (inBarMute) {
        inBarMute.hidden = !inCall;
        inBarMute.textContent = muted ? 'Sesi aç' : 'Sessiz';
    }
    if (inBarEnd) inBarEnd.hidden = !inCall;

    if (nameEl) nameEl.textContent = partner;

    if (status) {
        if (phase === 'calling') status.textContent = 'Aranıyor…';
        else if (phase === 'ringing') status.textContent = 'Bağlanıyor…';
        else if (phase === 'connected') status.textContent = statusText;
        else if (phase === 'incoming') status.textContent = 'Gelen sesli arama';
        else status.textContent = '';
    }

    if (callBtn) {
        callBtn.classList.toggle('app-topbar__icon-btn--active', inCall || phase === 'calling');
        callBtn.disabled = busy && !inCall && phase !== 'calling';
        callBtn.setAttribute('aria-label', inCall ? 'Aramayı kapat' : 'Sesli ara');
        if (inCall) callBtn.hidden = false;
    }

    if (muteBtn) {
        muteBtn.hidden = phase !== 'connected' && phase !== 'ringing';
        muteBtn.textContent = muted ? 'Sesi aç' : 'Sessiz';
    }

    document.body.classList.toggle('voice-call-active', showOverlay);
    document.body.classList.toggle('voice-call-connected', inCall);
    if (inCall) void playRemoteAudio();
}

export function isVoiceCallSupported() {
    return !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
}

export function isVoiceCallBusy() {
    return phase !== 'idle';
}

export function onVoiceCallConversationContext({ conversationId: convId, partnerUserId: partnerId, partnerName } = {}) {
    conversationId = convId || null;
    partnerUserId = partnerId || null;
    if (partnerName) partnerDisplayName = partnerName;
    syncCallUi();
}

export function clearVoiceCallConversationContext() {
    if (phase === 'idle') {
        conversationId = null;
        partnerUserId = null;
    }
}

export function updateTopbarCallButtonVisibility(visible) {
    const callBtn = el('topbarCallBtn');
    if (!callBtn) return;
    const show = visible && isVoiceCallSupported() && deps?.isLoggedIn?.();
    callBtn.hidden = !show;
}

async function teardownCall({ notifyRemote = false, reason = 'hangup' } = {}) {
    clearRingTimer();
    stopAllCallAlertSounds();
    pendingOffer = null;
    resetIceState();

    const endPhase = phase;
    const endIsCaller = isCaller;
    const endConnectedAt = connectedAt;
    const endConversationId = conversationId;
    const endPartnerUserId = partnerUserId;
    const endUserId = deps?.getUserId?.();

    if (notifyRemote && callId && conversationId && phase !== 'idle') {
        await sendSignal({ type: reason }).catch(() => {});
    }

    if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
        pc = null;
    }

    if (localStream) {
        for (const track of localStream.getTracks()) track.stop();
        localStream = null;
    }

    if (remoteAudioEl) {
        remoteAudioEl.pause();
        remoteAudioEl.srcObject = null;
    }
    disconnectRemoteWebAudioRoute();

    callId = null;
    isCaller = false;
    muted = false;
    connectedAt = null;
    setPhase('idle');

    if (!callLogRecorded && endConversationId && deps?.recordCallLog && notifyRemote) {
        if (endConnectedAt && endUserId) {
            const durationSec = Math.max(1, Math.round((Date.now() - endConnectedAt) / 1000));
            callLogRecorded = true;
            void deps.recordCallLog({
                conversationId: endConversationId,
                outcome: 'completed',
                initiatorId: endIsCaller ? endUserId : endPartnerUserId,
                durationSec
            });
        } else if (endIsCaller && endPhase === 'calling' && endUserId) {
            callLogRecorded = true;
            void deps.recordCallLog({
                conversationId: endConversationId,
                outcome: 'cancelled',
                initiatorId: endUserId
            });
        }
    }

    callLogRecorded = false;
}

function rejectIncoming() {
    if (phase !== 'incoming' || !callId) {
        void teardownCall({ notifyRemote: false });
        return;
    }
    postCallLog('declined', { actor: 'callee' });
    const overlay = el('voiceCallOverlay');
    const incoming = el('voiceCallIncoming');
    if (incoming) incoming.hidden = true;
    if (overlay) overlay.hidden = true;
    document.body.classList.remove('voice-call-active');
    void sendSignal({ type: 'decline' }).finally(() => {
        void teardownCall({ notifyRemote: false });
    });
}

async function acceptIncoming() {
    if (phase !== 'incoming' || !pendingOffer) return;
    stopIncomingRingtone();
    closeIncomingCallNotification();
    primeRemoteAudioPlayback();

    try {
        await sendSignal({ type: 'call_claimed' }).catch(() => {});
        await ensureLocalAudio();
        setPhase('ringing');
        pc = await createPeerConnection();
        attachLocalTracks(pc);
        bindIceCandidateHandler(pc);
        const offerSdp = toSessionDescription(pendingOffer);
        if (!offerSdp) throw new Error('Geçersiz arama teklifi.');
        await pc.setRemoteDescription(offerSdp);
        await markRemoteDescriptionSet();
        pendingOffer = null;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({
            type: 'answer',
            sdp: pc.localDescription
        });
        playRemoteAudio();
    } catch (err) {
        deps?.showToast?.(err instanceof Error ? err.message : 'Arama kabul edilemedi.', { type: 'error' });
        await sendSignal({ type: 'decline' }).catch(() => {});
        await teardownCall({ notifyRemote: false });
    }
}

async function recordDeclinedCallLog(conversationId, callerUserId) {
    if (!conversationId || !callerUserId || !deps?.recordCallLog) return;
    await deps.recordCallLog({
        conversationId,
        outcome: 'declined',
        initiatorId: callerUserId,
        actor: 'callee'
    });
}

async function handleInvite(payload) {
    if (phase !== 'idle') {
        void recordDeclinedCallLog(payload.conversation_id, payload.from_user_id);
        void broadcastCallSignal({
            call_id: payload.call_id,
            conversation_id: payload.conversation_id,
            from_user_id: deps.getUserId(),
            type: 'decline'
        });
        return;
    }

    if (deps?.isPartnerBlocked?.(payload.from_user_id)) {
        void recordDeclinedCallLog(payload.conversation_id, payload.from_user_id);
        void broadcastCallSignal({
            call_id: payload.call_id,
            conversation_id: payload.conversation_id,
            from_user_id: deps.getUserId(),
            type: 'decline'
        });
        return;
    }

    callId = payload.call_id;
    conversationId = payload.conversation_id;
    partnerUserId = payload.from_user_id;
    partnerDisplayName = payload.from_name || partnerDisplayName;
    pendingOffer = payload.sdp || null;
    isCaller = false;

    const convId = payload.conversation_id;
    const activeConv = deps?.getConversationId?.();
    if (convId && activeConv !== convId && deps?.openConversationForCall) {
        await deps.openConversationForCall({
            conversationId: convId,
            partnerUserId: payload.from_user_id,
            partnerName: payload.from_name
        });
    }

    setPhase('incoming');
    void fetchIceServers().catch(() => {});
    startIncomingRingtone();
    showIncomingCallNotification(partnerDisplayName);

    if (navigator.vibrate) {
        try { navigator.vibrate([120, 80, 120]); } catch { /* ignore */ }
    }
}

async function handleAnswer(payload) {
    if (!isCaller || (phase !== 'calling' && phase !== 'ringing')) return;
    if (!pc || payload.call_id !== callId || !payload.sdp) return;

    try {
        const answerSdp = toSessionDescription(payload.sdp);
        if (!answerSdp) throw new Error('Geçersiz yanıt');
        await pc.setRemoteDescription(answerSdp);
        await markRemoteDescriptionSet();
        setPhase('ringing');
        clearRingTimer();
        stopRingbackTone();
        playRemoteAudio();
    } catch {
        deps?.showToast?.('Arama yanıtı işlenemedi.', { type: 'error' });
        await teardownCall({ notifyRemote: true, reason: 'hangup' });
    }
}

async function handleIce(payload) {
    if (!pc || payload.call_id !== callId || !payload.candidate) return;
    await queueOrAddIceCandidate(payload.candidate);
}

async function dismissCallOnOtherDevice(payload) {
    if (payload.call_id !== callId) return;
    if (phase === 'idle') return;
    await teardownCall({ notifyRemote: false });
}

export async function handleVoiceCallSignal(payload) {
    if (!payload?.call_id || !payload?.type || !payload?.from_user_id) return;

    const myId = deps?.getUserId?.();
    const fromSelf = Boolean(myId && payload.from_user_id === myId);
    const sameSession = Boolean(payload.session_id && payload.session_id === callSessionId);

    if (fromSelf && sameSession) return;

    if (fromSelf && !sameSession) {
        switch (payload.type) {
            case 'decline':
            case 'hangup':
            case 'call_claimed':
            case 'answer':
            case 'no_answer':
                await dismissCallOnOtherDevice(payload);
                break;
            default:
                break;
        }
        return;
    }

    switch (payload.type) {
        case 'invite':
            if (!payload.sdp) return;
            await handleInvite(payload);
            break;
        case 'answer':
            await handleAnswer(payload);
            break;
        case 'ice':
            await handleIce(payload);
            break;
        case 'decline':
            if (payload.call_id !== callId) return;
            await teardownCall({ notifyRemote: false });
            break;
        case 'no_answer':
            if (payload.call_id !== callId) return;
            await teardownCall({ notifyRemote: false });
            break;
        case 'hangup':
            if (payload.call_id !== callId) return;
            await teardownCall({ notifyRemote: false });
            break;
        default:
            break;
    }
}

export async function startVoiceCall() {
    if (!isVoiceCallSupported()) {
        deps?.showToast?.('Tarayıcı sesli aramayı desteklemiyor.', { type: 'warning' });
        return;
    }

    if (phase !== 'idle') {
        if (phase === 'connected') {
            await endVoiceCall();
        }
        return;
    }

    const convId = deps?.getConversationId?.();
    const partnerId = deps?.getPartnerUserId?.();
    if (!convId || !partnerId) {
        deps?.showToast?.('Önce bir sohbet açın.', { type: 'warning' });
        return;
    }

    if (deps?.isPartnerBlocked?.(partnerId)) {
        deps?.showToast?.('Engellenen kullanıcıyı arayamazsınız.', { type: 'warning' });
        return;
    }

    partnerDisplayName = deps?.getPartnerDisplayName?.() || partnerDisplayName;
    conversationId = convId;
    partnerUserId = partnerId;
    callId = crypto.randomUUID();
    isCaller = true;
    callLogRecorded = false;
    connectedAt = null;

    try {
        setPhase('calling');
        startRingbackTone();
        primeRemoteAudioPlayback();
        await ensureLocalAudio();
        pc = await createPeerConnection();
        attachLocalTracks(pc);
        bindIceCandidateHandler(pc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sent = await sendSignal({
            type: 'invite',
            sdp: pc.localDescription,
            from_name: deps?.getMyUsername?.() || ''
        });

        if (!sent) {
            throw new Error('Arama sinyali gönderilemedi.');
        }

        ringTimer = window.setTimeout(() => {
            if (phase !== 'calling') return;
            void (async () => {
                postCallLog('no_answer');
                await sendSignal({ type: 'no_answer' }).catch(() => {});
                await teardownCall({ notifyRemote: false });
            })();
        }, 45000);
    } catch (err) {
        deps?.showToast?.(err instanceof Error ? err.message : 'Arama başlatılamadı.', { type: 'error' });
        await teardownCall({ notifyRemote: true, reason: 'hangup' });
    }
}

export async function endVoiceCall() {
    await teardownCall({ notifyRemote: true, reason: 'hangup' });
}

function toggleMute() {
    if (!localStream || phase !== 'connected') return;
    muted = !muted;
    for (const track of localStream.getAudioTracks()) {
        track.enabled = !muted;
    }
    syncCallUi();
}

export function initVoiceCall(options) {
    deps = options;
    bindCallAudioUnlock();
    remoteAudioEl = el('voiceCallRemoteAudio');
    if (remoteAudioEl) {
        remoteAudioEl.autoplay = true;
        remoteAudioEl.playsInline = true;
        remoteAudioEl.setAttribute('playsinline', '');
        remoteAudioEl.setAttribute('webkit-playsinline', '');
    }

    el('voiceCallAcceptBtn')?.addEventListener('pointerdown', () => {
        if (phase === 'incoming') primeRemoteAudioPlayback();
    }, { passive: true });
    el('voiceCallAcceptBtn')?.addEventListener('click', () => void acceptIncoming());
    el('voiceCallDeclineBtn')?.addEventListener('click', () => rejectIncoming());
    el('voiceCallEndBtn')?.addEventListener('click', () => void endVoiceCall());
    el('voiceCallMuteBtn')?.addEventListener('click', () => toggleMute());
    el('voiceCallInBarEndBtn')?.addEventListener('click', () => void endVoiceCall());
    el('voiceCallInBarMuteBtn')?.addEventListener('click', () => toggleMute());

    el('topbarCallBtn')?.addEventListener('click', () => {
        if (phase === 'connected') {
            void endVoiceCall();
            return;
        }
        void startVoiceCall();
    });

    syncCallUi();
    void fetchIceServers().catch(() => {});
}
