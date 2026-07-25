import { getSession } from './supabase-client.js';
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

function el(id) {
    return document.getElementById(id);
}

function setPhase(next) {
    phase = next;
    syncCallUi();
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
    const session = await getSession();
    if (!session?.access_token) {
        throw new Error('Oturum gerekli.');
    }

    const res = await fetch('/api/turn-credentials', {
        headers: { Authorization: `Bearer ${session.access_token}` }
    });
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
        if (res.status >= 500) {
            deps?.showToast?.(data.error || 'TURN geçici olarak kullanılamıyor; STUN deneniyor.', {
                type: 'warning'
            });
            return data.iceServers?.length ? data.iceServers : DEFAULT_ICE_SERVERS;
        }
        throw new Error(data.error || 'TURN bilgisi alınamadı.');
    }

    return data.iceServers?.length ? data.iceServers : DEFAULT_ICE_SERVERS;
}

async function createPeerConnection() {
    const iceServers = await fetchIceServers();
    const connection = new RTCPeerConnection({ iceServers });

    connection.onicecandidate = (event) => {
        if (!event.candidate || !callId || !conversationId) return;
        void sendSignal({
            type: 'ice',
            candidate: event.candidate.toJSON()
        });
    };

    connection.ontrack = (event) => {
        const stream = event.streams?.[0];
        if (!stream || !remoteAudioEl) return;
        remoteAudioEl.srcObject = stream;
        void remoteAudioEl.play().catch(() => {});
    };

    connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === 'connected') {
            setPhase('connected');
            clearRingTimer();
        } else if (state === 'failed') {
            deps?.showToast?.('Bağlantı kurulamadı.', { type: 'warning' });
            void teardownCall({ notifyRemote: true, reason: 'hangup' });
        } else if (state === 'disconnected') {
            deps?.showToast?.('Bağlantı koptu.', { type: 'warning' });
            void teardownCall({ notifyRemote: true, reason: 'hangup' });
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
        connection.addTrack(track, localStream);
    }
}

async function sendSignal(extra) {
    if (!callId || !conversationId || !deps?.getUserId?.()) return false;
    const payload = {
        call_id: callId,
        conversation_id: conversationId,
        from_user_id: deps.getUserId(),
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

    const busy = phase !== 'idle';
    if (overlay) overlay.hidden = !busy;
    if (incoming) incoming.hidden = phase !== 'incoming';
    if (active) active.hidden = phase !== 'calling' && phase !== 'ringing' && phase !== 'connected';

    if (nameEl) nameEl.textContent = partnerLabel(partnerDisplayName);

    if (status) {
        if (phase === 'calling') status.textContent = 'Aranıyor…';
        else if (phase === 'ringing') status.textContent = 'Bağlanıyor…';
        else if (phase === 'connected') status.textContent = muted ? 'Sessiz · görüşmede' : 'Görüşmede';
        else if (phase === 'incoming') status.textContent = 'Gelen sesli arama';
        else status.textContent = '';
    }

    if (callBtn) {
        callBtn.classList.toggle('app-topbar__icon-btn--active', phase === 'connected' || phase === 'calling');
        callBtn.disabled = busy && phase !== 'connected' && phase !== 'calling';
        callBtn.setAttribute('aria-label', phase === 'connected' ? 'Aramayı kapat' : 'Sesli ara');
    }

    if (muteBtn) {
        muteBtn.hidden = phase !== 'connected';
        muteBtn.textContent = muted ? 'Sesi aç' : 'Sessiz';
    }

    document.body.classList.toggle('voice-call-active', busy);
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
    pendingOffer = null;

    if (notifyRemote && callId && conversationId && phase !== 'idle') {
        await sendSignal({ type: reason }).catch(() => {});
    }

    if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
        pc = null;
    }

    if (localStream) {
        for (const track of localStream.getTracks()) track.stop();
        localStream = null;
    }

    if (remoteAudioEl) {
        remoteAudioEl.srcObject = null;
    }

    callId = null;
    isCaller = false;
    muted = false;
    setPhase('idle');
}

