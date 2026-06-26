import { openLink } from './link-viewer.js';
import { resolveMessageMediaUrl, isMediaKind } from './media/urls.js';
import { createMediaHost } from './media/render.js';

function fillReactionPill(pill, emoji, count) {
    pill.replaceChildren();
    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'message-reaction-emoji';
    emojiSpan.textContent = emoji;
    const countSpan = document.createElement('span');
    countSpan.className = 'message-reaction-count';
    countSpan.textContent = String(count);
    pill.append(emojiSpan, countSpan);
}

export function sanitizeText(value, maxLength = 2000) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim()
        .slice(0, maxLength);
}

export function isValidUsername(username) {
    return /^[\p{L}\p{N}_.-]{2,24}$/u.test(username);
}

export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function getCalendarDayKey(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Sohbet ortası tarih etiketi — yalnızca bugün için "Bugün", diğerleri tarih. */
export function formatMessageDateLabel(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    if (getCalendarDayKey(dateString) === getCalendarDayKey(now.toISOString())) {
        return 'Bugün';
    }

    if (date.getFullYear() === now.getFullYear()) {
        return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    }

    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function createMessageDateSeparator(dateString) {
    const wrap = document.createElement('div');
    wrap.className = 'message-date-separator';
    wrap.dataset.dayKey = getCalendarDayKey(dateString);
    wrap.setAttribute('role', 'separator');
    wrap.setAttribute('aria-label', formatMessageDateLabel(dateString));

    const label = document.createElement('span');
    label.className = 'message-date-separator-label';
    label.textContent = formatMessageDateLabel(dateString);
    wrap.appendChild(label);

    return wrap;
}

export function appendMessageToContainer(container, messageEl, createdAt) {
    const dayKey = getCalendarDayKey(createdAt);
    const lastMessage = container.querySelector('.message:last-of-type');

    if (dayKey && (!lastMessage || lastMessage.dataset.dayKey !== dayKey)) {
        container.appendChild(createMessageDateSeparator(createdAt));
    }

    if (dayKey) messageEl.dataset.dayKey = dayKey;
    container.appendChild(messageEl);
    return messageEl;
}

export function formatQuotePreview(quote) {
    const contentType = quote?.content_type || quote?.contentType || 'text';
    if (contentType === 'image') return '📷 Görsel';
    if (contentType === 'video') return '🎬 Video';
    if (contentType === 'audio') return '🎙️ Ses';
    const body = quote?.body || '';
    if (!body) return 'Mesaj';
    const shortened = shortenUrlsInPlainText(body);
    return shortened.length > 120 ? `${shortened.slice(0, 120)}…` : shortened;
}

export function isQuoteFromViewer(quote, { userId = null, username = null } = {}) {
    if (!quote) return false;

    const senderName = (quote.sender_name || quote.sender || '').replace(/^@/, '');
    const senderId = quote.sender_id || quote.senderId || null;

    if (senderName === 'Ben') return true;
    if (userId && senderId && senderId === userId) return true;
    if (username && senderName && senderName.toLowerCase() === username.toLowerCase()) return true;

    return false;
}

export function formatQuoteAuthorLabel(quote, viewer = {}) {
    const senderName = quote?.sender_name || quote?.sender || 'Kullanıcı';
    if (isQuoteFromViewer(quote, viewer)) return 'Ben';
    return senderName.startsWith('@') ? senderName : `@${senderName}`;
}

const URL_REGEX = /\b((?:https?:\/\/)[^\s<]+|(?:www\.)[^\s<]+|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?::\d{1,5})?(?:\/[^\s<]*)?)/gi;

function trimTrailingUrlPunctuation(url) {
    return url.replace(/[.,;:!?)}\]]+$/g, '');
}

