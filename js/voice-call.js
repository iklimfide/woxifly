import { fetchWithAuth, getAccessTokenForApi } from './supabase-client.js';
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
/** ICE aday toplama (invite/answer gönderimi öncesi). */
const ICE_GATHERING_TIMEOUT_MS = 12000;
/** connectionState 'failed' sonrası erken kapanmayı önlemek için bekleme (TURN relay). */
const ICE_FAILED_GRACE_MS = 12000;

function isVoiceCallDebugEnabled() {
    try {
        if (localStorage.getItem('woxifly-voice-call-debug') === '1') return true;
    } catch {
        /* ignore */
    }
    const host = typeof location !== 'undefined' ? location.hostname : '';
    return host === 'localhost' || host === '127.0.0.1';
}

function voiceCallDebugLog(...args) {
    if (isVoiceCallDebugEnabled()) console.log(...args);
}

function isMobileVoiceClient() {
    return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '');
}

function logSignalingFlow(role, step, detail = {}) {
    console.log(`[voice-call][signaling][${role}] ${step}`, detail);
}

function describeIceCandidateInit(candidateInit) {
    const line = typeof candidateInit === 'string'
        ? candidateInit
        : (candidateInit?.candidate || '');
    let kind = 'unknown';
    if (/ typ relay /i.test(line)) kind = 'relay';
    else if (/ typ srflx /i.test(line)) kind = 'srflx';
    else if (/ typ host /i.test(line)) kind = 'host';
    return {
        kind,
        sdpMid: candidateInit?.sdpMid,
        sdpMLineIndex: candidateInit?.sdpMLineIndex,
        preview: line ? line.slice(0, 96) : ''
    };
}

function logIceSignaling(role, step, candidateInit, extra = {}) {
    const desc = describeIceCandidateInit(candidateInit);
    if (desc.kind !== 'relay' && !isVoiceCallDebugEnabled()) return;
    logSignalingFlow(role, step, { ...desc, ...extra });
}

function auditIceServers(servers) {
    const summary = {
        serverCount: servers.length,
        turnUrlCount: 0,
        stunUrlCount: 0,
        turnWithCredentials: 0,
        turnMissingCredentials: 0
    };
    for (const entry of servers) {
        const urls = Array.isArray(entry.urls) ? entry.urls : [entry.urls].filter(Boolean);
        let entryHasTurn = false;
        for (const raw of urls) {
            const u = String(raw).toLowerCase();
            if (u.startsWith('turn:') || u.startsWith('turns:')) summary.turnUrlCount += 1;
            if (u.startsWith('stun:')) summary.stunUrlCount += 1;
            if (u.startsWith('turn:') || u.startsWith('turns:')) entryHasTurn = true;
        }
        if (entryHasTurn) {
            if (entry.username && entry.credential) summary.turnWithCredentials += 1;
            else summary.turnMissingCredentials += 1;
        }
    }
    return summary;
}

let pcConnectionFailedTimer = null;
let outboundIceReleased = false;
/** @type {{ type: string; candidate?: RTCIceCandidateInit }[]} */
const pendingOutboundIceSignals = [];
/** ICE trickle gönderimini sıraya al (mobilde paralel flood Realtime’ı bozabiliyor). */
let outboundSignalChain = Promise.resolve();

function resetOutboundIceGate() {
    outboundIceReleased = false;
    pendingOutboundIceSignals.length = 0;
}

function releaseOutboundIceGate() {
    if (outboundIceReleased) return;
    outboundIceReleased = true;
    const queue = pendingOutboundIceSignals.splice(0);
    for (const extra of queue) {
        void enqueueOutboundSignal(extra);
    }
}

function enqueueOutboundSignal(extra) {
    outboundSignalChain = outboundSignalChain
        .then(() => sendSignal(extra))
        .catch(() => false);
    return outboundSignalChain;
}

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

/** Karşı tarafın ICE adayları (PC oluşmadan / remote SDP gelmeden). */
const prePcIceCandidates = [];
/** Invite gelmeden önce gelen ICE (call_id ile). */
const preInviteIceByCallId = new Map();

function resetIceState() {
    remoteDescriptionSet = false;
    pendingIceCandidates.length = 0;
    prePcIceCandidates.length = 0;
}

