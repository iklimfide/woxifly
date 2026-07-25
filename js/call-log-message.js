const CALL_LOG_PREFIX = 'WOX_CALL:';

export function encodeCallLogBody({ outcome, initiatorId, durationSec = 0, actor = null }) {
    const payload = {
        v: 1,
        outcome,
        initiatorId,
        callerId: initiatorId,
        durationSec: Math.max(0, Math.round(Number(durationSec) || 0))
    };
    if (actor) payload.actor = actor;
    return `${CALL_LOG_PREFIX}${JSON.stringify(payload)}`;
}

export function parseCallLogBody(body) {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (!raw.startsWith(CALL_LOG_PREFIX)) return null;
    try {
        const data = JSON.parse(raw.slice(CALL_LOG_PREFIX.length));
        if (!data?.outcome || !data?.initiatorId) return null;
        return {
            outcome: String(data.outcome),
            initiatorId: String(data.initiatorId),
            durationSec: Math.max(0, Number(data.durationSec) || 0),
            actor: data.actor ? String(data.actor) : null
        };
    } catch {
        return null;
    }
}

export function formatCallDuration(seconds) {
    const sec = Math.max(1, Math.round(Number(seconds) || 0));
    if (sec < 60) return `${sec} sn`;
    const minutes = Math.floor(sec / 60);
    const rest = sec % 60;
    if (rest === 0) return `${minutes} dk`;
    return `${minutes} dk ${rest} sn`;
}

/** Görüntüleyen kullanıcıya göre sohbet içi arama satırı metni */
export function formatCallLogText(meta, viewerUserId, { messageSenderId = null } = {}) {
    if (!meta) return '';
    const callerId = meta.callerId || meta.initiatorId;
    const viewerIsCaller = Boolean(viewerUserId && callerId && callerId === viewerUserId);

    switch (meta.outcome) {
        case 'completed':
            return `Görüştünüz · ${formatCallDuration(meta.durationSec)}`;
        case 'declined':
            if (messageSenderId && viewerUserId) {
                return messageSenderId === viewerUserId ? 'Reddettiniz' : 'Reddedildi';
            }
            if (meta.actor === 'callee') {
                return viewerIsCaller ? 'Reddedildi' : 'Reddettiniz';
            }
            return viewerIsCaller ? 'Reddedildi' : 'Reddettiniz';
        case 'no_answer':
            return viewerIsCaller ? 'Cevap vermedi' : 'Cevapsız arama';
        case 'cancelled':
            return viewerIsCaller ? 'Arama iptal edildi' : 'Cevapsız arama';
        default:
            return 'Sesli arama';
    }
}

export function formatCallLogLine(body, viewerUserId, time = '', { messageSenderId = null } = {}) {
    const meta = parseCallLogBody(body);
    const label = formatCallLogText(meta, viewerUserId, { messageSenderId });
    const core = `📞\u00a0${label}`;
    const t = String(time || '').trim();
    return t ? `${core}\u00a0·\u00a0${t}` : core;
}

export function createCallLogMessageElement({
    body,
    time,
    createdAt = null,
    clientId = null,
    messageId = null,
    viewerUserId = null,
    messageSenderId = null
}) {
    const wrap = document.createElement('div');
    wrap.className = 'message-call-log';
    wrap.setAttribute('role', 'listitem');
    if (clientId) wrap.dataset.clientId = clientId;
    if (messageId) wrap.dataset.messageId = messageId;
    if (createdAt) wrap.dataset.createdAt = createdAt;

    const label = document.createElement('span');
    label.className = 'message-call-log-label';
    label.textContent = formatCallLogLine(body, viewerUserId, time, { messageSenderId });

    wrap.appendChild(label);
    return wrap;
}