function formatUrlDisplayLabel(href, rawUrl) {
    const cleaned = trimTrailingUrlPunctuation(rawUrl);

    try {
        const parsed = new URL(href);
        const tail = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        const shouldShorten = cleaned.length > 48 || (tail.length > 1 && tail !== '/');
        if (!shouldShorten) return cleaned;
        return `${parsed.origin}/......`;
    } catch {
        if (cleaned.length <= 48) return cleaned;
        const schemeEnd = cleaned.indexOf('//');
        const pathStart = schemeEnd === -1 ? cleaned.indexOf('/') : cleaned.indexOf('/', schemeEnd + 2);
        if (pathStart === -1) return `${cleaned.slice(0, 40)}......`;
        return `${cleaned.slice(0, pathStart)}/......`;
    }
}

function shortenUrlsInPlainText(text) {
    if (!text) return text;
    URL_REGEX.lastIndex = 0;
    return text.replace(URL_REGEX, (rawUrl, offset) => {
        if (isEmailContext(text, offset)) return rawUrl;
        const href = toSafeHref(rawUrl);
        if (!href) return rawUrl;
        return formatUrlDisplayLabel(href, rawUrl);
    });
}

function toSafeHref(rawUrl) {
    const cleaned = trimTrailingUrlPunctuation(rawUrl);
    const href = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

    try {
        const parsed = new URL(href);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        if (!parsed.hostname.includes('.')) return null;
        return parsed.href;
    } catch {
        return null;
    }
}

export { toSafeHref };

function isEmailContext(text, index) {
    return index > 0 && text[index - 1] === '@';
}

export function appendTextWithLinks(parent, text) {
    parent.textContent = '';
    if (!text) return;

    let lastIndex = 0;
    URL_REGEX.lastIndex = 0;

    for (const match of text.matchAll(URL_REGEX)) {
        const rawUrl = match[0];
        const index = match.index ?? 0;

        if (isEmailContext(text, index)) continue;

        const href = toSafeHref(rawUrl);

        if (index > lastIndex) {
            parent.appendChild(document.createTextNode(text.slice(lastIndex, index)));
        }

        if (href) {
            const displayUrl = formatUrlDisplayLabel(href, rawUrl);
            const link = document.createElement('a');
            link.className = 'message-link';
            link.href = href;
            link.textContent = displayUrl;
            link.title = trimTrailingUrlPunctuation(rawUrl);
            link.addEventListener('click', (event) => {
                event.preventDefault();
                openLink(href);
            });
            parent.appendChild(link);
        } else {
            parent.appendChild(document.createTextNode(rawUrl));
        }

        lastIndex = index + rawUrl.length;
    }

    if (lastIndex < text.length) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    if (!parent.childNodes.length) {
        parent.textContent = text;
    }
}

function createMessageActionsToggle() {
    const rail = document.createElement('div');
    rail.className = 'message-side-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'message-side-btn message-side-toggle';
    toggleBtn.title = 'Mesaj seçenekleri';
    toggleBtn.setAttribute('aria-label', 'Mesaj seçenekleri');
    toggleBtn.setAttribute('aria-haspopup', 'menu');
    toggleBtn.textContent = '⋯';
    rail.appendChild(toggleBtn);

    return rail;
}

function appendReactionsBar(wrapper, reactions) {
    if (!reactions?.length) return;

    const bar = document.createElement('div');
    bar.className = 'message-reactions';

    for (const item of reactions) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `message-reaction-pill${item.mine ? ' mine' : ''}`;
        pill.dataset.emoji = item.emoji;
        pill.title = `${item.count} tepki`;
        fillReactionPill(pill, item.emoji, item.count);
        bar.appendChild(pill);
    }

    wrapper.appendChild(bar);
}