function stashPreInviteIce(callIdKey, candidate) {
    if (!callIdKey || !candidate) return;
    let list = preInviteIceByCallId.get(callIdKey);
    if (!list) {
        list = [];
        preInviteIceByCallId.set(callIdKey, list);
    }
    list.push(candidate);
}

function takePreInviteIce(callIdKey) {
    const list = preInviteIceByCallId.get(callIdKey);
    if (!list?.length) return;
    preInviteIceByCallId.delete(callIdKey);
    prePcIceCandidates.push(...list);
}

function toSessionDescription(sdp) {
    if (!sdp) return null;
    if (sdp instanceof RTCSessionDescription) return sdp;
    if (typeof sdp === 'object' && sdp.type && sdp.sdp) {
        return new RTCSessionDescription(sdp);
    }
    return null;
}

/** Realtime broadcast için düz JSON (mobil RTCSessionDescription serileştirme). */
function serializeSessionDescription(desc) {
    if (!desc) return null;
    const type = desc.type;
    const sdp = desc.sdp;
    if (type && sdp) return { type, sdp };
    return null;
}

function mapSignalTypeToLabel(type) {
    switch (type) {
        case 'invite':
            return 'call-offer';
        case 'answer':
            return 'call-answer';
        case 'ice':
            return 'ice-candidate';
        default:
            return type || 'unknown';
    }
}

function logCallBroadcast(direction, type, detail = {}) {
    if (type === 'ice' && !isVoiceCallDebugEnabled()) return;
    const label = mapSignalTypeToLabel(type);
    voiceCallDebugLog(`[voice-call] ${direction} broadcast ${label}`, detail);
}

function clearConnectionFailedTimer() {
    if (pcConnectionFailedTimer != null) {
        window.clearTimeout(pcConnectionFailedTimer);
        pcConnectionFailedTimer = null;
    }
}

function micErrorMessage(err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return 'Mikrofon izni reddedildi.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return 'Mikrofon bulunamadı.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Mikrofon başka bir uygulama tarafından kullanılıyor olabilir.';
    }
    return err instanceof Error ? err.message : 'Mikrofon açılamadı.';
}

async function flushPendingIceCandidates() {
    if (!pc || !remoteDescriptionSet || !pc.remoteDescription) return;
    const total = pendingIceCandidates.length;
    if (total > 0) {
        voiceCallDebugLog(`[voice-call] ice-candidate: kuyruktan ${total} aday flush ediliyor`);
    }
    let ok = 0;
    let fail = 0;
    while (pendingIceCandidates.length) {
        const init = pendingIceCandidates.shift();
        try {
            await pc.addIceCandidate(new RTCIceCandidate(init));
            ok += 1;
            voiceCallDebugLog('[voice-call] ice-candidate: addIceCandidate OK', {
                n: ok,
                sdpMid: init.sdpMid,
                sdpMLineIndex: init.sdpMLineIndex
            });
        } catch (err) {
            fail += 1;
            console.warn('[voice-call] ice-candidate: addIceCandidate hata', err, init);
        }
    }
    if (total > 0) {
        voiceCallDebugLog('[voice-call] ice-candidate: flush bitti', { ok, fail });
        logSignalingFlow(isCaller ? 'caller' : 'callee', 'ICE kuyruk flush bitti', { ok, fail, total });
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
        logIceSignaling(isCaller ? 'caller' : 'callee', 'ICE kuyruğa alındı (remote SDP henüz yok)', cand, {
            queueLength: pendingIceCandidates.length
        });
        return;
    }
    try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
        logIceSignaling(isCaller ? 'caller' : 'callee', 'addIceCandidate uygulandı', cand);
    } catch (err) {
        console.warn('[voice-call] ice-candidate: addIceCandidate (anında) hata', err, cand);
    }
}

