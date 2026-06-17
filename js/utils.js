import { openLink } from './link-viewer.js';
import { toMediaUrl, isMediaKind } from './media/urls.js';
import { createMediaHost } from './media/render.js';

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

export function formatQuotePreview(quote) {
    const contentType = quote?.content_type || quote?.contentType || 'text';
    if (contentType === 'image') return '📷 Görsel';
    if (contentType === 'video') return '🎬 Video';
    if (contentType === 'audio') return '🎙️ Ses';
    const body = quote?.body || '';
    if (!body) return 'Mesaj';
    return body.length > 120 ? `${body.slice(0, 120)}…` : body;
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
            const link = document.createElement('a');
            link.className = 'message-link';
            link.href = href;
            link.textContent = trimTrailingUrlPunctuation(rawUrl);
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
        pill.innerHTML = `<span class="message-reaction-emoji">${item.emoji}</span><span class="message-reaction-count">${item.count}</span>`;
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
    mediaState = 'ready',
    clientId = null,
    messageId = null,
    quote = null,
    reactions = null,
    showSender = true,
    viewerUserId = null,
    viewerUsername = null
}) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}${quote ? ' has-quote' : ''}`;
    if (clientId) wrapper.dataset.clientId = clientId;
    if (messageId) wrapper.dataset.messageId = messageId;
    if (senderId) wrapper.dataset.senderId = senderId;

    const kind = isMediaKind(contentType) ? contentType : null;
    const src = kind && mediaUrl
        ? (mediaUrl.startsWith('blob:') ? mediaUrl : toMediaUrl(mediaUrl))
        : null;

    if (kind) wrapper.dataset.contentType = kind;
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

        const quoteAuthor = document.createElement('span');
        quoteAuthor.className = 'message-quote-author';
        quoteAuthor.textContent = formatQuoteAuthorLabel(quote, {
            userId: viewerUserId,
            username: viewerUsername
        });

        const quoteBody = document.createElement('span');
        quoteBody.className = 'message-quote-body';
        quoteBody.textContent = formatQuotePreview(quote);

        quoteEl.append(quoteAuthor, quoteBody);
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
            isOutgoing
        });
        mediaStack.appendChild(media.host);
        statusEl = media.status;

        mediaRow.append(mediaStack, createMessageActionsToggle());
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
    metaEl.textContent = time;

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

    if (kind && (src || mediaState === 'pending')) {
        contentEl.appendChild(bodyWrap);
    } else {
        const contentRow = document.createElement('div');
        contentRow.className = 'message-content-row';
        contentRow.append(bodyWrap, createMessageActionsToggle());
        contentEl.appendChild(contentRow);
    }

    if (showSender) {
        wrapper.append(senderEl, contentEl);
    } else {
        wrapper.appendChild(contentEl);
    }
    if (statusEl) wrapper.appendChild(statusEl);
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