export function createMessageElement({
    sender,
    body,
    time,
    isOutgoing,
    senderId,
    onSenderClick,
    contentType = 'text',
    mediaUrl = null,
    mediaR2Key = null,
    mediaState = 'ready',
    clientId = null,
    messageId = null,
    quote = null,
    reactions = null,
    editedAt = null,
    showSender = true,
    showQuoteAuthor = true,
    viewerUserId = null,
    viewerUsername = null
}) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}${quote ? ' has-quote' : ''}`;
    if (clientId) wrapper.dataset.clientId = clientId;
    if (messageId) wrapper.dataset.messageId = messageId;
    if (senderId) wrapper.dataset.senderId = senderId;

    const kind = isMediaKind(contentType) ? contentType : null;
    const src = kind && (mediaUrl || mediaR2Key)
        ? (mediaUrl?.startsWith('blob:') ? mediaUrl : resolveMessageMediaUrl(mediaUrl, mediaR2Key))
        : null;

    if (kind) wrapper.dataset.contentType = kind;
    if (mediaR2Key) wrapper.dataset.mediaR2Key = mediaR2Key;
    if (src && !src.startsWith('blob:')) wrapper.dataset.mediaUrl = src;

    const senderEl = document.createElement('span');
    senderEl.className = 'message-sender';
    if (isOutgoing) senderEl.style.color = '#1a3a5f';
    senderEl.textContent = isOutgoing ? 'Ben' : `@${sender}`;

    if (showSender && !isOutgoing && onSenderClick) {
        senderEl.classList.add('clickable');
        senderEl.setAttribute('role', 'button');
        senderEl.tabIndex = 0;
        senderEl.title = `${sender} ile özel sohbet aç`;

        const openDm = (event) => {
            event.stopPropagation();
            onSenderClick(senderId, sender);
        };

        senderEl.addEventListener('click', openDm);
        senderEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openDm(event);
            }
        });
    }

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'message-body-wrap';

    if (quote) {
        const quoteEl = document.createElement('div');
        const quoteIsSelf = isQuoteFromViewer(quote, {
            userId: viewerUserId,
            username: viewerUsername
        });
        quoteEl.className = `message-quote${quoteIsSelf ? ' message-quote--self' : ''}`;

        const quoteMessageId = quote.message_id || quote.messageId || null;
        const quoteClientId = quote.client_id || quote.clientId || null;
        if (quoteMessageId || quoteClientId) {
            quoteEl.classList.add('message-quote--navigable');
            if (quoteMessageId) quoteEl.dataset.quoteMessageId = quoteMessageId;
            if (quoteClientId) quoteEl.dataset.quoteClientId = quoteClientId;
            quoteEl.title = 'Alıntılanan mesaja git';
            quoteEl.setAttribute('role', 'button');
            quoteEl.tabIndex = 0;
        }

        const quoteBody = document.createElement('span');
        quoteBody.className = 'message-quote-body';
        quoteBody.textContent = formatQuotePreview(quote);

        if (showQuoteAuthor) {
            const quoteAuthor = document.createElement('span');
            quoteAuthor.className = 'message-quote-author';
            quoteAuthor.textContent = formatQuoteAuthorLabel(quote, {
                userId: viewerUserId,
                username: viewerUsername
            });
            quoteEl.append(quoteAuthor, quoteBody);
        } else {
            quoteEl.appendChild(quoteBody);
        }

        bodyWrap.appendChild(quoteEl);
    }

    let statusEl = null;
    let mediaStack = null;

    if (kind && (src || mediaState === 'pending')) {
        const mediaRow = document.createElement('div');
        mediaRow.className = 'message-media-row';

        mediaStack = document.createElement('div');
        mediaStack.className = 'message-media-stack';
        if (kind === 'audio') mediaStack.classList.add('message-media-stack--audio');

        const media = createMediaHost({
            kind,
            src,
            state: mediaState,
            clientId,
            isOutgoing,
            mediaR2Key
        });
        mediaStack.appendChild(media.host);
        statusEl = media.status;

        mediaRow.appendChild(mediaStack);
        bodyWrap.appendChild(mediaRow);
    }

    const caption = sanitizeText(body || '', 2000);
    if (caption) {
        const bodyEl = document.createElement('span');
        bodyEl.className = 'message-body';
        if (kind) bodyEl.classList.add('message-caption');
        appendTextWithLinks(bodyEl, caption);
        bodyWrap.appendChild(bodyEl);
    } else if (!kind) {
        const bodyEl = document.createElement('span');
        bodyEl.className = 'message-body';
        appendTextWithLinks(bodyEl, body || '');
        bodyWrap.appendChild(bodyEl);
    }

    const metaEl = document.createElement('span');
    metaEl.className = 'message-meta';
    metaEl.textContent = editedAt ? `${time} · düzenlendi` : time;
    if (editedAt) wrapper.dataset.editedAt = editedAt;

    const hasTextBody = !!bodyWrap.querySelector('.message-body');
    if (hasTextBody) {
        const textRow = document.createElement('div');
        textRow.className = 'message-text-row';
        const bodyEl = bodyWrap.querySelector('.message-body');
        textRow.appendChild(bodyEl);
        textRow.appendChild(metaEl);
        bodyWrap.appendChild(textRow);
    } else if (kind && mediaStack) {
        metaEl.classList.add('message-meta--overlay');
        mediaStack.appendChild(metaEl);
    } else if (!kind) {
        bodyWrap.appendChild(metaEl);
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.appendChild(bodyWrap);

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'message-bubble';

    if (showSender) {
        bubbleEl.append(senderEl, contentEl);
    } else {
        bubbleEl.appendChild(contentEl);
    }

    const actionsToggle = createMessageActionsToggle();

    const frameEl = document.createElement('div');
    frameEl.className = 'message-frame';
    if (isOutgoing) {
        bubbleEl.classList.add('message-bubble--with-actions');
        bubbleEl.appendChild(actionsToggle);
        frameEl.appendChild(bubbleEl);
    } else {
        frameEl.append(bubbleEl, actionsToggle);
    }
    if (statusEl) frameEl.appendChild(statusEl);

    wrapper.appendChild(frameEl);
    appendReactionsBar(wrapper, reactions);

    return wrapper;
}

export function setButtonLoading(button, loading, defaultText) {
    button.disabled = loading;
    button.textContent = loading ? 'Lütfen bekleyin...' : defaultText;
}

export function showAuthError(element, message) {
    element.textContent = message;
    element.style.display = message ? 'block' : 'none';
}

export function initPasswordVisibilityToggles(root = document) {
    root.querySelectorAll('.password-field').forEach((field) => {
        const input = field.querySelector('input');
        const btn = field.querySelector('.password-toggle-btn');
        if (!input || !btn || btn.dataset.passwordToggleBound) return;

        btn.dataset.passwordToggleBound = '1';
        btn.addEventListener('click', () => {
            const revealed = input.type === 'text';
            input.type = revealed ? 'password' : 'text';
            btn.classList.toggle('is-revealed', !revealed);
            btn.setAttribute('aria-label', revealed ? 'Göster' : 'Gizle');
            btn.setAttribute('aria-pressed', revealed ? 'false' : 'true');
        });
    });
}

export function initPinVisibilityToggles(root = document) {
    root.querySelectorAll('.pin-field').forEach((field) => {
        const input = field.querySelector('input');
        const btn = field.querySelector('.password-toggle-btn');
        if (!input || !btn || btn.dataset.pinToggleBound) return;

        btn.dataset.pinToggleBound = '1';
        btn.addEventListener('click', () => {
            const masked = input.classList.contains('pin-input--masked');
            input.classList.toggle('pin-input--masked', !masked);
            btn.classList.toggle('is-revealed', masked);
            btn.setAttribute('aria-label', masked ? 'PIN\'i gizle' : 'PIN\'i göster');
            btn.setAttribute('aria-pressed', masked ? 'true' : 'false');
        });
    });
}