async function markRemoteDescriptionSet() {
    const role = isCaller ? 'caller' : 'callee';
    remoteDescriptionSet = true;
    const preCount = prePcIceCandidates.length;
    while (prePcIceCandidates.length) {
        pendingIceCandidates.push(prePcIceCandidates.shift());
    }
    const pendingTotal = pendingIceCandidates.length;
    if (preCount > 0) {
        voiceCallDebugLog('[voice-call] ice-candidate: prePc kuyruğundan pending\'e taşındı', { preCount });
    }
    logSignalingFlow(role, 'setRemoteDescription tamam — bekleyen ICE flush', {
        prePcMerged: preCount,
        pendingQueue: pendingTotal
    });
    await flushPendingIceCandidates();
}

function waitForIceGathering(connection, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (connection.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        const finish = () => {
            connection.removeEventListener('icegatheringstatechange', onChange);
            window.clearTimeout(timer);
            resolve();
        };
        const onChange = () => {
            if (connection.iceGatheringState === 'complete') finish();
        };
        connection.addEventListener('icegatheringstatechange', onChange);
        const timer = window.setTimeout(finish, timeoutMs);
    });
}

const MOBILE_INVITE_ICE_WAIT_MS = 6000;

function waitForRelayIceCandidate(connection, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (found) => {
            if (settled) return;
            settled = true;
            connection.removeEventListener('icecandidate', onIce);
            window.clearTimeout(timer);
            resolve(found);
        };
        const onIce = (event) => {
            const line = event.candidate?.candidate || '';
            if (/ typ relay /i.test(line)) finish(true);
        };
        connection.addEventListener('icecandidate', onIce);
        const timer = window.setTimeout(() => finish(false), timeoutMs);
        if (connection.iceGatheringState === 'complete') {
            window.setTimeout(() => finish(false), 0);
        }
    });
}