function rejectIncoming() {
    if (phase !== 'incoming' || !callId) {
        void teardownCall({ notifyRemote: false });
        return;
    }
    void sendSignal({ type: 'decline' }).finally(() => {
        void teardownCall({ notifyRemote: false });
    });
}

async function acceptIncoming() {
    if (phase !== 'incoming' || !pendingOffer) return;

    try {
        setPhase('ringing');
        pc = await createPeerConnection();
        await ensureLocalAudio();
        attachLocalTracks(pc);
        await pc.setRemoteDescription(pendingOffer);
        pendingOffer = null;
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({
            type: 'answer',
            sdp: pc.localDescription
        });
    } catch (err) {
        deps?.showToast?.(err instanceof Error ? err.message : 'Arama kabul edilemedi.', { type: 'error' });
        await sendSignal({ type: 'decline' }).catch(() => {});
        await teardownCall({ notifyRemote: false });
    }
}

async function handleInvite(payload) {
    if (phase !== 'idle') {
        void broadcastCallSignal({
            call_id: payload.call_id,
            conversation_id: payload.conversation_id,
            from_user_id: deps.getUserId(),
            type: 'decline'
        });
        return;
    }

    if (deps?.isPartnerBlocked?.(payload.from_user_id)) {
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

    if (navigator.vibrate) {
        try { navigator.vibrate([120, 80, 120]); } catch { /* ignore */ }
    }
}

async function handleAnswer(payload) {
    if (!isCaller || (phase !== 'calling' && phase !== 'ringing')) return;
    if (!pc || payload.call_id !== callId || !payload.sdp) return;

    try {
        await pc.setRemoteDescription(payload.sdp);
        setPhase('ringing');
        clearRingTimer();
    } catch {
        deps?.showToast?.('Arama yanıtı işlenemedi.', { type: 'error' });
        await teardownCall({ notifyRemote: true, reason: 'hangup' });
    }
}

async function handleIce(payload) {
    if (!pc || payload.call_id !== callId || !payload.candidate) return;
    try {
        await pc.addIceCandidate(payload.candidate);
    } catch {
        /* ignore stale */
    }
}

export async function handleVoiceCallSignal(payload) {
    if (!payload?.call_id || !payload?.type || !payload?.from_user_id) return;
    if (payload.from_user_id === deps?.getUserId?.()) return;

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
            if (isCaller) deps?.showToast?.('Arama reddedildi.', { type: 'info' });
            await teardownCall({ notifyRemote: false });
            break;
        case 'hangup':
            if (payload.call_id !== callId) return;
            if (phase === 'connected' || phase === 'incoming' || phase === 'calling') {
                deps?.showToast?.('Görüşme sonlandı.', { type: 'info' });
            }
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

    try {
        setPhase('calling');
        pc = await createPeerConnection();
        await ensureLocalAudio();
        attachLocalTracks(pc);

        const offer = await pc.createOffer({ offerToReceiveAudio: true });
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
            if (phase === 'calling') {
                deps?.showToast?.('Cevap yok.', { type: 'info' });
                void teardownCall({ notifyRemote: true, reason: 'hangup' });
            }
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
    remoteAudioEl = el('voiceCallRemoteAudio');

    el('voiceCallAcceptBtn')?.addEventListener('click', () => void acceptIncoming());
    el('voiceCallDeclineBtn')?.addEventListener('click', () => rejectIncoming());
    el('voiceCallEndBtn')?.addEventListener('click', () => void endVoiceCall());
    el('voiceCallMuteBtn')?.addEventListener('click', () => toggleMute());

    el('topbarCallBtn')?.addEventListener('click', () => {
        if (phase === 'connected') {
            void endVoiceCall();
            return;
        }
        void startVoiceCall();
    });

    syncCallUi();
}