/** Mobil arayan: TURN relay adayı veya toplama bitene kadar kısa bekle (farklı ağda PC’nin bağlanması için). */
async function waitForCallerInviteSdpReady(connection) {
    if (!isMobileVoiceClient()) return;
    const sawRelay = await waitForRelayIceCandidate(connection, MOBILE_INVITE_ICE_WAIT_MS);
    if (!sawRelay) {
        await waitForIceGathering(connection, MOBILE_INVITE_ICE_WAIT_MS);
    }
    logSignalingFlow('caller', 'Mobil invite öncesi ICE bekleme bitti', {
        sawRelay,
        gatheringState: connection.iceGatheringState
    });
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
        const extra = {
            type: 'ice',
            candidate: event.candidate.toJSON()
        };
        if (!outboundIceReleased) {
            pendingOutboundIceSignals.push(extra);
            return;
        }
        void enqueueOutboundSignal(extra);
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

async function fetchIceServers({ forActiveCall = false } = {}) {
    const now = Date.now();
    if (cachedIceServers && now - cachedIceServersAt < ICE_SERVERS_CACHE_MS) {
        return cachedIceServers;
    }

    let token = await getAccessTokenForApi();
    if (!token) {
        token = await getAccessTokenForApi({ forceRefresh: true });
    }
    if (!token) {
        const loggedIn = deps?.isLoggedIn?.() === true;
        if (forActiveCall || loggedIn) {
            console.warn('[voice-call] Oturum token yok; TURN atlanıyor, STUN kullanılıyor.');
        }
        return DEFAULT_ICE_SERVERS;
    }

    let res;
    try {
        res = await fetchWithAuth('/api/turn-credentials');
    } catch (err) {
        console.warn('[voice-call] turn-credentials isteği başarısız (STUN):', err);
        return DEFAULT_ICE_SERVERS;
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
    const audit = auditIceServers(servers);
    if (forActiveCall) {
        logSignalingFlow('peer', 'iceServers yüklendi (iceTransportPolicy: all — varsayılan)', audit);
        if (audit.turnMissingCredentials > 0 || audit.turnUrlCount === 0) {
            console.warn('[voice-call] TURN eksik veya kimlik bilgisi yok:', audit);
        }
    }
    cachedIceServers = servers;
    cachedIceServersAt = Date.now();
    if (forActiveCall && data.turnConfigured !== true) {
        deps?.showToast?.(
            'Ses köprüsü (TURN) yok; farklı ağlarda bağlantı kurulamayabilir. Vercel Cloudflare TURN anahtarlarını kontrol edin.',
            { type: 'warning' }
        );
    }
    return servers;
}

async function createPeerConnection() {
    resetIceState();
    const iceServers = await fetchIceServers({ forActiveCall: true });
    let iceRestartAttempted = false;
    // iceTransportPolicy belirtilmez → tarayıcı varsayılanı 'all' (host/srflx/relay).
    const connection = new RTCPeerConnection({
        iceServers,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        ...(isMobileVoiceClient() ? { iceCandidatePoolSize: 4 } : {})
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
        voiceCallDebugLog('[voice-call] connectionState', {
            connectionState: state,
            iceConnectionState: connection.iceConnectionState,
            callId,
            role: isCaller ? 'caller' : 'callee'
        });
        if (state === 'connected') {
            clearConnectionFailedTimer();
            setPhase('connected');
            clearRingTimer();
            void playRemoteAudio();
        } else if (state === 'failed') {
            console.error('[voice-call] connectionState failed; teardown için grace ms:', ICE_FAILED_GRACE_MS);
            clearConnectionFailedTimer();
            pcConnectionFailedTimer = window.setTimeout(() => {
                pcConnectionFailedTimer = null;
                if (connection.connectionState === 'connected' || phase === 'idle') return;
                deps?.showToast?.('Bağlantı kurulamadı.', { type: 'warning' });
                void teardownCall({ notifyRemote: true, reason: 'hangup' });
            }, ICE_FAILED_GRACE_MS);
        } else if (state === 'disconnected') {
            deps?.showToast?.('Bağlantı koptu.', { type: 'warning' });
            void teardownCall({ notifyRemote: true, reason: 'hangup' });
        }
    };

    connection.oniceconnectionstatechange = () => {
        const ice = connection.iceConnectionState;
        voiceCallDebugLog('[voice-call] iceConnectionState', {
            iceConnectionState: ice,
            connectionState: connection.connectionState,
            iceGatheringState: connection.iceGatheringState,
            signalingState: connection.signalingState,
            callId,
            role: isCaller ? 'caller' : 'callee'
        });
        if (ice === 'failed' || ice === 'disconnected') {
            console.error('[voice-call] ICE bağlantı sorunu', {
                iceConnectionState: ice,
                connectionState: connection.connectionState
            });
            if (ice === 'failed' && !iceRestartAttempted && typeof connection.restartIce === 'function') {
                iceRestartAttempted = true;
                voiceCallDebugLog('[voice-call] restartIce deneniyor');
                try {
                    connection.restartIce();
                } catch (err) {
                    console.warn('[voice-call] restartIce başarısız:', err);
                }
            }
        }
        if (ice === 'connected' || ice === 'completed') {
            clearConnectionFailedTimer();
            if (phase === 'ringing' || phase === 'calling') {
                setPhase('connected');
            }
            void playRemoteAudio();
        }
    };

    return connection;
}

async function ensureLocalAudio() {
    if (localStream) return localStream;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
        return localStream;
    } catch (err) {
        console.error('[voice-call] getUserMedia başarısız:', err);
        throw err;
    }
}

/** Aranan taraf: gelen call-offer SDP'sini remote description olarak uygular. */
async function handleOffer(connection, offerInit) {
    const offerSdp = toSessionDescription(offerInit);
    if (!offerSdp) {
        console.error('[voice-call] call-offer: geçersiz SDP');
        throw new Error('Geçersiz arama teklifi.');
    }
    logCallBroadcast('↳', 'invite', { action: 'setRemoteDescription başlıyor', sdpType: offerSdp.type });
    await connection.setRemoteDescription(offerSdp);
    if (!connection.remoteDescription || connection.remoteDescription.type !== 'offer') {
        console.error('[voice-call] call-offer: setRemoteDescription sonrası doğrulama başarısız', {
            remoteType: connection.remoteDescription?.type
        });
        throw new Error('Uzak teklif uygulanamadı.');
    }
    voiceCallDebugLog('[voice-call] call-offer: setRemoteDescription başarılı');
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
    const signalExtra = { ...extra };
    if (signalExtra.sdp) {
        signalExtra.sdp = serializeSessionDescription(signalExtra.sdp) || signalExtra.sdp;
    }
    const payload = {
        call_id: callId,
        conversation_id: conversationId,
        from_user_id: deps.getUserId(),
        session_id: callSessionId,
        ...signalExtra
    };
    logCallBroadcast('→', extra?.type, {
        call_id: callId,
        conversation_id: conversationId
    });
    if (extra?.type === 'answer') {
        logSignalingFlow(isCaller ? 'caller' : 'callee', '→ Supabase broadcast call-answer gönderiliyor', {
            call_id: callId,
            sdpType: extra.sdp?.type,
            sdpBytes: extra.sdp?.sdp?.length ?? 0
        });
    }
    if (extra?.type === 'ice' && extra.candidate) {
        logIceSignaling(isCaller ? 'caller' : 'callee', '→ Supabase broadcast ice-candidate', extra.candidate, {
            call_id: callId
        });
    }
    if (deps?.ensureCallBroadcastReady) {
        await deps.ensureCallBroadcastReady(conversationId).catch(() => false);
    }
    const sent = await broadcastCallSignal(payload);
    if (!sent && (extra?.type === 'answer' || extra?.type === 'invite')) {
        console.error('[voice-call] Kritik arama sinyali iletilemedi:', extra?.type, conversationId);
        deps?.showToast?.('Arama sinyali karşı tarafa ulaşamadı. Ağı kontrol edip tekrar deneyin.', { type: 'warning' });
    }
    if (extra?.type === 'answer') {
        logSignalingFlow(isCaller ? 'caller' : 'callee', '→ Supabase broadcast call-answer sonucu', { delivered: sent });
    }
    voiceCallDebugLog(`[voice-call] → broadcast ${mapSignalTypeToLabel(extra?.type)} gönderildi:`, sent);
    return sent;
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
        let line = '';
        if (phase === 'calling') line = 'Aranıyor…';
        else if (phase === 'ringing') line = isCaller ? 'Görüşme kuruluyor…' : '';
        else if (phase === 'connected') line = statusText;
        else if (phase === 'incoming') line = 'Gelen sesli arama';
        status.textContent = line;
        status.hidden = !line;
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
    clearConnectionFailedTimer();
    resetOutboundIceGate();
    preInviteIceByCallId.clear();
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
        resetOutboundIceGate();

        try {
            await ensureLocalAudio();
        } catch (micErr) {
            const msg = micErrorMessage(micErr);
            console.error('[voice-call] Kabul: mikrofon alınamadı — arama sonlandırılıyor:', micErr);
            deps?.showToast?.(msg, { type: 'error' });
            await sendSignal({ type: 'decline' }).catch(() => {});
            await teardownCall({ notifyRemote: false });
            return;
        }

        setPhase('ringing');
        pc = await createPeerConnection();
        bindIceCandidateHandler(pc);

        const offerPayload = pendingOffer;
        await handleOffer(pc, offerPayload);

        try {
            attachLocalTracks(pc);
        } catch (trackErr) {
            console.error('[voice-call] Kabul: yerel track eklenemedi — arama sonlandırılıyor:', trackErr);
            deps?.showToast?.('Mikrofon akışı bağlanamadı.', { type: 'error' });
            await sendSignal({ type: 'decline' }).catch(() => {});
            await teardownCall({ notifyRemote: false });
            return;
        }

        await markRemoteDescriptionSet();
        pendingOffer = null;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        logSignalingFlow('callee', 'call-answer SDP oluşturuldu (setLocalDescription)', {
            type: pc.localDescription?.type,
            sdpBytes: pc.localDescription?.sdp?.length ?? 0
        });
        const answerSent = await sendSignal({
            type: 'answer',
            sdp: pc.localDescription
        });
        logSignalingFlow('callee', 'Kabul Et: call-answer + ICE trickle yayını başlatıldı', {
            broadcastDelivered: answerSent
        });
        releaseOutboundIceGate();
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
    takePreInviteIce(callId);

    // Önce UI + zil; sohbet açılışı arka planda (openChat mesaj geçmişi yükleyebilir).
    setPhase('incoming');
    startIncomingRingtone();
    showIncomingCallNotification(partnerDisplayName);

    if (navigator.vibrate) {
        try { navigator.vibrate([120, 80, 120]); } catch { /* ignore */ }
    }

    if (deps?.isLoggedIn?.()) {
        void fetchIceServers({ forActiveCall: true }).catch(() => {});
    }

    const convId = payload.conversation_id;
    if (convId && deps?.ensureCallBroadcastReady) {
        void deps.ensureCallBroadcastReady(convId).catch(() => {});
    }
    const activeConv = deps?.getConversationId?.();
    if (convId && activeConv !== convId && deps?.openConversationForCall) {
        void deps.openConversationForCall({
            conversationId: convId,
            partnerUserId: payload.from_user_id,
            partnerName: payload.from_name
        }).catch((err) => {
            console.warn('[voice-call] Gelen arama: sohbet arka planda açılamadı:', err);
        });
    }
}

async function handleAnswer(payload) {
    if (!isCaller || (phase !== 'calling' && phase !== 'ringing')) return;
    if (!pc || payload.call_id !== callId || !payload.sdp) return;

    try {
        const answerSdp = toSessionDescription(payload.sdp);
        if (!answerSdp) throw new Error('Geçersiz yanıt');
        logSignalingFlow('caller', '← Supabase call-answer alındı', {
            call_id: payload.call_id,
            sdpType: answerSdp.type,
            sdpBytes: answerSdp.sdp?.length ?? 0
        });
        logCallBroadcast('←', 'answer', { call_id: payload.call_id, action: 'setRemoteDescription başlıyor' });
        await pc.setRemoteDescription(answerSdp);
        if (!pc.remoteDescription || pc.remoteDescription.type !== 'answer') {
            console.error('[voice-call] call-answer: setRemoteDescription sonrası doğrulama başarısız', {
                remoteType: pc.remoteDescription?.type
            });
            throw new Error('Uzak yanıt uygulanamadı.');
        }
        logSignalingFlow('caller', 'setRemoteDescription(call-answer) başarılı');
        voiceCallDebugLog('[voice-call] call-answer: setRemoteDescription başarılı');
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
    if (payload.call_id !== callId || !payload.candidate) return;
    const role = isCaller ? 'caller' : 'callee';
    logIceSignaling(role, '← Supabase ice-candidate alındı', payload.candidate, {
        call_id: payload.call_id,
        hasPc: Boolean(pc),
        remoteDescriptionSet
    });
    logCallBroadcast('←', 'ice', {
        call_id: payload.call_id,
        buffered: !pc || !remoteDescriptionSet,
        phase
    });
    if (!pc) {
        if (phase === 'incoming' || phase === 'ringing' || phase === 'calling') {
            prePcIceCandidates.push(payload.candidate);
            logIceSignaling(role, 'ICE prePc kuyruğuna alındı (PC yok)', payload.candidate, {
                prePcCount: prePcIceCandidates.length
            });
        }
        return;
    }
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
            logCallBroadcast('←', 'invite', { call_id: payload.call_id, from: payload.from_user_id });
            await handleInvite(payload);
            break;
        case 'answer':
            logCallBroadcast('←', 'answer', { call_id: payload.call_id, from: payload.from_user_id });
            await handleAnswer(payload);
            break;
        case 'ice':
            if (phase === 'idle' && payload.call_id && payload.candidate) {
                stashPreInviteIce(payload.call_id, payload.candidate);
                voiceCallDebugLog('[voice-call] ice-candidate: invite öncesi saklandı', payload.call_id);
                break;
            }
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
        resetOutboundIceGate();
        if (deps?.ensureCallBroadcastReady) {
            await deps.ensureCallBroadcastReady(convId).catch(() => false);
        }
        void fetchIceServers({ forActiveCall: true }).catch(() => {});
        await ensureLocalAudio();
        pc = await createPeerConnection();
        attachLocalTracks(pc);
        bindIceCandidateHandler(pc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForCallerInviteSdpReady(pc);

        const sent = await sendSignal({
            type: 'invite',
            sdp: pc.localDescription,
            from_name: deps?.getMyUsername?.() || ''
        });

        if (!sent) {
            throw new Error('Arama sinyali gönderilemedi.');
        }

        releaseOutboundIceGate();

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
    if (deps?.isLoggedIn?.()) {
        void fetchIceServers().catch(() => {});
    }
}
